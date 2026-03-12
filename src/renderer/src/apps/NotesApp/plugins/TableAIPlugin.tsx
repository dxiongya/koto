import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection,
  $isRangeSelection,
  $getNodeByKey,
  SELECTION_CHANGE_COMMAND,
  COMMAND_PRIORITY_LOW
} from 'lexical'
import {
  $isTableNode,
  $isTableRowNode,
  $isTableCellNode,
  $isTableSelection,
  $findTableNode,
  type TableNode
} from '@lexical/table'
import { Sparkles, Send, Loader2, X } from 'lucide-react'
import { useUIStore } from '../../../store/useUIStore'
import { parseMarkdownTable, buildTableNodeFromParsed, MD_TABLE_ROW_RE, MD_TABLE_SEP_RE } from '../utils/markdownTable'

// ── Helpers ──

/** Serialize a TableNode to markdown string */
function $tableToMarkdown(table: TableNode): string {
  const rows = table.getChildren()
  if (rows.length === 0) return ''

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
    if (ri === 0) {
      lines.push('| ' + cellTexts.map(() => '---').join(' | ') + ' |')
    }
  }
  return lines.join('\n')
}

/** Compute panel position: anchored to table's right edge, clamped inside viewport */
function calcPosition(
  tableElem: HTMLElement,
  panelElem: HTMLElement | null
): { top: number; left: number } {
  const tr = tableElem.getBoundingClientRect()
  const panelW = panelElem?.offsetWidth ?? 340
  const panelH = panelElem?.offsetHeight ?? 40
  const pad = 12

  // Use documentElement for safe viewport bounds
  const vw = document.documentElement.clientWidth
  const vh = document.documentElement.clientHeight

  // Horizontal: prefer left of table right edge so panel is fully visible
  let left = tr.right - panelW
  // If panel would go off left edge, shift right
  if (left < pad) left = pad
  // If panel would go off right edge, clamp
  if (left + panelW > vw - pad) left = vw - pad - panelW

  // Vertical: prefer above table
  let top = tr.top - panelH - pad
  if (top < pad) {
    // Not enough room above → below table
    top = tr.bottom + pad
  }
  if (top + panelH > vh - pad) {
    top = vh - pad - panelH
  }

  return { top, left }
}

// ── Selection highlight persistence ──

const TABLE_HIGHLIGHT_CLASS = 'table-ai-highlight'
const HIGHLIGHT_STYLE_ID = 'table-ai-highlight-style'

function ensureHighlightStyle(): void {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = HIGHLIGHT_STYLE_ID
  style.textContent = `.${TABLE_HIGHLIGHT_CLASS} td, .${TABLE_HIGHLIGHT_CLASS} th { background-color: rgba(94, 234, 212, 0.08) !important; }`
  document.head.appendChild(style)
}

function setTableHighlight(editor: ReturnType<typeof useLexicalComposerContext>[0], key: string, on: boolean): void {
  const elem = editor.getElementByKey(key)
  if (!elem) return
  if (on) {
    ensureHighlightStyle()
    elem.classList.add(TABLE_HIGHLIGHT_CLASS)
  } else {
    elem.classList.remove(TABLE_HIGHLIGHT_CLASS)
  }
}

// ── Plugin ──

export function TableAIPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const [tableKey, setTableKey] = useState<string | null>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [showPanel, setShowPanel] = useState(false)
  const [tableMarkdown, setTableMarkdown] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const tableKeyRef = useRef<string | null>(null)

  // ── Callbacks (declared before effects that reference them) ──

  const handleClose = useCallback(() => {
    if (tableKey) setTableHighlight(editor, tableKey, false)
    setShowPanel(false)
    setTableMarkdown('')
    setTableKey(null)
  }, [editor, tableKey])

  const handleOpenAI = useCallback(() => {
    if (!tableKey) return
    editor.getEditorState().read(() => {
      const table = $getNodeByKey(tableKey)
      if (!table || !$isTableNode(table)) return
      const md = $tableToMarkdown(table)
      setTableMarkdown(md)
      setShowPanel(true)
    })
  }, [editor, tableKey])

  // ── Effects ──

  // Track which table the cursor/selection is in
  useEffect(() => {
    return editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        if (showPanel) return false

        editor.getEditorState().read(() => {
          const sel = $getSelection()

          if ($isTableSelection(sel)) {
            const table = $findTableNode(sel.anchor.getNode())
            if (table) { setTableKey(table.getKey()); return }
          }

          if ($isRangeSelection(sel)) {
            const table = $findTableNode(sel.anchor.getNode())
            if (table) { setTableKey(table.getKey()); return }
          }

          setTableKey(null)
        })
        return false
      },
      COMMAND_PRIORITY_LOW
    )
  }, [editor, showPanel])

  // Detect if the tracked table node is removed (after replace, undo, etc.)
  useEffect(() => {
    if (!tableKey) return
    return editor.registerUpdateListener(() => {
      const elem = editor.getElementByKey(tableKey)
      if (!elem) {
        setTableKey(null)
        setShowPanel(false)
      }
    })
  }, [editor, tableKey])

  // Update position continuously (on scroll, resize, panel size change)
  useEffect(() => {
    tableKeyRef.current = tableKey
    if (!tableKey) return

    const updatePos = (): void => {
      const key = tableKeyRef.current
      if (!key) return
      const tableElem = editor.getElementByKey(key)
      if (!tableElem) return
      const pos = calcPosition(tableElem, panelRef.current)
      setPosition(pos)
    }

    updatePos()

    const rootElem = editor.getRootElement()
    const scrollParent = rootElem?.closest('.overflow-y-auto') as HTMLElement | null
    const onScroll = (): void => { requestAnimationFrame(updatePos) }

    scrollParent?.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', updatePos)

    let resizeObserver: ResizeObserver | undefined
    if (panelRef.current) {
      resizeObserver = new ResizeObserver(updatePos)
      resizeObserver.observe(panelRef.current)
    }

    return () => {
      scrollParent?.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', updatePos)
      resizeObserver?.disconnect()
    }
  }, [editor, tableKey, showPanel])

  // Maintain table highlight while panel is open
  useEffect(() => {
    if (!tableKey) return
    if (showPanel) {
      setTableHighlight(editor, tableKey, true)
    }
    return () => {
      setTableHighlight(editor, tableKey, false)
    }
  }, [editor, tableKey, showPanel])

  // Close panel on outside click
  useEffect(() => {
    if (!showPanel) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        handleClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPanel, handleClose])

  if (!tableKey) return null

  return createPortal(
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        zIndex: 9500
      }}
    >
      {showPanel ? (
        <TableAIPanel
          editor={editor}
          tableKey={tableKey}
          tableMarkdown={tableMarkdown}
          onClose={handleClose}
        />
      ) : (
        <button
          onClick={handleOpenAI}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg
                     bg-bg-popover border border-border-subtle
                     shadow-[0_2px_12px_rgba(0,0,0,0.15)]
                     text-tx-muted hover:text-accent-main hover:border-accent-main/30
                     transition-all duration-150 text-[11px] group"
          title="AI: Analyze table"
        >
          <Sparkles size={13} className="group-hover:text-accent-main transition-colors" />
          <span className="font-medium">AI</span>
        </button>
      )}
    </div>,
    document.body
  )
}

// ── AI Panel ──

function TableAIPanel({
  editor,
  tableKey,
  tableMarkdown,
  onClose
}: {
  editor: ReturnType<typeof useLexicalComposerContext>[0]
  tableKey: string
  tableMarkdown: string
  onClose: () => void
}): JSX.Element {
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() || loading) return
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const provider = useUIStore.getState().getAIProviderForFeature('chat')
      if (!provider) {
        setError('No AI provider configured. Go to Settings.')
        setLoading(false)
        return
      }

      const systemPrompt = `You are an AI assistant embedded in a markdown notes editor. The user has selected a table and wants you to help with it.

Rules:
- If the user asks you to modify/transform the table, output ONLY a valid markdown table (no explanations)
- If the user asks a question about the table, answer concisely
- For analysis requests, be structured and brief
- Always use proper markdown table syntax when outputting tables`

      const userPrompt = `Here is the table:\n\n${tableMarkdown}\n\nRequest: ${prompt}`

      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: userPrompt }
      ]

      const res = await window.api.ai.chat(provider.id, messages, 0.7, 2048)

      if (res.ok) {
        useUIStore.getState().trackAIUsage(provider.id, 'chat', res.data.usage)
        setResult(res.data.content.trim())
      } else {
        useUIStore.getState().trackAIUsage(provider.id, 'chat', undefined, true)
        setError((res as { error: string }).error)
      }
    } catch (err) {
      setError(String(err))
    }
    setLoading(false)
  }, [prompt, loading, tableMarkdown])

  const handleReplace = useCallback(() => {
    if (!result) return
    // Close first to fully unmount the portal and clear stale state
    onClose()
    // Then perform the replace in a separate update to avoid selection conflicts
    setTimeout(() => {
      editor.update(() => {
        const tableNode = $getNodeByKey(tableKey)
        if (!tableNode || !$isTableNode(tableNode)) return

        const parsed = parseMarkdownTable(result)
        if (parsed) {
          const newTable = buildTableNodeFromParsed(parsed)
          tableNode.replace(newTable)
          // Set selection into the new table's first cell
          newTable.selectStart()
        }
      })
    }, 0)
  }, [editor, tableKey, result, onClose])

  const handleCopy = useCallback(() => {
    if (result) navigator.clipboard.writeText(result)
  }, [result])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleSubmit()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    },
    [handleSubmit, onClose]
  )

  return (
    <div className="w-[340px] rounded-lg bg-bg-popover border border-border-subtle shadow-[0_4px_24px_rgba(0,0,0,0.2)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-accent-main">
          <Sparkles size={13} />
          <span>Table AI</span>
        </div>
        <button
          onClick={onClose}
          className="w-5 h-5 flex items-center justify-center rounded hover:bg-bg-hover text-tx-faint hover:text-tx-muted transition-colors"
        >
          <X size={12} />
        </button>
      </div>

      {/* Table preview */}
      <div className="px-3 py-2 border-b border-border-subtle bg-bg-app/50">
        <div className="text-[10px] text-tx-faint mb-1">Table content:</div>
        <pre className="text-[11px] text-tx-muted font-mono whitespace-pre-wrap break-words max-h-[100px] overflow-y-auto leading-relaxed scrollbar-thin">
          {tableMarkdown.length > 500 ? tableMarkdown.slice(0, 500) + '\n...' : tableMarkdown}
        </pre>
      </div>

      {/* Input */}
      <div className="px-3 py-2">
        <textarea
          ref={inputRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about this table, or describe changes..."
          className="w-full bg-transparent text-tx-main text-xs resize-none outline-none placeholder-tx-faint min-h-[40px] max-h-[80px]"
          rows={2}
          disabled={loading}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 pb-2">
          <div className="text-[10px] text-red-400 bg-red-500/10 rounded px-2 py-1">{error}</div>
        </div>
      )}

      {/* AI Result */}
      {result && (
        <div className="px-3 pb-2 border-t border-border-subtle pt-2">
          <div className="text-[10px] text-tx-faint mb-1">AI Response:</div>
          <div className="max-h-[200px] overflow-y-auto rounded bg-bg-app/50 p-2">
            <MarkdownPreview text={result} />
          </div>
          <div className="flex items-center gap-2 mt-2">
            {hasMarkdownTable(result) && (
              <button
                onClick={handleReplace}
                className="flex-1 px-2 py-1 rounded text-[11px] bg-accent-main/15 text-accent-main hover:bg-accent-main/25 transition-colors text-center"
              >
                Replace table
              </button>
            )}
            <button
              onClick={handleCopy}
              className="px-2 py-1 rounded text-[11px] bg-bg-hover text-tx-muted hover:text-tx-main transition-colors"
            >
              Copy
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-border-subtle">
        <span className="text-[9px] text-tx-faint">
          {loading ? 'Generating...' : '\u2318\u21B5 send'}
        </span>
        <button
          onClick={handleSubmit}
          disabled={!prompt.trim() || loading}
          className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] bg-accent-main/15 text-accent-main hover:bg-accent-main/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />}
          {loading ? 'Generating' : 'Send'}
        </button>
      </div>
    </div>
  )
}

// ── Markdown Preview ──

function hasMarkdownTable(text: string): boolean {
  const lines = text.trim().split('\n')
  return lines.length >= 2 && lines.some((l) => MD_TABLE_ROW_RE.test(l.trim())) && lines.some((l) => MD_TABLE_SEP_RE.test(l.trim()))
}

function MarkdownPreview({ text }: { text: string }): JSX.Element {
  // Split into blocks: tables vs plain text
  const blocks = parseBlocks(text)

  return (
    <div className="text-[11px] text-tx-main leading-relaxed space-y-2">
      {blocks.map((block, i) => {
        if (block.type === 'table') {
          return <MiniTable key={i} headers={block.headers} rows={block.rows} />
        }
        return (
          <p key={i} className="whitespace-pre-wrap break-words text-[11px] m-0">
            {renderInline(block.text)}
          </p>
        )
      })}
    </div>
  )
}

type Block =
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'text'; text: string }

function parseBlocks(text: string): Block[] {
  const lines = text.split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i].trim()

    if (MD_TABLE_ROW_RE.test(line)) {
      const tableLines: string[] = []
      let j = i
      while (j < lines.length) {
        const t = lines[j].trim()
        if (t === '' && tableLines.length > 0) break
        if (!MD_TABLE_ROW_RE.test(t) && !MD_TABLE_SEP_RE.test(t) && t !== '') break
        if (MD_TABLE_ROW_RE.test(t) || MD_TABLE_SEP_RE.test(t)) tableLines.push(t)
        j++
      }

      if (tableLines.length >= 2) {
        const parsed = parseMarkdownTable(tableLines.join('\n'))
        if (parsed) {
          blocks.push({ type: 'table', headers: parsed.headers, rows: parsed.rows })
          i = j
          continue
        }
      }
    }

    // Collect text lines
    const textLines: string[] = []
    while (i < lines.length) {
      const t = lines[i].trim()
      if (MD_TABLE_ROW_RE.test(t)) break
      textLines.push(lines[i])
      i++
    }
    const joined = textLines.join('\n').trim()
    if (joined) blocks.push({ type: 'text', text: joined })
  }

  return blocks
}

function MiniTable({ headers, rows }: { headers: string[]; rows: string[][] }): JSX.Element {
  return (
    <div className="overflow-x-auto rounded border border-border-subtle">
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="bg-bg-hover">
            {headers.map((h, i) => (
              <th key={i} className="px-2 py-1.5 text-left font-medium text-tx-main border-b border-border-subtle whitespace-nowrap">
                {renderInline(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-border-subtle last:border-b-0 hover:bg-bg-hover/50">
              {row.map((cell, ci) => (
                <td key={ci} className="px-2 py-1 text-tx-muted">
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Render inline markdown: **bold**, *italic*, `code` */
function renderInline(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = []
  // Match **bold**, *italic*, `code`
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g
  let last = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))

    if (match[2]) {
      parts.push(<strong key={match.index} className="font-semibold text-tx-main">{match[2]}</strong>)
    } else if (match[3]) {
      parts.push(<em key={match.index} className="italic">{match[3]}</em>)
    } else if (match[4]) {
      parts.push(<code key={match.index} className="px-1 py-0.5 rounded bg-bg-active text-accent-main text-[10px]">{match[4]}</code>)
    }
    last = match.index + match[0].length
  }

  if (last < text.length) parts.push(text.slice(last))
  return parts.length > 0 ? parts : [text]
}
