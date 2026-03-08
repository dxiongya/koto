import React, { useCallback, useRef, useMemo } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { TablePlugin } from '@lexical/react/LexicalTablePlugin'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListNode, ListItemNode } from '@lexical/list'
import { CodeNode, CodeHighlightNode } from '@lexical/code'
import { LinkNode, AutoLinkNode } from '@lexical/link'
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
  CHECK_LIST
} from '@lexical/markdown'
import { $getRoot, $isParagraphNode } from 'lexical'
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

// Plugins
import { FloatingToolbarPlugin } from './plugins/FloatingToolbarPlugin'
import { KeyboardShortcutsPlugin } from './plugins/KeyboardShortcutsPlugin'
import { SlashCommandPlugin } from './plugins/SlashCommandPlugin'
import { CheckListPlugin, AutoCheckListMarkdownPlugin } from './plugins/CheckListPlugin'
import { RadixCheckListPlugin } from './plugins/RadixCheckListPlugin'
import { CodeBlockEnhancementPlugin } from './plugins/CodeBlockEnhancementPlugin'
import { CalloutPlugin } from './plugins/CalloutPlugin'
import { PastePlugin } from './plugins/PastePlugin'
import { LinkPreviewPlugin } from './plugins/LinkPreviewPlugin'
import {
  TableExitPlugin,
  MarkdownTableAutoConvertPlugin,
  TableActionPlugin
} from './plugins/TablePlugin'

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

const ALL_TRANSFORMERS = [
  TABLE_TRANSFORMER,
  HR_TRANSFORMER,
  HIGHLIGHT_TRANSFORMER,
  CODE_BLOCK_SPACE_TRANSFORMER,
  CHECK_LIST,
  ...TRANSFORMERS
]

/** Extract markdown table blocks from raw text, replacing them with unique
 *  placeholders. Returns the modified text and an array of parsed table data
 *  so that TableNodes can be created after $convertFromMarkdownString runs. */
function extractTableBlocks(text: string): {
  text: string
  tables: Array<{ headers: string[]; rows: string[][] }>
} {
  const lines = text.split('\n')
  const tables: Array<{ headers: string[]; rows: string[][] }> = []
  const result: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i].trim()

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
        ImageNode
      ],
      editorState: () => {
        // 1. Extract table blocks BEFORE Lexical processes the markdown
        const { text: withoutTables, tables } = extractTableBlocks(initialContent)

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
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        <div className="flex-1 overflow-y-auto">
          <RichTextPlugin
            contentEditable={
              <ContentEditable className="outline-none px-8 py-2 md:px-12 md:py-4 min-h-full text-[16px] leading-[1.8]" />
            }
            placeholder={
              <div className="absolute top-2 left-8 md:top-4 md:left-12 text-tx-faint text-[16px] pointer-events-none select-none">
                Type / for commands...
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
      </div>
      {/* Core plugins */}
      <HistoryPlugin />
      <ListPlugin />
      <MarkdownShortcutPlugin transformers={ALL_TRANSFORMERS} />
      <OnChangePlugin onChange={handleChange} ignoreSelectionChange />

      {/* Checklist */}
      <CheckListPlugin />
      <RadixCheckListPlugin />
      <AutoCheckListMarkdownPlugin />

      {/* Table */}
      <TablePlugin hasCellMerge={false} hasCellBackgroundColor={false} hasTabHandler={true} />
      <TableExitPlugin />
      <MarkdownTableAutoConvertPlugin />
      <TableActionPlugin />

      {/* Code block */}
      <CodeBlockEnhancementPlugin />

      {/* Callout */}
      <CalloutPlugin />

      {/* Paste (images, markdown, tables) */}
      <PastePlugin />

      {/* Editing experience */}
      <FloatingToolbarPlugin />
      <KeyboardShortcutsPlugin />
      <SlashCommandPlugin />
      <LinkPreviewPlugin />
    </LexicalComposer>
  )
}
