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
import { Sparkles, Send, Loader2, X, ChevronRight, ChevronDown, CheckCircle2, Timer } from 'lucide-react'
import { useUIStore } from '../../../store/useUIStore'
import { parseMarkdownTable, buildTableNodeFromParsed, MD_TABLE_ROW_RE, MD_TABLE_SEP_RE } from '../utils/markdownTable'
import type { AutomationInterval } from '../../../../../shared/types'

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
  const [showAutomation, setShowAutomation] = useState(false)
  const [tableMarkdown, setTableMarkdown] = useState('')
  const [tableHeaders, setTableHeaders] = useState('') // pipe-separated header text
  const panelRef = useRef<HTMLDivElement>(null)
  const tableKeyRef = useRef<string | null>(null)
  const draggedRef = useRef(false) // true after user drags — stops auto-positioning

  // ── Callbacks (declared before effects that reference them) ──

  const handleClose = useCallback(() => {
    if (tableKey) setTableHighlight(editor, tableKey, false)
    draggedRef.current = false
    setShowPanel(false)
    setShowAutomation(false)
    setTableMarkdown('')
    setTableHeaders('')
    setTableKey(null)
  }, [editor, tableKey])

  // Extract table markdown + headers from the current table node
  const readTableData = useCallback(() => {
    if (!tableKey) return { md: '', headers: '' }
    let md = ''
    let headers = ''
    editor.getEditorState().read(() => {
      const table = $getNodeByKey(tableKey)
      if (!table || !$isTableNode(table)) return
      md = $tableToMarkdown(table)
      // Extract header row cells
      const rows = table.getChildren()
      if (rows.length > 0) {
        const firstRow = rows[0]
        if ($isTableRowNode(firstRow)) {
          headers = firstRow.getChildren()
            .filter($isTableCellNode)
            .map((cell) => cell.getTextContent().trim())
            .join('|')
        }
      }
    })
    return { md, headers }
  }, [editor, tableKey])

  const handleOpenAI = useCallback(() => {
    const { md, headers } = readTableData()
    if (!md) return
    setTableMarkdown(md)
    setTableHeaders(headers)
    setShowPanel(true)
  }, [readTableData])

  const handleOpenAutomation = useCallback(() => {
    const { md, headers } = readTableData()
    if (!md) return
    setTableMarkdown(md)
    setTableHeaders(headers)
    setShowAutomation(true)
  }, [readTableData])

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
      if (draggedRef.current) return // user dragged — keep their position
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
    if (showPanel || showAutomation) {
      setTableHighlight(editor, tableKey, true)
    }
    return () => {
      setTableHighlight(editor, tableKey, false)
    }
  }, [editor, tableKey, showPanel])

  // Close panel on outside click
  useEffect(() => {
    if (!showPanel && !showAutomation) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        handleClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPanel, showAutomation, handleClose])

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
          position={position}
          onDrag={(newPos) => { draggedRef.current = true; setPosition(newPos) }}
        />
      ) : showAutomation ? (
        <TableAutomationPanel
          tableHeaders={tableHeaders}
          onClose={handleClose}
          position={position}
          onDrag={(newPos) => { draggedRef.current = true; setPosition(newPos) }}
        />
      ) : (
        <div className="flex items-center gap-1">
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
          <button
            onClick={handleOpenAutomation}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg
                       bg-bg-popover border border-border-subtle
                       shadow-[0_2px_12px_rgba(0,0,0,0.15)]
                       text-tx-muted hover:text-status-warning hover:border-orange-400/30
                       transition-all duration-150 text-[11px] group"
            title="Set up scheduled automation"
          >
            <Timer size={13} className="group-hover:text-status-warning transition-colors" />
          </button>
        </div>
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
  onClose,
  position,
  onDrag
}: {
  editor: ReturnType<typeof useLexicalComposerContext>[0]
  tableKey: string
  tableMarkdown: string
  onClose: () => void
  position: { top: number; left: number }
  onDrag: (pos: { top: number; left: number }) => void
}): JSX.Element {
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [toolEvents, setToolEvents] = useState<Array<{
    toolName: string
    status: 'running' | 'done'
    toolInput?: Record<string, unknown>
    result?: string
    durationMs?: number
  }>>([])
  const [expandedTool, setExpandedTool] = useState<number | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  // ── Drag header to reposition ──
  const handleHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const startPos = { ...position }

    const onMove = (ev: MouseEvent): void => {
      onDrag({
        top: startPos.top + (ev.clientY - startY),
        left: startPos.left + (ev.clientX - startX),
      })
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [position, onDrag])

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() || loading) return
    setLoading(true)
    setError(null)
    setResult(null)
    setToolEvents([])
    setExpandedTool(null)

    try {
      const routed = useUIStore.getState().getAIProviderForFeature('chat')
      if (!routed) {
        setError('No AI provider configured. Go to Settings.')
        setLoading(false)
        return
      }
      const { provider, model } = routed

      const activeFilePath = useUIStore.getState().getActiveFilePath() || ''
      const systemPrompt = `## Context
- Active file: ${activeFilePath}
- Mode: TABLE (your output modifies or analyzes the selected table)

## Table-specific rules
- If modifying the table, output ONLY a valid markdown table (no explanations)
- If answering a question, be concise
- Always use proper markdown table syntax`

      const userPrompt = `Here is the table:\n\n${tableMarkdown}\n\nRequest: ${prompt}`

      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: userPrompt }
      ]

      // Subscribe to tool events for real-time status
      const unsubToolEvent = window.api.ai.onToolEvent((event) => {
        if (event.type === 'tool_start') {
          setToolEvents((prev) => [...prev, {
            toolName: event.toolName,
            status: 'running',
            toolInput: event.toolInput,
          }])
        } else if (event.type === 'tool_result') {
          setToolEvents((prev) => {
            const updated = [...prev]
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].toolName === event.toolName && updated[i].status === 'running') {
                updated[i] = { ...updated[i], status: 'done', result: event.result, durationMs: event.durationMs }
                break
              }
            }
            return updated
          })
        }
      })

      const res = await window.api.ai.chat(provider.id, messages, 0.7, 2048, true, model)
      unsubToolEvent()

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
      {/* Header — draggable */}
      <div
        onMouseDown={handleHeaderMouseDown}
        className="flex items-center justify-between px-3 py-2 border-b border-border-subtle cursor-grab active:cursor-grabbing select-none"
      >
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-accent-main">
          <Sparkles size={13} />
          <span>Table AI</span>
        </div>
        <button
          onClick={onClose}
          onMouseDown={(e) => e.stopPropagation()}
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
          <div className="text-[10px] text-status-error bg-status-error/10 rounded px-2 py-1">{error}</div>
        </div>
      )}

      {/* Tool Events */}
      {toolEvents.length > 0 && (
        <div className="px-3 pb-2 border-t border-border-subtle pt-2">
          <div className="text-[10px] text-tx-faint mb-1">Tool calls:</div>
          <div className="space-y-1">
            {toolEvents.map((te, i) => (
              <div key={i} className="rounded bg-bg-app/50 border border-border-subtle overflow-hidden">
                <button
                  onClick={() => setExpandedTool(expandedTool === i ? null : i)}
                  className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] hover:bg-bg-hover transition-colors"
                >
                  {te.status === 'running' ? (
                    <Loader2 size={10} className="animate-spin text-accent-main shrink-0" />
                  ) : (
                    <CheckCircle2 size={10} className="text-status-success shrink-0" />
                  )}
                  <span className="text-tx-main font-mono truncate">{te.toolName}</span>
                  {te.durationMs != null && (
                    <span className="text-tx-faint ml-auto shrink-0">{te.durationMs}ms</span>
                  )}
                  {expandedTool === i ? <ChevronDown size={10} className="text-tx-faint shrink-0" /> : <ChevronRight size={10} className="text-tx-faint shrink-0" />}
                </button>
                {expandedTool === i && (
                  <div className="px-2 pb-1.5 border-t border-border-subtle">
                    {te.toolInput && (
                      <div className="mt-1">
                        <div className="text-[9px] text-tx-faint">Input:</div>
                        <pre className="text-[9px] text-tx-muted font-mono whitespace-pre-wrap break-all max-h-[60px] overflow-y-auto">
                          {Object.entries(te.toolInput).map(([k, v]) =>
                            `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`
                          ).join('\n')}
                        </pre>
                      </div>
                    )}
                    {te.result && (
                      <div className="mt-1">
                        <div className="text-[9px] text-tx-faint">Result:</div>
                        <pre className="text-[9px] text-tx-muted font-mono whitespace-pre-wrap break-all max-h-[60px] overflow-y-auto">
                          {te.result.length > 500 ? te.result.slice(0, 500) + '...' : te.result}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
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

// ── Table Automation Panel ──

const AUTOMATION_INTERVALS: Array<{ value: AutomationInterval; label: string }> = [
  { value: 5, label: '5m' },
  { value: 15, label: '15m' },
  { value: 30, label: '30m' },
  { value: 60, label: '1h' },
  { value: 360, label: '6h' },
  { value: 720, label: '12h' },
  { value: 1440, label: '24h' },
]

function TableAutomationPanel({
  tableHeaders,
  onClose,
  position,
  onDrag,
}: {
  tableHeaders: string
  onClose: () => void
  position: { top: number; left: number }
  onDrag: (pos: { top: number; left: number }) => void
}): JSX.Element {
  const [prompt, setPrompt] = useState('')
  const [interval, setInterval] = useState<AutomationInterval>(60)
  const [creating, setCreating] = useState(false)
  const [done, setDone] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const activeFilePath = useUIStore.getState().getActiveFilePath()

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  const handleHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const startPos = { ...position }
    const onMove = (ev: MouseEvent): void => {
      onDrag({ top: startPos.top + (ev.clientY - startY), left: startPos.left + (ev.clientX - startX) })
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [position, onDrag])

  const handleCreate = useCallback(async () => {
    if (!prompt.trim() || !activeFilePath || creating) return
    setCreating(true)

    // Use 'default' — runner will resolve from featureRouting.chat
    const providerId = 'default'

    // Auto-generate a name from prompt
    const name = prompt.trim().slice(0, 40) + (prompt.length > 40 ? '...' : '')

    await window.api.automation.create({
      name,
      target: {
        type: 'table' as const,
        filePath: activeFilePath,
        tableIdentifier: tableHeaders,
      },
      promptTemplate: prompt,
      interval,
      providerId,
      enableTools: true,
      enabled: true,
    })

    setCreating(false)
    setDone(true)
    setTimeout(onClose, 1500)
  }, [prompt, interval, activeFilePath, tableHeaders, creating, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleCreate()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }, [handleCreate, onClose])

  return (
    <div className="w-[320px] rounded-lg bg-bg-popover border border-border-subtle shadow-[0_4px_24px_rgba(0,0,0,0.2)] overflow-hidden">
      {/* Header — draggable */}
      <div
        onMouseDown={handleHeaderMouseDown}
        className="flex items-center justify-between px-3 py-2 border-b border-border-subtle cursor-grab active:cursor-grabbing select-none"
      >
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-status-warning">
          <Timer size={13} />
          <span>Schedule Update</span>
        </div>
        <button
          onClick={onClose}
          onMouseDown={(e) => e.stopPropagation()}
          className="w-5 h-5 flex items-center justify-center rounded hover:bg-bg-hover text-tx-faint hover:text-tx-muted transition-colors"
        >
          <X size={12} />
        </button>
      </div>

      {done ? (
        <div className="px-3 py-6 text-center">
          <CheckCircle2 size={20} className="text-status-success mx-auto mb-2" />
          <div className="text-xs text-tx-main">Automation created!</div>
          <div className="text-[10px] text-tx-faint mt-1">Manage in Settings → Automations</div>
        </div>
      ) : (
        <>
          {/* Table identifier (auto-detected, read-only) */}
          <div className="px-3 pt-2">
            <div className="px-2 py-1 rounded bg-bg-active text-[10px] text-tx-faint font-mono truncate">
              Table: {tableHeaders.split('|').join(' | ')}
            </div>
          </div>

          {/* Prompt */}
          <div className="px-3 pt-2">
            <textarea
              ref={inputRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Tell AI what to update, e.g., 'Fetch latest crypto prices using xapi and update this table'"
              className="w-full bg-transparent text-tx-main text-xs resize-none outline-none placeholder-tx-faint min-h-[50px] max-h-[100px]"
              rows={3}
              disabled={creating}
            />
          </div>

          {/* Interval selector */}
          <div className="px-3 pb-2">
            <div className="text-[10px] text-tx-faint mb-1">Run every:</div>
            <div className="flex flex-wrap gap-1">
              {AUTOMATION_INTERVALS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setInterval(opt.value)}
                  className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                    interval === opt.value
                      ? 'bg-orange-400/15 text-status-warning'
                      : 'bg-bg-hover text-tx-faint hover:text-tx-muted'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between px-3 py-2 border-t border-border-subtle">
            <span className="text-[9px] text-tx-faint">⌘↵ create</span>
            <button
              onClick={handleCreate}
              disabled={!prompt.trim() || creating}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] bg-orange-400/15 text-status-warning hover:bg-orange-400/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {creating ? <Loader2 size={10} className="animate-spin" /> : <Timer size={10} />}
              {creating ? 'Creating...' : 'Start'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
