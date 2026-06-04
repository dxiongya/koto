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
import { CalloutNode, $createCalloutNode, $isCalloutNode, type CalloutType } from './nodes/CalloutNode'
import { ImageNode, $createImageNode, $isImageNode } from './nodes/ImageNode'
import {
  CollapsibleContainerNode,
  CollapsibleTitleNode,
  CollapsibleContentNode
} from './nodes/CollapsibleNodes'
import { GhostTextNode } from './nodes/GhostTextNode'
import { AICommandNode } from './nodes/AICommandNode'
import { VideoNode, $createVideoNode, $isVideoNode } from './nodes/VideoNode'
import { $createTextNode, $createParagraphNode } from 'lexical'
import type { MultilineElementTransformer } from '@lexical/markdown'
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
import { ResourceDropPlugin } from './plugins/ResourceDropPlugin'
import { ReadingHighlightPlugin } from './plugins/ReadingHighlightPlugin'
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

// Markdown transformer for the custom ImageNode. Without this the image
// survives in-memory (so the user sees it right after drop) but is silently
// dropped on auto-save because `$convertToMarkdownString` has no rule for it
// — reloading the file (or switching tabs and back) then shows no image.
//
// Size + alignment (non-default) are encoded as a URL fragment so the
// markdown stays standards-compliant and still renders reasonably in any
// other markdown viewer. Example: `![alt](file://…/a.png#w=320&h=180&align=left)`.
const IMAGE_TRANSFORMER: ElementTransformer = {
  dependencies: [ImageNode],
  export: (node) => {
    if (!$isImageNode(node)) return null
    const n = node as unknown as {
      __src: string
      __alt?: string
      __width?: number | 'inherit'
      __height?: number | 'inherit'
      __alignment?: string
    }
    const src = n.__src
    const alt = n.__alt ?? ''
    const params: string[] = []
    if (typeof n.__width === 'number') params.push(`w=${n.__width}`)
    if (typeof n.__height === 'number') params.push(`h=${n.__height}`)
    if (n.__alignment && n.__alignment !== 'center') params.push(`align=${n.__alignment}`)
    const suffix = params.length ? `#${params.join('&')}` : ''
    return `![${alt}](${src}${suffix})`
  },
  // Match a lone "![alt](url)" line so we don't swallow inline images inside
  // prose paragraphs — those are left to Lexical's built-in text transformer.
  regExp: /^!\[([^\]]*)\]\(([^)]+)\)\s*$/,
  replace: (parentNode, _children, match) => {
    const [, alt, rawSrc] = match
    // Strip our own `#w=…&h=…&align=…` fragment off the src, if present,
    // before constructing the node. Any other `#…` content is preserved.
    let src = rawSrc
    let width: number | 'inherit' = 'inherit'
    let height: number | 'inherit' = 'inherit'
    let alignment: 'left' | 'center' | 'right' | undefined
    const hashIdx = rawSrc.lastIndexOf('#')
    if (hashIdx >= 0) {
      const frag = rawSrc.slice(hashIdx + 1)
      // Only treat as our metadata fragment if every k/v pair is a known key.
      const pairs = frag.split('&').map((s) => s.split('=') as [string, string])
      const known = pairs.every(([k]) => k === 'w' || k === 'h' || k === 'align')
      if (known) {
        src = rawSrc.slice(0, hashIdx)
        for (const [k, v] of pairs) {
          if (k === 'w') { const n = Number(v); if (Number.isFinite(n)) width = n }
          else if (k === 'h') { const n = Number(v); if (Number.isFinite(n)) height = n }
          else if (k === 'align' && (v === 'left' || v === 'center' || v === 'right')) alignment = v
        }
      }
    }
    const img = $createImageNode({ src, alt, width, height, alignment })
    parentNode.replace(img)
  },
  type: 'element',
}

// ── VideoNode markdown transformer ────────────────────────────────────
//
// VideoNode is a DecoratorNode — Lexical's default markdown has no idea
// about it, so without a transformer every video dropped into a note would
// silently disappear on auto-save. Reuse the `![alt](src)` syntax (same as
// image) and distinguish on import by file extension. On the export side
// VideoNode wins because its own transformer runs before IMAGE_TRANSFORMER
// when iterating element transformers.
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'm4v', 'ogv'])

function srcLooksLikeVideo(src: string): boolean {
  const hashIdx = src.lastIndexOf('#')
  const clean = hashIdx >= 0 ? src.slice(0, hashIdx) : src
  const qIdx = clean.lastIndexOf('?')
  const path = qIdx >= 0 ? clean.slice(0, qIdx) : clean
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return VIDEO_EXTS.has(ext)
}

const VIDEO_TRANSFORMER: ElementTransformer = {
  dependencies: [VideoNode],
  export: (node) => {
    if (!$isVideoNode(node)) return null
    const n = node as unknown as {
      __src: string
      __width?: number | 'inherit'
      __height?: number | 'inherit'
      __alignment?: string
    }
    const params: string[] = []
    if (typeof n.__width === 'number') params.push(`w=${n.__width}`)
    if (typeof n.__height === 'number') params.push(`h=${n.__height}`)
    if (n.__alignment && n.__alignment !== 'center') params.push(`align=${n.__alignment}`)
    const suffix = params.length ? `#${params.join('&')}` : ''
    return `![](${n.__src}${suffix})`
  },
  // Only match when the URL's extension looks like a video. IMAGE_TRANSFORMER
  // (placed after this one in ALL_TRANSFORMERS) picks up anything we reject.
  regExp: /^!\[([^\]]*)\]\(([^)]+)\)\s*$/,
  replace: (parentNode, _children, match) => {
    const [, , rawSrc] = match
    if (!srcLooksLikeVideo(rawSrc)) return false
    let src = rawSrc
    let width: number | 'inherit' = 'inherit'
    let height: number | 'inherit' = 'inherit'
    let alignment: 'left' | 'center' | 'right' | undefined
    const hashIdx = rawSrc.lastIndexOf('#')
    if (hashIdx >= 0) {
      const frag = rawSrc.slice(hashIdx + 1)
      const pairs = frag.split('&').map((s) => s.split('=') as [string, string])
      const known = pairs.every(([k]) => k === 'w' || k === 'h' || k === 'align')
      if (known) {
        src = rawSrc.slice(0, hashIdx)
        for (const [k, v] of pairs) {
          if (k === 'w') { const nn = Number(v); if (Number.isFinite(nn)) width = nn }
          else if (k === 'h') { const nn = Number(v); if (Number.isFinite(nn)) height = nn }
          else if (k === 'align' && (v === 'left' || v === 'center' || v === 'right')) alignment = v
        }
      }
    }
    const video = $createVideoNode({ src, width, height, alignment })
    parentNode.replace(video)
    return true
  },
  type: 'element',
}

// ── CalloutNode markdown transformer ──────────────────────────────────
//
// Uses GitHub-flavoured callout syntax so round-tripping through other
// markdown viewers degrades gracefully to a blockquote:
//
//   > [!note]
//   > body text
//   > second paragraph body
//
// CalloutNode is a container ElementNode, so we use a MultilineElementTransformer
// and drive import via `handleImportAfterStartMatch` (lines end when we hit
// one that doesn't start with `>`).
const CALLOUT_TRANSFORMER: MultilineElementTransformer = {
  dependencies: [CalloutNode],
  export: (node, exportChildren) => {
    if (!$isCalloutNode(node)) return null
    const type = node.getCalloutType()
    const inner = exportChildren(node)
    const prefixed = inner.length > 0
      ? inner.split('\n').map((l) => (l.length > 0 ? `> ${l}` : '>')).join('\n')
      : '>'
    return `> [!${type}]\n${prefixed}`
  },
  regExpStart: /^>\s*\[!(note|warning|tip|important)\]\s*$/i,
  // Placeholder end — we drive import manually.
  regExpEnd: { optional: true, regExp: /^(?![\s\S])/ },
  handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex, startMatch }) => {
    const type = (startMatch[1] || 'note').toLowerCase() as CalloutType
    const callout = $createCalloutNode(type)
    let i = startLineIndex + 1
    // Collect the body: consecutive lines that start with ">". Strip the
    // leading "> " (or ">" alone for a blank-line continuation).
    const body: string[] = []
    while (i < lines.length) {
      const line = lines[i]
      if (!/^>/.test(line)) break
      body.push(line.replace(/^>\s?/, ''))
      i++
    }
    // Split body on blank lines into paragraphs. Each becomes a paragraph
    // node with the raw text as a single TextNode — we don't recursively
    // invoke markdown import for inline formatting here (keeps the scope
    // contained; inline bold/italic inside a callout will still round-trip
    // as literal text, which is acceptable).
    const paragraphs = body.join('\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    if (paragraphs.length === 0) {
      callout.append($createParagraphNode())
    } else {
      for (const para of paragraphs) {
        const p = $createParagraphNode()
        p.append($createTextNode(para))
        callout.append(p)
      }
    }
    rootNode.append(callout)
    // Return the index of the LAST consumed line (inclusive), hence i - 1.
    return [true, i - 1]
  },
  replace: () => true,
  type: 'multiline-element',
}

export const ALL_TRANSFORMERS = [
  CALLOUT_TRANSFORMER,
  TABLE_TRANSFORMER,
  COLLAPSIBLE_TRANSFORMER,
  HR_TRANSFORMER,
  VIDEO_TRANSFORMER,
  IMAGE_TRANSFORMER,
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
          <div ref={mdContainerRef} id="write" className="markdown-body flex-1 overflow-y-auto scroll-thin relative">
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

      {/* Cross-app resource drops (collector items, files, terminals) */}
      <ResourceDropPlugin />

      {/* Reading aids — colors keywords, numbers/units, and acronyms via
          the CSS Custom Highlight API. Pure rendering layer; doesn't touch
          the editor model or the .md file on disk. */}
      <ReadingHighlightPlugin />

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
