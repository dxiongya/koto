import { useEffect, type JSX } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isParagraphNode,
  $createParagraphNode,
  $createTextNode,
  KEY_ARROW_DOWN_COMMAND,
  COMMAND_PRIORITY_LOW
} from 'lexical'
import type { ElementTransformer } from '@lexical/markdown'
import {
  CollapsibleContainerNode,
  CollapsibleTitleNode,
  CollapsibleContentNode,
  $createCollapsibleContainerNode,
  $createCollapsibleTitleNode,
  $createCollapsibleContentNode,
  $isCollapsibleContainerNode,
  $isCollapsibleTitleNode,
  $isCollapsibleContentNode
} from '../nodes/CollapsibleNodes'

export function CollapsiblePlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext()

  // Store editor reference on container DOM elements for toggle event sync
  useEffect(() => {
    return editor.registerMutationListener(CollapsibleContainerNode, (mutations) => {
      for (const [key, type] of mutations) {
        if (type === 'destroyed') continue
        const elem = editor.getElementByKey(key)
        if (elem) {
          ;(elem as any).__lexicalEditor = editor
        }
      }
    })
  }, [editor])

  // Arrow down from title → move into content
  useEffect(() => {
    return editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      () => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false
        const node = selection.anchor.getNode()
        const parent = node.getParent()
        if (!$isCollapsibleTitleNode(parent) && !$isCollapsibleTitleNode(node)) return false
        const titleNode = $isCollapsibleTitleNode(parent) ? parent : node
        const container = titleNode.getParent()
        if (!$isCollapsibleContainerNode(container)) return false
        // Ensure container is open
        if (!container.getOpen()) {
          container.setOpen(true)
        }
        const content = container.getChildAtIndex(1)
        if ($isCollapsibleContentNode(content)) {
          const firstChild = content.getFirstChild()
          if (firstChild) {
            firstChild.selectStart()
            return true
          }
        }
        return false
      },
      COMMAND_PRIORITY_LOW
    )
  }, [editor])

  return null
}

// ─── Markdown transformer ────────────────────────────────────────────────────

export const COLLAPSIBLE_TRANSFORMER: ElementTransformer = {
  dependencies: [CollapsibleContainerNode, CollapsibleTitleNode, CollapsibleContentNode],
  export: (node) => {
    if (!$isCollapsibleContainerNode(node)) return null
    const children = node.getChildren()
    const titleNode = children.find((c) => $isCollapsibleTitleNode(c))
    const contentNode = children.find((c) => $isCollapsibleContentNode(c))

    const titleText = titleNode?.getTextContent() || 'Toggle'
    const contentLines: string[] = []
    if (contentNode) {
      for (const child of contentNode.getChildren()) {
        contentLines.push(child.getTextContent())
      }
    }
    const contentText = contentLines.join('\n')

    return `<details>\n<summary>${titleText}</summary>\n\n${contentText}\n\n</details>`
  },
  regExp: /^<details>\s*$/,
  replace: (parentNode, _children, _match) => {
    // Basic import: look at sibling paragraphs to reconstruct the toggle
    // Full import is handled by extractCollapsibleBlocks in LexicalEditor
    const container = $createCollapsibleContainerNode(false)
    const title = $createCollapsibleTitleNode()
    const content = $createCollapsibleContentNode()
    content.append($createParagraphNode())
    container.append(title, content)
    parentNode.replace(container)
    title.selectStart()
  },
  type: 'element'
}

// ─── Pre-parse: extract <details> blocks before Lexical markdown processing ──

export function extractCollapsibleBlocks(text: string): {
  text: string
  blocks: Array<{ title: string; content: string; open: boolean }>
} {
  const blocks: Array<{ title: string; content: string; open: boolean }> = []
  // Match <details> ... </details> blocks
  const regex = /<details(\s+open)?>\s*\n?\s*<summary>([\s\S]*?)<\/summary>\s*\n?([\s\S]*?)\n?\s*<\/details>/g
  let result = text
  let match: RegExpExecArray | null

  // Collect all matches first
  const matches: Array<{ full: string; open: boolean; title: string; content: string }> = []
  while ((match = regex.exec(text)) !== null) {
    matches.push({
      full: match[0],
      open: match[1] !== undefined,
      title: match[2].trim(),
      content: match[3].trim()
    })
  }

  // Replace from end to start to preserve indices
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]
    const idx = blocks.length
    blocks.unshift({ title: m.title, content: m.content, open: m.open })
    result = result.replace(m.full, `LXCLP${idx}LXCLP`)
  }

  return { text: result, blocks }
}

export function $replaceCollapsiblePlaceholders(
  blocks: Array<{ title: string; content: string; open: boolean }>
): void {
  const root = $getRoot()
  root.getChildren().forEach((node) => {
    if (!$isParagraphNode(node)) return
    const text = node.getTextContent().trim()
    const match = text.match(/^LXCLP(\d+)LXCLP$/)
    if (!match) return
    const idx = parseInt(match[1], 10)
    const block = blocks[idx]
    if (!block) return

    const container = $createCollapsibleContainerNode(block.open)
    const title = $createCollapsibleTitleNode()
    title.append($createTextNode(block.title))
    const content = $createCollapsibleContentNode()

    // Parse content lines into paragraphs
    const lines = block.content.split('\n')
    for (const line of lines) {
      const p = $createParagraphNode()
      if (line.trim()) {
        p.append($createTextNode(line))
      }
      content.append(p)
    }
    if (content.getChildrenSize() === 0) {
      content.append($createParagraphNode())
    }

    container.append(title, content)
    node.insertBefore(container)
    node.remove()
  })
}
