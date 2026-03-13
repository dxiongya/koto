/**
 * PastePlugin — Single entry point for all paste handling in the editor.
 *
 * Priority order:
 *   1. Image file in clipboard   → save via IPC, insert ImageNode
 *   2. HTML with <img src>       → download via IPC, insert ImageNode
 *   3. Markdown text             → convert to Lexical nodes and insert
 *   4. Markdown table text       → insert TableNode (via PASTE_COMMAND)
 *
 * For cases 1-3, we use a native DOM "paste" capture-phase listener.
 * For case 4, we use Lexical's PASTE_COMMAND with COMMAND_PRIORITY_LOW.
 */
import { useEffect, type JSX } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $insertNodes,
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  PASTE_COMMAND,
  COMMAND_PRIORITY_LOW,
  type LexicalNode,
  type RangeSelection
} from 'lexical'
import { $createLinkNode, $isLinkNode } from '@lexical/link'
import {
  $convertFromMarkdownString,
  TRANSFORMERS,
  CHECK_LIST
} from '@lexical/markdown'
import { $createImageNode } from '../nodes/ImageNode'
import { $createVideoNode, isVideoEmbedUrl } from '../nodes/VideoNode'
import { parseMarkdownTable, buildTableNodeFromParsed } from '../utils/markdownTable'

// Re-use the same transformer list as LexicalEditor.tsx
// We import the individual transformers here to avoid circular deps
import { HR_TRANSFORMER } from '../nodes/HorizontalRuleNode'
import { $fixUnconvertedHeadings } from '../LexicalEditor'

const HTML_IMG_RE = /<img[^>]+src=["']([^"']+)["']/i
const URL_RE = /^https?:\/\/[^\s]+$/i

/** Simple heuristic: does this text look like it contains markdown syntax? */
function looksLikeMarkdown(text: string): boolean {
  // Check for common markdown patterns
  return /^#{1,6}\s/m.test(text) ||       // headings
    /^\s*[-*+]\s/m.test(text) ||           // unordered lists
    /^\s*\d+\.\s/m.test(text) ||           // ordered lists
    /^\s*>/m.test(text) ||                 // blockquotes
    /```[\s\S]*```/m.test(text) ||         // code blocks
    /\*\*.+\*\*/m.test(text) ||            // bold
    /^\s*---\s*$/m.test(text) ||           // horizontal rules
    /^\s*- \[[ x]\]/m.test(text) ||        // checklists
    /^\|.+\|$/m.test(text)                 // tables
}

function filenameToSrc(filename: string): string {
  return `lite-asset://images/${filename}`
}

export function PastePlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext()

  // ── Markdown table: intercept via PASTE_COMMAND ──
  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        const clipboardData =
          event instanceof ClipboardEvent ? event.clipboardData : null
        if (!clipboardData) return false

        const text = clipboardData.getData('text/plain')
        if (!text) return false

        const parsed = parseMarkdownTable(text.trim())
        if (!parsed) return false

        editor.update(() => {
          const sel = $getSelection()
          const tableNode = buildTableNodeFromParsed(parsed)
          const paragraph = $createParagraphNode()
          if ($isRangeSelection(sel)) {
            $insertNodes([tableNode, paragraph])
          } else {
            $getRoot().append(tableNode)
            $getRoot().append(paragraph)
          }
          paragraph.selectStart()
        })
        return true
      },
      COMMAND_PRIORITY_LOW
    )
  }, [editor])

  // ── Images, markdown, and plain-text via DOM capture listener ──
  useEffect(() => {
    const ensureSelection = (cb: (sel: RangeSelection) => void): void => {
      const sel = $getSelection()
      if ($isRangeSelection(sel)) {
        cb(sel)
        return
      }
      $getRoot().selectEnd()
      const fallback = $getSelection()
      if ($isRangeSelection(fallback)) cb(fallback)
    }

    const insertImage = (src: string): void => {
      const img = $createImageNode({ src })
      const p = $createParagraphNode()
      $insertNodes([img, p])
      p.selectStart()
    }

    const insertVideo = (src: string): void => {
      const vid = $createVideoNode({ src })
      const p = $createParagraphNode()
      $insertNodes([vid, p])
      p.selectStart()
    }

    // ── 0. Video file from clipboard ──
    function handleVideoFile(data: DataTransfer): boolean {
      let file: File | null = null
      for (const item of Array.from(data.items)) {
        if (item.kind === 'file' && item.type.startsWith('video/')) {
          file = item.getAsFile()
          break
        }
      }
      if (!file) return false

      const captured = file
      void captured.arrayBuffer().then(async (buffer) => {
        try {
          const result = await window.api.video.save(buffer, captured.type)
          if (result.ok) {
            editor.update(() => ensureSelection(() => insertVideo(`lite-asset://videos/${result.data}`)))
          }
        } catch (err) {
          console.error('[PastePlugin] video save failed:', err)
        }
      })

      return true
    }

    // ── 1. Image file from clipboard ──
    function handleImageFile(data: DataTransfer): boolean {
      let file: File | null = null
      for (const item of Array.from(data.items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          file = item.getAsFile()
          break
        }
      }
      if (!file) return false

      const captured = file
      void captured.arrayBuffer().then(async (buffer) => {
        try {
          const result = await window.api.image.save(buffer, captured.type)
          if (result.ok) {
            editor.update(() => ensureSelection(() => insertImage(filenameToSrc(result.data))))
          }
        } catch (err) {
          console.error('[PastePlugin] image save failed:', err)
        }
      })

      return true
    }

    // ── 2. HTML with <img src="https://..."> ──
    function handleHtmlImage(data: DataTransfer): boolean {
      const html = data.getData('text/html')
      if (!html) return false

      const match = html.match(HTML_IMG_RE)
      const imgUrl = match?.[1]
      if (!imgUrl || !/^https?:\/\//i.test(imgUrl)) return false

      void (async () => {
        try {
          const result = await window.api.image.saveFromUrl(imgUrl)
          if (result.ok) {
            editor.update(() => ensureSelection(() => insertImage(filenameToSrc(result.data))))
          }
        } catch (err) {
          console.error('[PastePlugin] image URL download failed:', err)
        }
      })()

      return true
    }

    // ── 3a. Video embed URL (YouTube, Bilibili) → VideoNode ──
    function handleVideoEmbedUrl(data: DataTransfer): boolean {
      const text = data.getData('text/plain')?.trim()
      if (!text || !URL_RE.test(text)) return false
      if (!isVideoEmbedUrl(text)) return false

      editor.update(() => {
        ensureSelection(() => {
          const videoNode = $createVideoNode({ src: text })
          const p = $createParagraphNode()
          $insertNodes([videoNode, p])
          p.selectStart()
        })
      })
      return true
    }

    // ── 3b. Plain URL → LinkNode + async title resolution ──
    function handlePlainUrl(data: DataTransfer): boolean {
      const text = data.getData('text/plain')?.trim()
      if (!text || !URL_RE.test(text)) return false

      const url = text
      let nodeKey: string | null = null

      editor.update(() => {
        ensureSelection((sel) => {
          const link = $createLinkNode(url)
          link.append($createTextNode(url))
          sel.insertNodes([link])
          nodeKey = link.getKey()
        })
      })

      // Async: fetch page title and update link text
      if (nodeKey) {
        const key = nodeKey
        void (async () => {
          try {
            const result = await window.api.url.fetchMeta(url)
            if (!result.ok) return
            const title = result.data.title?.trim()
            if (!title) return
            editor.update(() => {
              const link = $getNodeByKey(key)
              if (!link || !$isLinkNode(link)) return
              if (link.getURL() !== url) return
              const oldChildren = link.getChildren()
              link.append($createTextNode(title))
              for (const child of oldChildren) child.remove()
            })
          } catch {
            // Ignore fetch failures
          }
        })()
      }

      return true
    }

    // ── 4. Markdown text → convert and insert ──
    function handleMarkdownText(data: DataTransfer): boolean {
      const text = data.getData('text/plain')
      if (!text || !looksLikeMarkdown(text)) return false

      editor.update(() => {
        ensureSelection(() => {
          // Create a temporary root to hold converted nodes
          // We use a trick: create nodes by converting markdown in a detached context,
          // then extract and insert them at the current selection.
          const ALL_PASTE_TRANSFORMERS = [
            HR_TRANSFORMER,
            CHECK_LIST,
            ...TRANSFORMERS
          ]

          // Convert markdown to nodes by temporarily manipulating the root
          // We'll build nodes in a fresh paragraph container
          const nodesToInsert: LexicalNode[] = []

          // Use $convertFromMarkdownString in a temporary root approach:
          // 1. Save current root children
          const root = $getRoot()
          const savedChildren = root.getChildren()

          // 2. Clear root and convert markdown
          root.clear()
          $convertFromMarkdownString(text, ALL_PASTE_TRANSFORMERS)

          // 3. Extract the new nodes
          const newChildren = root.getChildren()
          for (const child of newChildren) {
            nodesToInsert.push(child)
          }

          // 4. Restore original children
          root.clear()
          for (const child of savedChildren) {
            root.append(child)
          }

          // 5. Insert the converted nodes at selection
          if (nodesToInsert.length > 0) {
            const sel = $getSelection()
            if ($isRangeSelection(sel)) {
              // Delete selected content first
              sel.removeText()
            }
            // Find insertion point
            const selection = $getSelection()
            if ($isRangeSelection(selection)) {
              $insertNodes(nodesToInsert)
            } else {
              for (const node of nodesToInsert) {
                root.append(node)
              }
            }
            // Safety net: fix any headings that weren't converted from markdown
            $fixUnconvertedHeadings()
          }
        })
      })

      return true
    }

    const onPaste = (e: Event): void => {
      const event = e as ClipboardEvent
      if (event.defaultPrevented) return
      const data = event.clipboardData
      if (!data) return

      const handled =
        handleVideoFile(data) ||
        handleImageFile(data) ||
        handleHtmlImage(data) ||
        handleVideoEmbedUrl(data) ||
        handlePlainUrl(data) ||
        handleMarkdownText(data)

      if (handled) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }

    return editor.registerRootListener((next, prev) => {
      prev?.removeEventListener('paste', onPaste, true)
      next?.addEventListener('paste', onPaste, true)
    })
  }, [editor])

  return null
}
