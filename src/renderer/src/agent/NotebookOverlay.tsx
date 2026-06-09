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
  CheckCircle2, Search, Settings, Sparkles, Globe, Link as LinkIcon,
  Compass, FileEdit, Presentation, FileText, ChevronRight, Bookmark,
  Recycle,
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

interface CitationTarget { sourceKey: string; passageId: string }

const CITATION_RE = /\[src:([A-Za-z0-9_-]+)#([A-Za-z0-9]+)\]/g

/** Walk a piece of assistant text and produce React nodes where every
 *  `[src:key#pId]` marker is replaced by a clickable numbered badge.
 *  Numbers are assigned per-(key, passageId) first-appearance order. */
function renderWithCitations(
  text: string,
  sessionId: string,
  onOpen: (t: CitationTarget, ev: React.MouseEvent) => void,
): React.ReactNode {
  const order: CitationTarget[] = []
  const numFor = (key: string, pid: string): number => {
    const idx = order.findIndex((t) => t.sourceKey === key && t.passageId === pid)
    if (idx >= 0) return idx + 1
    order.push({ sourceKey: key, passageId: pid })
    return order.length
  }

  const parts: React.ReactNode[] = []
  let lastIdx = 0
  let m: RegExpExecArray | null
  let key = 0
  CITATION_RE.lastIndex = 0
  while ((m = CITATION_RE.exec(text)) !== null) {
    const sourceKey = m[1]
    const passageId = m[2]
    const n = numFor(sourceKey, passageId)
    parts.push(text.slice(lastIdx, m.index))
    parts.push(
      <button
        key={`c-${key++}-${n}`}
        onClick={(e) => onOpen({ sourceKey, passageId }, e)}
        className="inline-flex items-center justify-center mx-0.5 px-1.5 h-4 rounded bg-accent-main/15 text-accent-main text-[10px] font-mono align-middle hover:bg-accent-main/25 transition-colors"
        title={`${sourceKey} · ${passageId}`}
      >
        {n}
      </button>,
    )
    lastIdx = m.index + m[0].length
  }
  parts.push(text.slice(lastIdx))
  void sessionId
  return parts
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
  const [discoverOpen, setDiscoverOpen] = useState(false)
  const [urlOpen, setUrlOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [showGoals, setShowGoals] = useState(false)
  const [citationPop, setCitationPop] = useState<{ target: CitationTarget; x: number; y: number } | null>(null)
  const [studioOpen, setStudioOpen] = useState<null | { kind: 'report' | 'slides' }>(null)
  const [studioRunning, setStudioRunning] = useState<null | 'report' | 'slides'>(null)
  const [expandedSource, setExpandedSource] = useState<string | null>(null)
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

      if (evt.type === 'briefing_ready') {
        const briefing = (evt as unknown as { briefing: string }).briefing
        setSession((s) => s ? { ...s, briefing } : s)
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

  const importUrl = async (url: string, title?: string): Promise<void> => {
    if (!sessionId) return
    const u = url.trim()
    if (!/^https?:\/\//i.test(u)) { setError('URL must start with http(s)://'); return }
    const res = await window.api.notebook.importUrl(sessionId, u, title?.trim() || undefined)
    if (!res.ok) setError(res.error)
    setUrlOpen(false)
  }

  const importDiscoveryPicks = async (picks: Array<{ url: string; title: string }>): Promise<void> => {
    if (!sessionId) return
    for (const p of picks) {
      const res = await window.api.notebook.importUrl(sessionId, p.url, p.title)
      if (!res.ok) { setError(res.error); return }
    }
    setDiscoverOpen(false)
  }

  const runStudio = async (kind: 'report' | 'slides', preset: string, brief: string): Promise<void> => {
    if (!sessionId) return
    const ready = Object.values(session?.sources ?? {}).filter((m) => m.selected && m.status === 'ready')
    if (ready.length === 0) { setError('Add and select at least one ready source first.'); return }
    setError(null); setStudioRunning(kind); setStudioOpen(null)
    const fn = kind === 'report' ? window.api.notebook.generateReport : window.api.notebook.generateSlides
    const res = await fn(sessionId, preset, brief || undefined)
    setStudioRunning(null)
    if (!res.ok) { setError(res.error); return }
    // Refresh session to pick up products[] update.
    const refresh = await window.api.notebook.getSession(sessionId)
    if (refresh.ok) setSession(refresh.data)
  }

  const saveAssistantMessage = async (text: string): Promise<void> => {
    if (!session) return
    const note = { id: `n${Date.now()}`, text, createdAt: Date.now() }
    await persistSession({ ...session, savedNotes: [...(session.savedNotes ?? []), note] })
  }

  const removeSavedNote = async (noteId: string): Promise<void> => {
    if (!session) return
    await persistSession({ ...session, savedNotes: (session.savedNotes ?? []).filter((n) => n.id !== noteId) })
  }

  const convertSavedNotesToSource = async (): Promise<void> => {
    if (!sessionId || !session || (session.savedNotes ?? []).length === 0) return
    const stamp = new Date().toLocaleString()
    const content = (session.savedNotes ?? [])
      .map((n, i) => `### Saved note ${i + 1}\n\n${n.text}`)
      .join('\n\n---\n\n')
    const ref: SourceRef = { kind: 'inline', content }
    const res = await window.api.notebook.addSource(sessionId, ref, `Saved notes · ${stamp}`, `${session.savedNotes.length} note(s)`)
    if (!res.ok) { setError(res.error); return }
    // Clear the buffer so users see a clean slate after conversion.
    await persistSession({ ...session, savedNotes: [] })
  }

  const openProduct = (notePath: string): void => {
    // Drop into Notes app at the generated file. Closes overlay so the user
    // sees the document immediately.
    useUIStore.getState().setCurrentApp('notes.app')
    const store = useUIStore.getState()
    const apps = store.appStates as Record<string, { activeFilePath: string | null; expandedPaths: string[] }>
    useUIStore.setState({
      appStates: { ...apps, 'notes.app': { ...(apps['notes.app'] ?? { expandedPaths: [] }), activeFilePath: notePath } } as never,
    })
    setSessionId(null)
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
              <button onClick={() => setDiscoverOpen(true)} className="flex items-center gap-2 px-3 h-8 rounded bg-accent-main/10 text-accent-main text-xs hover:bg-accent-main/15 transition-colors font-medium">
                <Compass size={13} /> Discover web sources
              </button>
              <button onClick={() => setUrlOpen(true)} className="flex items-center gap-2 px-3 h-8 rounded bg-bg-active text-tx-main text-xs hover:bg-bg-hover transition-colors">
                <LinkIcon size={13} className="text-accent-main" /> Add a URL
              </button>
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
                    <SourceRow
                      key={m.key}
                      m={m}
                      expanded={expandedSource === m.key}
                      onToggle={() => toggleSource(m.key)}
                      onDelete={() => deleteSource(m.key)}
                      onClickRow={() => setExpandedSource((cur) => cur === m.key ? null : m.key)}
                      onAskQuestion={(q) => { setInput(q); setExpandedSource(null) }}
                      onReprocess={() => sessionId && window.api.notebook.reprocessSource(sessionId, m.key)}
                    />
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
              {session?.briefing && (
                <div className="mb-6 rounded-lg border border-accent-main/25 bg-accent-main/5 px-4 py-3 max-w-[92%]">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-accent-main mb-1.5">
                    <Sparkles size={11} /> Notebook Guide
                  </div>
                  <div className="text-tx-main text-sm leading-relaxed whitespace-pre-wrap">
                    {renderWithCitations(session.briefing, sessionId, (t, e) => setCitationPop({ target: t, x: e.clientX, y: e.clientY }))}
                  </div>
                </div>
              )}
              {messages.length === 0 && !session?.briefing && (
                <div className="text-tx-faint text-sm leading-relaxed max-w-2xl mx-auto py-12">
                  <Sparkles size={18} className="text-accent-main mb-3" />
                  Ask anything about your selected sources. Responses cite the
                  source they came from — click any <span className="inline-flex items-center justify-center px-1.5 h-4 rounded bg-accent-main/15 text-accent-main text-[10px] font-mono">key#p</span> badge
                  to peek at the original passage.
                </div>
              )}
              {messages.map((m) => (
                <ChatMessageRow
                  key={m.id}
                  m={m}
                  sessionId={sessionId}
                  onCitationClick={(t, e) => setCitationPop({ target: t, x: e.clientX, y: e.clientY })}
                  onSave={m.role === 'assistant' && !m.streaming ? () => saveAssistantMessage(m.text) : undefined}
                />
              ))}
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

          {/* Studio */}
          <div className="flex flex-col border-l border-border-subtle shrink-0" style={{ width: COL_STUDIO }}>
            <div className="px-4 pt-4 pb-2 text-[11px] text-tx-faint uppercase tracking-wider">Studio</div>
            <div className="px-3 grid grid-cols-1 gap-2">
              <StudioCard
                icon={<FileEdit size={14} />}
                title="Report / article"
                subtitle="Briefing · academic · FAQ · study guide · blog"
                running={studioRunning === 'report'}
                disabled={readyCount === 0 || studioRunning != null}
                onClick={() => setStudioOpen({ kind: 'report' })}
              />
              <StudioCard
                icon={<Presentation size={14} />}
                title="Slide deck (PPT)"
                subtitle="Markdown slides, opens in Notes"
                running={studioRunning === 'slides'}
                disabled={readyCount === 0 || studioRunning != null}
                onClick={() => setStudioOpen({ kind: 'slides' })}
              />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto scroll-thin px-3 mt-4">
              {(session?.savedNotes ?? []).length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center justify-between px-1 mb-1">
                    <span className="text-[10px] text-tx-faint uppercase tracking-wider">Saved notes</span>
                    <button
                      onClick={() => void convertSavedNotesToSource()}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-accent-main hover:bg-accent-main/10"
                      title="Combine all saved notes into a new source"
                    >
                      <Recycle size={10} /> Convert to source
                    </button>
                  </div>
                  <ul className="space-y-1">
                    {(session?.savedNotes ?? []).map((n) => (
                      <li key={n.id} className="group flex items-start gap-1.5 px-2 py-1.5 rounded hover:bg-bg-hover">
                        <Bookmark size={10} className="text-accent-main shrink-0 mt-0.5" />
                        <span className="flex-1 min-w-0 text-[11px] text-tx-muted line-clamp-2">{n.text}</span>
                        <button onClick={() => void removeSavedNote(n.id)} className="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center text-tx-faint hover:text-status-error">
                          <X size={9} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="text-[10px] text-tx-faint uppercase tracking-wider px-1 mb-1">Products</div>
              {(session?.products ?? []).length === 0 ? (
                <div className="text-[11px] text-tx-faint px-1 py-2">No outputs yet.</div>
              ) : (
                <ul className="space-y-1 pb-3">
                  {[...(session?.products ?? [])].reverse().map((p) => (
                    <li key={p.id}>
                      <button onClick={() => openProduct(p.targetPath)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg-hover text-left text-xs text-tx-main transition-colors">
                        {p.type === 'slide-deck' ? <Presentation size={12} className="text-accent-main shrink-0" /> : <FileText size={12} className="text-accent-main shrink-0" />}
                        <span className="truncate flex-1">{p.label}</span>
                        <ChevronRight size={11} className="text-tx-faint shrink-0" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Modals */}
        {textPickerOpen && <InlineTextModal onCancel={() => setTextPickerOpen(false)} onConfirm={addInlineSource} />}
        {urlOpen && <UrlModal onCancel={() => setUrlOpen(false)} onConfirm={importUrl} />}
        {discoverOpen && <DiscoverModal onCancel={() => setDiscoverOpen(false)} onImport={importDiscoveryPicks} />}
        {showGoals && session && <GoalsModal value={session.customGoals ?? ''} onCancel={() => setShowGoals(false)} onSave={updateGoals} />}
        {citationPop && <CitationPopover sessionId={sessionId} target={citationPop.target} x={citationPop.x} y={citationPop.y} sources={session?.sources ?? {}} onClose={() => setCitationPop(null)} />}
        {studioOpen && <StudioModal kind={studioOpen.kind} onCancel={() => setStudioOpen(null)} onRun={(preset, brief) => runStudio(studioOpen.kind, preset, brief)} />}
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

const SourceRow: React.FC<{
  m: SourceMeta
  expanded: boolean
  onToggle: () => void
  onDelete: () => void
  onClickRow: () => void
  onAskQuestion: (q: string) => void
  onReprocess: () => void
}> = ({ m, expanded, onToggle, onDelete, onClickRow, onAskQuestion, onReprocess }) => {
  const isReady = m.status === 'ready'
  const isError = m.status === 'error'
  return (
    <li>
      <div
        onClick={onClickRow}
        className={`group flex items-center gap-2 px-2 py-1.5 rounded transition-colors cursor-pointer ${expanded ? 'bg-bg-active' : 'hover:bg-bg-hover'}`}
      >
        <input
          type="checkbox"
          checked={m.selected}
          onChange={onToggle}
          disabled={!isReady}
          onClick={(e) => e.stopPropagation()}
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
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center text-tx-faint hover:text-status-error transition-all"
          title="Remove"
        >
          <Trash2 size={11} />
        </button>
      </div>
      {expanded && (
        <div className="mx-2 mb-1.5 mt-0.5 px-3 py-2.5 rounded bg-bg-popover border border-border-subtle text-[11px] leading-relaxed">
          {m.subtitle && (
            <div className="font-mono text-[10px] text-tx-faint break-all mb-1.5">{m.subtitle}</div>
          )}
          {isError && (
            <div className="text-status-error mb-2">Failed: {m.error || 'unknown'}</div>
          )}
          {m.summary ? (
            <div className="text-tx-muted mb-2">{m.summary}</div>
          ) : isReady ? (
            <div className="text-tx-faint italic mb-2">No summary generated. Reprocess to retry.</div>
          ) : (
            <div className="text-tx-faint italic mb-2">Summary will appear when processing completes.</div>
          )}
          {m.topics && m.topics.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {m.topics.map((t, i) => (
                <span key={i} className="px-1.5 py-0.5 rounded bg-bg-active text-[10px] text-tx-muted">{t}</span>
              ))}
            </div>
          )}
          {m.suggestedQuestions && m.suggestedQuestions.length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] text-tx-faint uppercase tracking-wider mb-1">Suggested questions</div>
              <div className="flex flex-col gap-1">
                {m.suggestedQuestions.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => onAskQuestion(q)}
                    className="text-left text-[11px] text-tx-main hover:text-accent-main px-2 py-1 rounded hover:bg-bg-hover transition-colors"
                  >
                    → {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 mt-2.5 pt-2 border-t border-border-subtle">
            <span className="text-[10px] text-tx-faint">
              {m.passageCount ?? 0} passages
              {m.embeddingDim ? ` · ${m.embeddingDim}d embeddings` : ' · keyword only'}
              {m.rawBytes ? ` · ${Math.round(m.rawBytes / 1024)}KB` : ''}
            </span>
            <button onClick={onReprocess} className="ml-auto text-[10px] text-tx-muted hover:text-tx-main">Reprocess</button>
          </div>
        </div>
      )}
    </li>
  )
}

const ChatMessageRow: React.FC<{
  m: RenderedMessage
  sessionId: string
  onCitationClick: (t: CitationTarget, e: React.MouseEvent) => void
  onSave?: () => void
}> = ({ m, sessionId, onCitationClick, onSave }) => {
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
  return (
    <div className="mb-5 group">
      <div className="max-w-[92%] text-tx-main text-sm leading-relaxed whitespace-pre-wrap">
        {renderWithCitations(m.text, sessionId, onCitationClick)}
        {m.streaming && <span className="inline-block w-1.5 h-3 bg-accent-main/60 animate-pulse ml-0.5 align-middle" />}
      </div>
      {onSave && (
        <div className="mt-1 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onSave}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-tx-muted hover:text-accent-main hover:bg-bg-hover"
            title="Save to notebook notes"
          >
            <Bookmark size={10} /> Save
          </button>
        </div>
      )}
    </div>
  )
}

const CitationPopover: React.FC<{
  sessionId: string
  target: CitationTarget
  x: number; y: number
  sources: Record<string, SourceMeta>
  onClose: () => void
}> = ({ sessionId, target, x, y, sources, onClose }) => {
  const [passage, setPassage] = useState<{ text: string; start: number; end: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const source = sources[target.sourceKey]

  useEffect(() => {
    let cancelled = false
    void window.api.notebook.getPassage(sessionId, target.sourceKey, target.passageId).then((res) => {
      if (cancelled) return
      if (res.ok) setPassage({ text: res.data.text, start: res.data.start, end: res.data.end })
      else setError(res.error)
    })
    const onAny = (e: MouseEvent): void => {
      // Close when clicking outside the popover element.
      const el = (e.target as HTMLElement | null)?.closest('[data-citation-popover]')
      if (!el) onClose()
    }
    window.addEventListener('mousedown', onAny)
    return () => { cancelled = true; window.removeEventListener('mousedown', onAny) }
  }, [sessionId, target.sourceKey, target.passageId, onClose])

  const left = Math.min(x, window.innerWidth - 440)
  const top = Math.min(y + 14, window.innerHeight - 320)

  return (
    <div
      data-citation-popover
      className="fixed z-[230] w-[420px] max-h-[320px] rounded-lg bg-bg-popover border border-border-subtle shadow-2xl overflow-hidden flex flex-col"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
        <span className="text-[10px] font-mono text-accent-main">{target.sourceKey}#{target.passageId}</span>
        <span className="flex-1 text-xs text-tx-main truncate">{source?.title ?? 'Unknown source'}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 text-[12px] text-tx-muted whitespace-pre-wrap leading-relaxed">
        {error ? <span className="text-status-error">{error}</span>
          : passage ? passage.text
          : <span className="text-tx-faint">Loading…</span>}
      </div>
      {passage && (
        <div className="px-3 py-1.5 text-[10px] text-tx-faint border-t border-border-subtle font-mono">
          chars {passage.start}–{passage.end}
        </div>
      )}
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

const UrlModal: React.FC<{ onCancel: () => void; onConfirm: (url: string, title?: string) => void }> = ({ onCancel, onConfirm }) => {
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="w-[520px] rounded-xl bg-bg-popover border border-border-subtle shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border-subtle text-sm font-medium text-tx-main">Add a URL</div>
        <div className="px-4 py-3 space-y-2">
          <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="w-full px-3 h-9 rounded bg-bg-active text-tx-main text-sm font-mono outline-none focus:ring-1 focus:ring-accent-main/40" />
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Custom title (optional)" className="w-full px-3 h-9 rounded bg-bg-active text-tx-main text-sm outline-none focus:ring-1 focus:ring-accent-main/40" />
          <div className="text-[10px] text-tx-faint">We'll fetch the page through Jina Reader and add it to this notebook's Collector group.</div>
        </div>
        <div className="px-4 py-3 border-t border-border-subtle flex items-center justify-end gap-2">
          <button onClick={onCancel} className="px-3 h-8 rounded text-xs text-tx-muted hover:text-tx-main">Cancel</button>
          <button onClick={() => onConfirm(url, title)} disabled={!url.trim()} className="px-3 h-8 rounded bg-accent-main text-bg-app text-xs font-medium disabled:opacity-40">Import</button>
        </div>
      </div>
    </div>
  )
}

interface DiscoveryResultUI { title: string; url: string; snippet?: string; selected: boolean }

const DiscoverModal: React.FC<{ onCancel: () => void; onImport: (picks: Array<{ url: string; title: string }>) => void }> = ({ onCancel, onImport }) => {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DiscoveryResultUI[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  const search = async (): Promise<void> => {
    if (!query.trim()) return
    setError(null); setLoading(true); setResults([])
    const res = await window.api.notebook.discoverWeb(query, 10)
    if (!res.ok) setError(res.error)
    else setResults(res.data.map((r) => ({ ...r, selected: true })))
    setLoading(false)
  }

  const toggle = (i: number): void => setResults((rs) => rs.map((r, idx) => idx === i ? { ...r, selected: !r.selected } : r))
  const picked = results.filter((r) => r.selected)

  const doImport = async (): Promise<void> => {
    if (picked.length === 0) return
    setImporting(true)
    await onImport(picked.map((p) => ({ url: p.url, title: p.title })))
    setImporting(false)
  }

  return (
    <div className="fixed inset-0 z-[210] flex items-start justify-center pt-[8vh] bg-black/40" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="w-[680px] max-h-[80vh] rounded-xl bg-bg-popover border border-border-subtle shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center gap-2 px-4 h-12 border-b border-border-subtle shrink-0">
          <Compass size={14} className="text-accent-main" />
          <span className="text-sm font-medium text-tx-main">Discover web sources</span>
          <button onClick={onCancel} className="ml-auto w-6 h-6 flex items-center justify-center rounded text-tx-faint hover:text-tx-main hover:bg-bg-hover"><X size={12} /></button>
        </div>
        <div className="px-4 py-3 border-b border-border-subtle shrink-0">
          <div className="flex items-center gap-2">
            <Globe size={13} className="text-tx-faint shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void search() }}
              placeholder="Describe what you're researching, e.g. 2026 travel trends Asia"
              className="flex-1 bg-transparent text-tx-main text-sm outline-none placeholder-tx-faint"
            />
            <button onClick={() => void search()} disabled={!query.trim() || loading} className="flex items-center gap-1 px-3 h-7 rounded bg-accent-main text-bg-app text-xs font-medium disabled:opacity-40">
              {loading ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />} Search
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin">
          {error && <div className="px-4 py-3 text-xs text-status-error">{error}</div>}
          {loading && (
            <div className="px-4 py-8 text-tx-faint text-xs flex items-center justify-center gap-2">
              <Loader2 size={12} className="animate-spin text-accent-main" /> Searching the web…
            </div>
          )}
          {!loading && results.length === 0 && !error && (
            <div className="px-4 py-8 text-tx-faint text-xs text-center">
              Describe a topic and we'll fetch up to 10 candidate sources via Jina search.
            </div>
          )}
          {results.length > 0 && (
            <ul className="px-3 py-2 space-y-2">
              {results.map((r, i) => (
                <li key={r.url} className={`group rounded border transition-colors cursor-pointer ${r.selected ? 'border-accent-main/40 bg-accent-main/5' : 'border-border-subtle hover:border-tx-faint'}`} onClick={() => toggle(i)}>
                  <div className="flex items-start gap-2 p-2.5">
                    <input type="checkbox" checked={r.selected} onChange={() => toggle(i)} className="mt-0.5 w-3.5 h-3.5 accent-accent-main shrink-0" onClick={(e) => e.stopPropagation()} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-tx-main font-medium truncate">{r.title}</div>
                      <div className="text-[10px] text-tx-faint font-mono truncate mt-0.5">{r.url}</div>
                      {r.snippet && <div className="text-[11px] text-tx-muted mt-1.5 leading-snug line-clamp-2">{r.snippet}</div>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="px-4 py-3 border-t border-border-subtle flex items-center justify-between shrink-0">
          <div className="text-[11px] text-tx-faint">{picked.length} / {results.length} selected</div>
          <div className="flex items-center gap-2">
            <button onClick={onCancel} className="px-3 h-8 rounded text-xs text-tx-muted hover:text-tx-main">Cancel</button>
            <button onClick={() => void doImport()} disabled={picked.length === 0 || importing} className="flex items-center gap-1 px-3 h-8 rounded bg-accent-main text-bg-app text-xs font-medium disabled:opacity-40">
              {importing ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Import {picked.length || ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const StudioCard: React.FC<{
  icon: React.ReactNode; title: string; subtitle: string
  running?: boolean; disabled?: boolean; onClick: () => void
}> = ({ icon, title, subtitle, running, disabled, onClick }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors
      ${disabled
        ? 'border-border-subtle bg-bg-active/40 cursor-default'
        : 'border-border-subtle bg-bg-active hover:border-accent-main/40 hover:bg-bg-hover'}`}
  >
    <span className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${disabled ? 'bg-bg-hover text-tx-faint' : 'bg-accent-main/15 text-accent-main'}`}>
      {running ? <Loader2 size={14} className="animate-spin" /> : icon}
    </span>
    <span className="flex flex-col min-w-0">
      <span className={`text-xs font-medium ${disabled ? 'text-tx-muted' : 'text-tx-main'}`}>{title}</span>
      <span className="text-[10px] text-tx-faint truncate">{subtitle}</span>
    </span>
  </button>
)

const REPORT_PRESETS: Array<{ key: string; label: string; hint: string }> = [
  { key: 'briefing', label: 'Briefing doc', hint: 'Executive overview — punchy, scannable' },
  { key: 'academic', label: 'Academic article', hint: 'Paper-style with abstract + findings' },
  { key: 'faq', label: 'FAQ', hint: 'Question-answer format' },
  { key: 'study-guide', label: 'Study guide', hint: 'Glossary + core ideas + self-test' },
  { key: 'blog', label: 'Blog post', hint: 'Conversational long-form' },
]

const SLIDES_PRESETS: Array<{ key: string; label: string; hint: string }> = [
  { key: 'short', label: 'Short', hint: '5-7 slides' },
  { key: 'standard', label: 'Standard', hint: '8-12 slides' },
  { key: 'long', label: 'Long', hint: '14-18 slides' },
]

const StudioModal: React.FC<{
  kind: 'report' | 'slides'
  onCancel: () => void
  onRun: (preset: string, brief: string) => void
}> = ({ kind, onCancel, onRun }) => {
  const presets = kind === 'report' ? REPORT_PRESETS : SLIDES_PRESETS
  const [preset, setPreset] = useState(presets[0].key)
  const [brief, setBrief] = useState('')

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="w-[600px] rounded-xl bg-bg-popover border border-border-subtle shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 h-12 border-b border-border-subtle">
          {kind === 'report' ? <FileEdit size={14} className="text-accent-main" /> : <Presentation size={14} className="text-accent-main" />}
          <span className="text-sm font-medium text-tx-main">{kind === 'report' ? 'Generate report' : 'Generate slide deck'}</span>
        </div>
        <div className="px-4 py-3 space-y-3">
          <div>
            <div className="text-[10px] text-tx-faint uppercase tracking-wider mb-1.5">Preset</div>
            <div className="grid grid-cols-1 gap-1">
              {presets.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPreset(p.key)}
                  className={`flex items-center justify-between text-left px-3 py-2 rounded border transition-colors ${preset === p.key ? 'border-accent-main/50 bg-accent-main/5' : 'border-border-subtle bg-bg-active hover:border-tx-faint'}`}
                >
                  <span className="flex flex-col">
                    <span className="text-xs text-tx-main">{p.label}</span>
                    <span className="text-[10px] text-tx-faint">{p.hint}</span>
                  </span>
                  {preset === p.key && <CheckCircle2 size={12} className="text-accent-main shrink-0" />}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-tx-faint uppercase tracking-wider mb-1.5">Focus brief (optional)</div>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="What angle, audience, or specific questions should this cover?"
              rows={3}
              className="w-full px-3 py-2 rounded bg-bg-active text-tx-main text-sm outline-none focus:ring-1 focus:ring-accent-main/40 resize-none"
            />
          </div>
        </div>
        <div className="px-4 py-3 border-t border-border-subtle flex items-center justify-end gap-2">
          <button onClick={onCancel} className="px-3 h-8 rounded text-xs text-tx-muted hover:text-tx-main">Cancel</button>
          <button onClick={() => onRun(preset, brief)} className="flex items-center gap-1.5 px-3 h-8 rounded bg-accent-main text-bg-app text-xs font-medium">
            <Sparkles size={11} /> Generate
          </button>
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
