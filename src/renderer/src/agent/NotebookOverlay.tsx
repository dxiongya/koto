/**
 * NotebookOverlay V2 — driven entirely by the main-process agent.
 *
 * The renderer holds no source content. It subscribes to NOTEBOOK_EVENT for
 * source-pipeline status changes + pi-agent-core lifecycle events, and posts
 * user prompts via NOTEBOOK_PROMPT. Everything else (storage, retrieval,
 * grounding, tool calls) lives in main.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X, BookOpen, FilePlus2, Plus, Send, Trash2, Loader2, AlertCircle,
  CheckCircle2, Search, Settings, Sparkles,
} from 'lucide-react'
import { useUIStore } from '../store/useUIStore'
import type { Session, SourceMeta, SourceStatus, SourceRef } from '../../../shared/notebook'

const COL_SOURCES = 300
const COL_STUDIO = 320

// ─── Agent event types (subset we render) ───────────────────────────

interface RenderedMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  text: string
  /** Tool-status badge text — set when role === 'tool'. */
  toolName?: string
  /** True while the assistant is still streaming. */
  streaming?: boolean
  ts: number
}

/** Pull plain text out of a pi-ai AssistantMessage content array. */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((c) => c && typeof c === 'object' && (c as { type: string }).type === 'text')
    .map((c) => (c as { text: string }).text)
    .join('')
}

// ─── Component ──────────────────────────────────────────────────────

export const NotebookOverlay: React.FC = () => {
  const sessionId = useUIStore((s) => s.notebookSessionId)
  const setSessionId = useUIStore((s) => s.setNotebookSession)

  const [session, setSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<RenderedMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [textPickerOpen, setTextPickerOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [showGoals, setShowGoals] = useState(false)
  const chatScrollRef = useRef<HTMLDivElement>(null)

  // ── Load session on open ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    if (!sessionId) { setSession(null); setMessages([]); return }
    setError(null)
    void window.api.notebook.getSession(sessionId).then((res) => {
      if (cancelled) return
      if (res.ok) setSession(res.data)
      else setError(res.error)
    })
    // Replay chat log on open so refresh + reopen keeps history visible.
    void window.api.notebook.chatHistory(sessionId).then((res) => {
      if (cancelled || !res.ok) return
      const replayed: RenderedMessage[] = []
      for (const ev of res.data as Array<{ type?: string; message?: unknown; toolName?: string; toolCallId?: string }>) {
        applyEventToMessages(ev as never, replayed)
      }
      setMessages(replayed)
    })
    return () => { cancelled = true }
  }, [sessionId])

  // ── Subscribe to NOTEBOOK_EVENT stream ──────────────────────────
  useEffect(() => {
    if (!sessionId) return
    const off = window.api.notebook.onEvent((evt) => {
      if ((evt as { sessionId?: string }).sessionId !== sessionId) return

      if (evt.type === 'source_status') {
        const meta = (evt as unknown as { meta: SourceMeta }).meta
        setSession((s) => s ? { ...s, sources: { ...s.sources, [meta.key]: meta } } : s)
        return
      }

      if (evt.type === 'agent_event') {
        const agentEv = (evt as unknown as { event: unknown }).event
        setMessages((prev) => {
          const next = [...prev]
          applyEventToMessages(agentEv as never, next)
          return next
        })
        // Wake the send button when the run settles.
        const evType = (agentEv as { type: string }).type
        if (evType === 'agent_end') setSending(false)
      }
    })
    return off
  }, [sessionId])

  // ── Auto-scroll chat to bottom ──────────────────────────────────
  useEffect(() => {
    const el = chatScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, messages[messages.length - 1]?.text.length])

  // ── Mutations ───────────────────────────────────────────────────
  const persistSession = async (next: Session): Promise<void> => {
    setSession(next)
    await window.api.notebook.updateSession(next)
  }

  const addNoteSource = async (): Promise<void> => {
    if (!sessionId) return
    const pick = await window.api.dialog.selectFile([{ name: 'Markdown / text', extensions: ['md', 'markdown', 'txt'] }])
    if (!pick.ok || !pick.data) return
    const filePath = pick.data
    const title = filePath.split('/').pop()?.replace(/\.(md|markdown|txt)$/i, '') || 'Untitled'
    const ref: SourceRef = { kind: 'note', path: filePath }
    const res = await window.api.notebook.addSource(sessionId, ref, title, filePath)
    if (!res.ok) setError(res.error)
  }

  const addInlineSource = async (title: string, content: string): Promise<void> => {
    if (!sessionId || !content.trim()) return
    const ref: SourceRef = { kind: 'inline', content }
    const res = await window.api.notebook.addSource(sessionId, ref, title.trim() || 'Inline text', undefined)
    if (!res.ok) setError(res.error)
    setTextPickerOpen(false)
  }

  const toggleSource = async (key: string): Promise<void> => {
    if (!session) return
    const cur = session.sources[key]
    if (!cur) return
    const next: Session = { ...session, sources: { ...session.sources, [key]: { ...cur, selected: !cur.selected } } }
    await persistSession(next)
  }

  const deleteSource = async (key: string): Promise<void> => {
    if (!sessionId) return
    await window.api.notebook.removeSource(sessionId, key)
    setSession((s) => {
      if (!s) return s
      const { [key]: _omit, ...rest } = s.sources
      void _omit
      return { ...s, sources: rest }
    })
  }

  const sendPrompt = async (): Promise<void> => {
    if (!sessionId || !input.trim() || sending) return
    const ready = Object.values(session?.sources ?? {}).filter((m) => m.selected && m.status === 'ready')
    if (ready.length === 0) {
      setError('Add and select at least one source. Wait for it to reach "ready" status before asking.')
      return
    }
    setError(null)
    const text = input.trim()
    setInput('')
    setSending(true)
    const res = await window.api.notebook.prompt(sessionId, text)
    if (!res.ok) {
      setError(res.error)
      setSending(false)
    }
  }

  const updateGoals = async (goals: string): Promise<void> => {
    if (!session) return
    await persistSession({ ...session, customGoals: goals })
    setShowGoals(false)
  }

  const updateName = async (name: string): Promise<void> => {
    if (!session) return
    await persistSession({ ...session, name: name.trim() || session.name })
    setRenaming(false)
  }

  // ── Derived ─────────────────────────────────────────────────────
  const sources = useMemo(() => Object.values(session?.sources ?? {}).sort((a, b) => a.addedAt - b.addedAt), [session?.sources])
  const selectedCount = sources.filter((m) => m.selected).length
  const readyCount = sources.filter((m) => m.selected && m.status === 'ready').length

  if (!sessionId) return null

  return createPortal(
    <Backdrop onClose={() => setSessionId(null)}>
      <div className="flex flex-col h-full bg-bg-app">
        {/* Title bar */}
        <div className="flex items-center gap-3 px-5 h-12 border-b border-border-subtle shrink-0">
          <BookOpen size={16} className="text-accent-main shrink-0" />
          {renaming ? (
            <input
              autoFocus
              defaultValue={session?.name ?? ''}
              onBlur={(e) => updateName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(false) }}
              className="flex-1 bg-transparent text-tx-main text-sm font-medium outline-none"
            />
          ) : (
            <button onClick={() => setRenaming(true)} className="flex-1 text-left text-tx-main text-sm font-medium hover:text-accent-main transition-colors">
              {session?.name ?? 'Loading…'}
            </button>
          )}
          <button
            onClick={() => setShowGoals(true)}
            className="flex items-center gap-1.5 px-2 h-7 rounded text-tx-muted hover:text-tx-main hover:bg-bg-hover text-[11px] transition-colors"
            title="Custom Goals / Persona"
          >
            <Settings size={11} /> Goals
          </button>
          <span className="text-[10px] text-tx-faint shrink-0">Agent mode · ⌘⇧N</span>
          <button onClick={() => setSessionId(null)} className="w-7 h-7 flex items-center justify-center rounded text-tx-muted hover:text-tx-main hover:bg-bg-hover" title="Close (Esc)">
            <X size={14} />
          </button>
        </div>

        {/* 3-column body */}
        <div className="flex flex-1 min-h-0">
          {/* Sources */}
          <div className="flex flex-col border-r border-border-subtle shrink-0" style={{ width: COL_SOURCES }}>
            <div className="px-4 pt-4 pb-2 text-[11px] text-tx-faint uppercase tracking-wider">来源 · Sources</div>
            <div className="px-3 flex flex-col gap-2">
              <button onClick={addNoteSource} className="flex items-center gap-2 px-3 h-8 rounded bg-bg-active text-tx-main text-xs hover:bg-bg-hover transition-colors">
                <FilePlus2 size={13} className="text-accent-main" /> Add from file…
              </button>
              <button onClick={() => setTextPickerOpen(true)} className="flex items-center gap-2 px-3 h-8 rounded bg-bg-active text-tx-main text-xs hover:bg-bg-hover transition-colors">
                <Plus size={13} className="text-accent-main" /> Paste text
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-3 mt-3 scroll-thin">
              {sources.length === 0 ? (
                <div className="text-[11px] text-tx-faint px-1 py-4 leading-relaxed">
                  No sources yet. The agent stays silent until you add and process at least one.
                </div>
              ) : (
                <ul className="space-y-1 pb-3">
                  {sources.map((m) => (
                    <SourceRow key={m.key} m={m} onToggle={() => toggleSource(m.key)} onDelete={() => deleteSource(m.key)} />
                  ))}
                </ul>
              )}
            </div>
            <div className="px-4 py-2 border-t border-border-subtle text-[11px] text-tx-faint">
              {readyCount} ready · {selectedCount} selected · {sources.length} total
            </div>
          </div>

          {/* Chat */}
          <div className="flex flex-col flex-1 min-w-0">
            <div ref={chatScrollRef} className="flex-1 min-h-0 overflow-y-auto scroll-thin px-8 py-6">
              {messages.length === 0 && (
                <div className="text-tx-faint text-sm leading-relaxed max-w-2xl mx-auto py-12">
                  <Sparkles size={18} className="text-accent-main mb-3" />
                  Ask anything about your selected sources. Responses cite the
                  source they came from — click any <span className="inline-flex items-center justify-center px-1.5 h-4 rounded bg-accent-main/15 text-accent-main text-[10px] font-mono">key#p</span> badge
                  to peek at the original passage.
                </div>
              )}
              {messages.map((m) => <ChatMessageRow key={m.id} m={m} />)}
              {sending && messages[messages.length - 1]?.role !== 'assistant' && (
                <div className="flex items-center gap-2 text-tx-faint text-xs my-3">
                  <Loader2 size={12} className="animate-spin text-accent-main" /> Agent is thinking…
                </div>
              )}
              {error && (
                <div className="mt-2 px-3 py-2 rounded bg-status-error/10 border border-status-error/30 text-status-error text-xs flex items-start gap-2">
                  <AlertCircle size={12} className="mt-0.5 shrink-0" /> {error}
                </div>
              )}
            </div>
            <div className="border-t border-border-subtle px-6 py-3 shrink-0">
              <div className="relative rounded-xl bg-bg-active focus-within:ring-1 focus-within:ring-accent-main/40 transition">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void sendPrompt() }
                  }}
                  placeholder={readyCount === 0 ? 'Wait for at least one source to reach READY status…' : 'Ask anything about the selected sources…  (⌘↵ to send)'}
                  rows={2}
                  className="w-full bg-transparent text-tx-main text-sm outline-none resize-none px-4 py-3 pr-32 placeholder-tx-faint"
                />
                <div className="absolute right-3 bottom-2.5 flex items-center gap-2 text-[11px] text-tx-faint">
                  <span>{readyCount} ready</span>
                  <button
                    onClick={() => void sendPrompt()}
                    disabled={sending || !input.trim() || readyCount === 0}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-accent-main text-bg-app font-medium disabled:opacity-40 disabled:cursor-default hover:opacity-90 transition-opacity"
                  >
                    {sending ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Send
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Studio (placeholder until M9+) */}
          <div className="flex flex-col border-l border-border-subtle shrink-0" style={{ width: COL_STUDIO }}>
            <div className="px-4 pt-4 pb-2 text-[11px] text-tx-faint uppercase tracking-wider">Studio</div>
            <div className="px-3 text-[11px] text-tx-faint leading-relaxed">
              Report / Mind Map / Quiz arrive in M9+.
            </div>
          </div>
        </div>

        {/* Modals */}
        {textPickerOpen && <InlineTextModal onCancel={() => setTextPickerOpen(false)} onConfirm={addInlineSource} />}
        {showGoals && session && <GoalsModal value={session.customGoals ?? ''} onCancel={() => setShowGoals(false)} onSave={updateGoals} />}
      </div>
    </Backdrop>,
    document.body,
  )
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────

const Backdrop: React.FC<{ children: React.ReactNode; onClose: () => void }> = ({ children, onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return <div className="fixed inset-0 z-[200] bg-bg-app/95 backdrop-blur-sm" role="dialog">{children}</div>
}

const STATUS_LABEL: Record<SourceStatus, string> = {
  pending: 'queued',
  fetching: 'fetching',
  chunking: 'chunking',
  summarizing: 'summarizing',
  embedding: 'embedding',
  ready: 'ready',
  error: 'error',
}

const SourceRow: React.FC<{ m: SourceMeta; onToggle: () => void; onDelete: () => void }> = ({ m, onToggle, onDelete }) => {
  const isReady = m.status === 'ready'
  const isError = m.status === 'error'
  return (
    <li className="group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg-hover transition-colors">
      <input
        type="checkbox"
        checked={m.selected}
        onChange={onToggle}
        disabled={!isReady}
        className="w-3.5 h-3.5 accent-accent-main shrink-0 cursor-pointer disabled:opacity-40"
      />
      <span className="text-[10px] uppercase tracking-wider text-accent-main/70 font-mono shrink-0" title={m.key}>{m.key.slice(0, 8)}</span>
      <span className="flex-1 min-w-0 text-xs text-tx-main truncate" title={m.subtitle || m.title}>
        {m.title}
        {!isReady && (
          <span className={`ml-1.5 text-[9px] uppercase tracking-wider ${isError ? 'text-status-error' : 'text-tx-faint'}`}>
            {isError ? 'error' : STATUS_LABEL[m.status]}
          </span>
        )}
      </span>
      {!isReady && !isError && <Loader2 size={11} className="animate-spin text-accent-main shrink-0" />}
      {isError && <span title={m.error || 'failed'}><AlertCircle size={11} className="text-status-error shrink-0" /></span>}
      {isReady && <CheckCircle2 size={11} className="text-status-success shrink-0" />}
      <button onClick={onDelete} className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center text-tx-faint hover:text-status-error transition-all" title="Remove">
        <Trash2 size={11} />
      </button>
    </li>
  )
}

const ChatMessageRow: React.FC<{ m: RenderedMessage }> = ({ m }) => {
  if (m.role === 'tool') {
    return (
      <div className="my-2 flex items-center gap-2 text-[11px] text-tx-faint">
        <Search size={11} className="text-accent-main" />
        <span className="font-mono">{m.toolName}</span>
        {m.text && <span className="truncate max-w-[400px]">{m.text}</span>}
      </div>
    )
  }
  if (m.role === 'user') {
    return (
      <div className="mb-5 flex justify-end">
        <div className="max-w-[80%] bg-bg-active rounded-2xl rounded-tr-sm px-4 py-2.5 text-tx-main text-sm leading-relaxed whitespace-pre-wrap">
          {m.text}
        </div>
      </div>
    )
  }
  // assistant — render plain text for V2 (citation-aware renderer arrives in M7).
  return (
    <div className="mb-5">
      <div className="max-w-[92%] text-tx-main text-sm leading-relaxed whitespace-pre-wrap">
        {m.text}
        {m.streaming && <span className="inline-block w-1.5 h-3 bg-accent-main/60 animate-pulse ml-0.5 align-middle" />}
      </div>
    </div>
  )
}

const InlineTextModal: React.FC<{ onCancel: () => void; onConfirm: (title: string, content: string) => void }> = ({ onCancel, onConfirm }) => {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="w-[520px] rounded-xl bg-bg-popover border border-border-subtle shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border-subtle text-sm font-medium text-tx-main">Paste text source</div>
        <div className="px-4 py-3 space-y-2">
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className="w-full px-3 h-9 rounded bg-bg-active text-tx-main text-sm outline-none focus:ring-1 focus:ring-accent-main/40" />
          <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Paste the content…" rows={10} className="w-full px-3 py-2 rounded bg-bg-active text-tx-main text-sm outline-none focus:ring-1 focus:ring-accent-main/40 resize-none" />
        </div>
        <div className="px-4 py-3 border-t border-border-subtle flex items-center justify-end gap-2">
          <button onClick={onCancel} className="px-3 h-8 rounded text-xs text-tx-muted hover:text-tx-main">Cancel</button>
          <button onClick={() => onConfirm(title, content)} disabled={!content.trim()} className="px-3 h-8 rounded bg-accent-main text-bg-app text-xs font-medium disabled:opacity-40">Add source</button>
        </div>
      </div>
    </div>
  )
}

const GoalsModal: React.FC<{ value: string; onCancel: () => void; onSave: (v: string) => void }> = ({ value, onCancel, onSave }) => {
  const [v, setV] = useState(value)
  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="w-[640px] rounded-xl bg-bg-popover border border-border-subtle shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border-subtle text-sm font-medium text-tx-main">Custom Goals / Persona</div>
        <div className="px-4 py-3">
          <textarea value={v} onChange={(e) => setV(e.target.value)} rows={14} placeholder="e.g. Act as a rigorous research advisor. Every claim must include a precise quote from the source. Flag contradictions across sources." className="w-full px-3 py-2 rounded bg-bg-active text-tx-main text-sm outline-none focus:ring-1 focus:ring-accent-main/40 resize-none" />
          <div className="mt-1 text-[10px] text-tx-faint">Applies to chat and all Studio outputs. Up to ~10,000 chars.</div>
        </div>
        <div className="px-4 py-3 border-t border-border-subtle flex items-center justify-end gap-2">
          <button onClick={onCancel} className="px-3 h-8 rounded text-xs text-tx-muted hover:text-tx-main">Cancel</button>
          <button onClick={() => onSave(v)} className="px-3 h-8 rounded bg-accent-main text-bg-app text-xs font-medium">Save</button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Event → message folder
// ─────────────────────────────────────────────────────────────────────

interface PiMessage {
  role: 'user' | 'assistant' | 'toolResult'
  content?: unknown
  timestamp?: number
  toolName?: string
  toolCallId?: string
}

interface PiAgentEvent {
  type: string
  message?: PiMessage
  toolName?: string
  toolCallId?: string
  args?: unknown
}

function applyEventToMessages(event: PiAgentEvent, list: RenderedMessage[]): void {
  switch (event.type) {
    case 'message_start': {
      const msg = event.message
      if (!msg) return
      if (msg.role === 'user') {
        list.push({ id: `u-${list.length}-${msg.timestamp ?? Date.now()}`, role: 'user', text: extractText(msg.content), ts: msg.timestamp ?? Date.now() })
        return
      }
      if (msg.role === 'assistant') {
        list.push({ id: `a-${list.length}-${msg.timestamp ?? Date.now()}`, role: 'assistant', text: '', streaming: true, ts: msg.timestamp ?? Date.now() })
      }
      return
    }
    case 'message_update': {
      const msg = event.message
      if (!msg || msg.role !== 'assistant') return
      const last = list[list.length - 1]
      if (!last || last.role !== 'assistant' || !last.streaming) return
      last.text = extractText(msg.content)
      return
    }
    case 'message_end': {
      const msg = event.message
      if (!msg) return
      if (msg.role === 'assistant') {
        const last = list[list.length - 1]
        if (last && last.role === 'assistant') {
          last.text = extractText(msg.content)
          last.streaming = false
        }
        return
      }
      if (msg.role === 'toolResult') {
        // Tool results are summarized in the inline tool row already; skip.
        return
      }
      return
    }
    case 'tool_execution_start': {
      list.push({ id: `t-${list.length}-${Date.now()}`, role: 'tool', toolName: event.toolName ?? 'tool', text: '', ts: Date.now() })
      return
    }
    case 'tool_execution_end': {
      // Backfill last tool row with brief details.
      const tail = [...list].reverse().find((m) => m.role === 'tool' && m.toolName === event.toolName)
      if (tail) tail.text = '…done'
      return
    }
  }
}
