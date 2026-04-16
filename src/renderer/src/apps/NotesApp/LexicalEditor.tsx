import React, { useCallback, useRef, useMemo, useEffect } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { TabIndentationPlugin } from '@lexical/react/LexicalTabIndentationPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { TablePlugin } from '@lexical/react/LexicalTablePlugin'
import { HeadingNode, QuoteNode, $createHeadingNode } from '@lexical/rich-text'
import { ListNode, ListItemNode } from '@lexical/list'
import { CodeNode, CodeHighlightNode } from '@lexical/code'
import { LinkNode, AutoLinkNode } from '@lexical/link'
import { HashtagNode } from '@lexical/hashtag'
import { HashtagPlugin } from '@lexical/react/LexicalHashtagPlugin'
import {
  TableNode,
  TableCellNode,
  TableRowNode,
  $isTableNode,
  $isTableRowNode,
  $isTableCellNode
} from '@lexical/table'
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
  CHECK_LIST,
  type TextMatchTransformer
} from '@lexical/markdown'
import { $getRoot, $isParagraphNode, TextNode } from 'lexical'
import type { EditorState } from 'lexical'
import type { TextFormatTransformer, ElementTransformer } from '@lexical/markdown'
import { $createCodeNode, $isCodeNode } from '@lexical/code'
import { lexicalTheme } from './lexical-theme'
import {
  MD_TABLE_ROW_RE,
  MD_TABLE_SEP_RE,
  parseMarkdownTable,
  buildTableNodeFromParsed
} from './utils/markdownTable'

// Custom nodes
import { HorizontalRuleNode, HR_TRANSFORMER } from './nodes/HorizontalRuleNode'
import { CalloutNode } from './nodes/CalloutNode'
import { ImageNode } from './nodes/ImageNode'
import {
  CollapsibleContainerNode,
  CollapsibleTitleNode,
  CollapsibleContentNode
} from './nodes/CollapsibleNodes'
import { GhostTextNode } from './nodes/GhostTextNode'
import { AICommandNode } from './nodes/AICommandNode'
import { VideoNode } from './nodes/VideoNode'
import { $createHashtagNode, $isHashtagNode } from '@lexical/hashtag'

// Plugins
import { FloatingToolbarPlugin } from './plugins/FloatingToolbarPlugin'
import { KeyboardShortcutsPlugin } from './plugins/KeyboardShortcutsPlugin'
import { SlashCommandPlugin } from './plugins/SlashCommandPlugin'
import { CheckListPlugin, AutoCheckListMarkdownPlugin } from './plugins/CheckListPlugin'
import { RadixCheckListPlugin } from './plugins/RadixCheckListPlugin'
import { CodeBlockEnhancementPlugin } from './plugins/CodeBlockEnhancementPlugin'
import { CalloutPlugin } from './plugins/CalloutPlugin'
import {
  CollapsiblePlugin,
  COLLAPSIBLE_TRANSFORMER,
  extractCollapsibleBlocks,
  $replaceCollapsiblePlaceholders
} from './plugins/CollapsiblePlugin'
import { PastePlugin } from './plugins/PastePlugin'
import { CopyMetadataPlugin } from './plugins/CopyMetadataPlugin'
import { LinkPreviewPlugin } from './plugins/LinkPreviewPlugin'
import { GhostTextPlugin, _hasGhostText } from './plugins/GhostTextPlugin'
import {
  TableExitPlugin,
  MarkdownTableAutoConvertPlugin,
  TableActionPlugin
} from './plugins/TablePlugin'
import { TableAIPlugin } from './plugins/TableAIPlugin'
import { AutomationPlugin } from './plugins/AutomationPlugin'
import { TableOfContentsPlugin } from './plugins/TableOfContentsPlugin'
import { useMarkdownTheme } from './hooks/useMarkdownTheme'

const HASHTAG_TRANSFORMER: TextMatchTransformer = {
  dependencies: [HashtagNode],
  export: (node) => {
    if (!$isHashtagNode(node)) return null
    return node.getTextContent()
  },
  importRegExp: /(?:^|\s)(#[^\s#]+)/,
  regExp: /(?:^|\s)(#[^\s#]+)$/,
  replace: (textNode: TextNode, match: RegExpMatchArray) => {
    // match[0] is the full match including preceding space (if any)
    // match[1] is the captured hashtag string
    const fullMatch = match[0]
    const hashtag = match[1]
    
    // Calculate where the actual hashtag starts within the match
    const hashtagOffset = fullMatch.indexOf(hashtag)
    
    if (hashtagOffset > 0) {
      // If there is preceding whitespace, split the node
      const [, hashtagTextNode] = textNode.splitText(hashtagOffset)
      const hashtagNode = $createHashtagNode(hashtag)
      hashtagTextNode.replace(hashtagNode)
    } else {
      const hashtagNode = $createHashtagNode(hashtag)
      textNode.replace(hashtagNode)
    }
  },
  trigger: '#',
  type: 'text-match'
}

const HIGHLIGHT_TRANSFORMER: TextFormatTransformer = {
  format: ['highlight'],
  tag: '==',
  type: 'text-format'
}

const CODE_BLOCK_SPACE_TRANSFORMER: ElementTransformer = {
  dependencies: [CodeNode],
  export: (node) => {
    if (!$isCodeNode(node)) return null
    return '```' + (node.getLanguage() || '') + '\n' + node.getTextContent() + '\n```'
  },
  regExp: /^```(\w+)?\s$/,
  replace: (parentNode, _children, match) => {
    const language = match[1]
    const codeNode = $createCodeNode(language)
    parentNode.replace(codeNode)
    codeNode.select()
  },
  type: 'element'
}

const TABLE_TRANSFORMER: ElementTransformer = {
  dependencies: [TableNode],
  export: (node) => {
    if (!$isTableNode(node)) return null
    const rows = node.getChildren()
    if (rows.length === 0) return null

    const lines: string[] = []
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri]
      if (!$isTableRowNode(row)) continue
      const cells = row.getChildren()
      const cellTexts = cells.map((cell) => {
        if (!$isTableCellNode(cell)) return ''
        return cell.getTextContent().replace(/\|/g, '\\|').trim() || ' '
      })
      lines.push('| ' + cellTexts.join(' | ') + ' |')
      // Insert separator after header row
      if (ri === 0) {
        lines.push('| ' + cellTexts.map(() => '---').join(' | ') + ' |')
      }
    }
    return lines.join('\n')
  },
  // Import is handled by MarkdownTableAutoConvertPlugin, so use a never-match regex
  regExp: /(?!x)x/,
  replace: () => {},
  type: 'element'
}

export const ALL_TRANSFORMERS = [
  TABLE_TRANSFORMER,
  COLLAPSIBLE_TRANSFORMER,
  HR_TRANSFORMER,
  HIGHLIGHT_TRANSFORMER,
  HASHTAG_TRANSFORMER,
  CODE_BLOCK_SPACE_TRANSFORMER,
  CHECK_LIST,
  ...TRANSFORMERS
]

const HEADING_RE = /^(#{1,6})\s/

/** Post-process: convert any ParagraphNode starting with heading markers to HeadingNode.
 *  Safety net for edge cases where $convertFromMarkdownString misses headings. */
export function $fixUnconvertedHeadings(): void {
  const root = $getRoot()
  for (const node of root.getChildren()) {
    if (!$isParagraphNode(node)) continue
    const text = node.getTextContent()
    const match = text.match(HEADING_RE)
    if (!match) continue
    const level = match[1].length as 1 | 2 | 3 | 4 | 5 | 6
    const tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
    const heading = $createHeadingNode(tag)
    // Transfer children, stripping the leading "## " from the first text node
    const children = node.getChildren()
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      if (i === 0 && child.getType() === 'text') {
        const textContent = child.getTextContent()
        ;(child as TextNode).setTextContent(textContent.slice(match[0].length))
      }
      heading.append(child)
    }
    node.replace(heading)
  }
}

/** Extract markdown table blocks from raw text, replacing them with unique
 *  placeholders. Returns the modified text and an array of parsed table data
 *  so that TableNodes can be created after $convertFromMarkdownString runs. */
function extractTableBlocks(text: string): {
  text: string
  tables: Array<{ headers: string[]; rows: string[][] }>
} {
  const CODE_FENCE_RE = /^[ \t]*`{3,}/
  const lines = text.split('\n')
  const tables: Array<{ headers: string[]; rows: string[][] }> = []
  const result: string[] = []
  let i = 0
  let inCodeBlock = false

  while (i < lines.length) {
    const line = lines[i].trim()

    // Track code fences — don't extract tables inside code blocks
    if (CODE_FENCE_RE.test(line)) {
      inCodeBlock = !inCodeBlock
      result.push(lines[i])
      i++
      continue
    }
    if (inCodeBlock) {
      result.push(lines[i])
      i++
      continue
    }

    // Check if this line looks like the start of a table
    if (MD_TABLE_ROW_RE.test(line)) {
      // Collect consecutive table-like lines
      const tableLines: string[] = []
      let j = i
      while (j < lines.length) {
        const t = lines[j].trim()
        if (t === '') break
        if (!MD_TABLE_ROW_RE.test(t) && !MD_TABLE_SEP_RE.test(t)) break
        tableLines.push(t)
        j++
      }

      // Check if we found a valid table (at least header + separator)
      if (tableLines.length >= 2 && tableLines.some((l) => MD_TABLE_SEP_RE.test(l))) {
        const parsed = parseMarkdownTable(tableLines.join('\n'))
        if (parsed) {
          const idx = tables.length
          tables.push(parsed)
          result.push(`LXTBL${idx}LXTBL`)
          i = j
          continue
        }
      }
    }

    result.push(lines[i])
    i++
  }

  return { text: result.join('\n'), tables }
}

/** Replace placeholder paragraphs with actual TableNodes. */
function $replacePlaceholdersWithTables(
  tables: Array<{ headers: string[]; rows: string[][] }>
): void {
  const root = $getRoot()
  root.getChildren().forEach((node) => {
    if (!$isParagraphNode(node)) return
    const text = node.getTextContent().trim()
    const match = text.match(/^LXTBL(\d+)LXTBL$/)
    if (!match) return
    const idx = parseInt(match[1], 10)
    const parsed = tables[idx]
    if (!parsed) return
    const tableNode = buildTableNodeFromParsed(parsed)
    node.insertBefore(tableNode)
    node.remove()
  })
}

interface LexicalEditorProps {
  initialContent: string
  onSave: (markdown: string) => void
}

export const LexicalEditor: React.FC<LexicalEditorProps> = ({ initialContent, onSave }) => {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mdContainerRef = useRef<HTMLDivElement>(null)
  useMarkdownTheme(mdContainerRef)

  const initialConfig = useMemo(
    () => ({
      namespace: 'NotesEditor',
      theme: lexicalTheme,
      nodes: [
        HeadingNode,
        QuoteNode,
        ListNode,
        ListItemNode,
        CodeNode,
        CodeHighlightNode,
        LinkNode,
        AutoLinkNode,
        TableNode,
        TableCellNode,
        TableRowNode,
        HorizontalRuleNode,
        CalloutNode,
        ImageNode,
        HashtagNode,
        CollapsibleContainerNode,
        CollapsibleTitleNode,
        CollapsibleContentNode,
        GhostTextNode,
        AICommandNode,
        VideoNode
      ],
      editorState: () => {
        // 1a. Extract collapsible blocks BEFORE other processing
        const { text: withoutCollapsibles, blocks: collapsibleBlocks } = extractCollapsibleBlocks(initialContent)
        // 1b. Extract table blocks BEFORE Lexical processes the markdown
        const { text: withoutTables, tables } = extractTableBlocks(withoutCollapsibles)

        // 2. Preserve blank lines by inserting zero-width space markers
        const processed = withoutTables.replace(/\n{3,}/g, (match) => {
          const emptyCount = Math.floor((match.length - 2) / 2)
          if (emptyCount <= 0) return '\n\n'
          return '\n\n' + Array(emptyCount).fill('\u200B\n\n').join('')
        })

        $convertFromMarkdownString(processed, ALL_TRANSFORMERS)

        // 3. Clear the zero-width space markers to make truly empty paragraphs
        const root = $getRoot()
        root.getChildren().forEach((node) => {
          if ($isParagraphNode(node) && node.getTextContent() === '\u200B') {
            node.clear()
          }
        })

        // 4. Replace placeholders with actual TableNodes
        if (tables.length > 0) {
          $replacePlaceholdersWithTables(tables)
        }

        // 5. Replace placeholders with actual CollapsibleNodes
        if (collapsibleBlocks.length > 0) {
          $replaceCollapsiblePlaceholders(collapsibleBlocks)
        }

        // 6. Safety net: fix any ParagraphNodes that still have heading markers
        $fixUnconvertedHeadings()
      },
      onError: (error: Error) => {
        console.error('Lexical error:', error)
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const handleChange = useCallback(
    (editorState: EditorState) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        // Don't auto-save while ghost text is showing (it's a transient DecoratorNode)
        if (_hasGhostText) return
        editorState.read(() => {
          const md = $convertToMarkdownString(ALL_TRANSFORMERS)
          onSave(md)
        })
      }, 800)
    },
    [onSave],
  )

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="flex-1 flex h-full overflow-hidden relative">
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div ref={mdContainerRef} id="write" className="markdown-body flex-1 overflow-y-auto relative">
            <RichTextPlugin
              contentEditable={
                <ContentEditable className="outline-none px-8 py-2 md:px-12 md:py-4 min-h-full" />
              }
              placeholder={
                <div className="absolute top-2 left-8 md:top-4 md:left-12 text-tx-faint pointer-events-none select-none" style={{ fontSize: 'var(--md-font-size, 16px)' }}>
                  Type / for commands...
                </div>
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
            {/* TOC: floating & collapsed modes render inside scroll area (absolute) */}
          </div>
        </div>
        {/* TOC: renders itself — pinned as sibling, floating/collapsed as absolute */}
        <TableOfContentsPlugin />
      </div>
      {/* Core plugins */}
      <HistoryPlugin />
      <ListPlugin />
      <TabIndentationPlugin />
      <MarkdownShortcutPlugin transformers={ALL_TRANSFORMERS} />
      <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
      <HashtagPlugin />

      {/* Checklist */}
      <CheckListPlugin />
      <RadixCheckListPlugin />
      <AutoCheckListMarkdownPlugin />

      {/* Table */}
      <TablePlugin hasCellMerge={false} hasCellBackgroundColor={false} hasTabHandler={true} />
      <TableExitPlugin />
      <MarkdownTableAutoConvertPlugin />
      <TableActionPlugin />
      <TableAIPlugin />
      <AutomationPlugin />

      {/* Code block */}
      <CodeBlockEnhancementPlugin />

      {/* Callout */}
      <CalloutPlugin />

      {/* Collapsible / Toggle */}
      <CollapsiblePlugin />

      {/* Paste (images, markdown, tables) */}
      <PastePlugin />
      <CopyMetadataPlugin />

      {/* Editing experience */}
      <FloatingToolbarPlugin />
      <KeyboardShortcutsPlugin />
      <SlashCommandPlugin />
      <LinkPreviewPlugin />

      {/* AI Ghost Text (Tab Completion) */}
      <GhostTextPlugin />
    </LexicalComposer>
  )
}
