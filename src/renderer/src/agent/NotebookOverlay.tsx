/**
 * NotebookOverlay — the agent mode (NotebookLM-style).
 *
 * Three columns over a full-screen backdrop, mounted via portal so it floats
 * above the pane tree without disturbing it. Closed via Esc or the × button;
 * Cmd+Shift+N toggles open/closed (registered in App.tsx).
 *
 * Storage lives entirely in main process — `window.api.notebook.*` — and
 * every mutation is round-tripped immediately so reopening the same notebook
 * lands you exactly where you left off.
 */
import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  X, Plus, FilePlus2, FileText, Sparkles, Send, Loader2, BookOpen, Trash2,
  FileEdit, ChevronRight, Search,
} from 'lucide-react'
import { useUIStore } from '../store/useUIStore'
import { buildSystemPrompt, buildReportPrompt } from './notebook-prompts'
import { parseCitations } from './notebook-citations'
import type {
  Notebook, NotebookSource, NotebookMessage, NotebookProduct,
} from '../../../shared/notebook'
import type { AIChatMessage } from '../../../shared/types'

const COLUMN_SOURCES_W = 300
const COLUMN_STUDIO_W = 320

/** Generate the next free source id (S1, S2, …) within a notebook. */
function nextSourceId(existing: NotebookSource[]): string {
  const used = new Set(existing.map((s) => s.id))
  for (let i = 1; i < 10_000; i++) {
    const id = `S${i}`
    if (!used.has(id)) return id
  }
  return `S${Date.now()}`
}

export const NotebookOverlay: React.FC = () => {
  const notebookId = useUIStore((s) => s.notebookOverlayId)
  const setNotebookOverlay = useUIStore((s) => s.setNotebookOverlay)
  const liteHome = useUIStore((s) => s.liteHome)

  const [notebook, setNotebook] = useState<Notebook | null>(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [textPickerOpen, setTextPickerOpen] = useState(false)
  const [notePickerOpen, setNotePickerOpen] = useState(false)
  const [renamingName, setRenamingName] = useState(false)
  const [openCitation, setOpenCitation] = useState<{ sourceId: string; x: number; y: number } | null>(null)
  const [studioRunning, setStudioRunning] = useState<null | 'report'>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)

  // ── Load on open / id change ────────────────────────────────
  useEffect(() => {
    let cancelled = false
    if (!notebookId) { setNotebook(null); return }
    setError(null)
    void window.api.notebook.get(notebookId).then((res) => {
      if (cancelled) return
      if (res.ok) setNotebook(res.data)
      else setError(res.error)
    })
    return () => { cancelled = true }
  }, [notebookId])

  // ── Persist helper ──────────────────────────────────────────
  const persist = (next: Notebook): void => {
    setNotebook(next)
    void window.api.notebook.save(next)
  }

  // ── Auto-scroll chat ────────────────────────────────────────
  useEffect(() => {
    const el = chatScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [notebook?.messages.length, loading])

  if (!notebookId) return null
  if (!notebook) {
    return createPortal(
      <Backdrop onClose={() => setNotebookOverlay(null)}>
        <div className="flex items-center justify-center w-full h-full text-tx-faint text-sm">
          {error ? `Failed to load: ${error}` : 'Loading notebook…'}
        </div>
      </Backdrop>,
      document.body,
    )
  }

  const activeSources = notebook.sources.filter((s) => s.selected && s.content)
  const sourceCount = activeSources.length

  // ── Source actions ──────────────────────────────────────────
  const addNoteSourceFromPath = async (filePath: string): Promise<void> => {
    const fileRes = await window.api.fs.readFile(filePath)
    if (!fileRes.ok) return
    const title = filePath.split('/').pop()?.replace(/\.(md|markdown|txt)$/i, '') || 'Untitled'
    const id = nextSourceId(notebook.sources)
    persist({
      ...notebook,
      sources: [...notebook.sources, {
        id, kind: 'note', title, path: filePath,
        content: fileRes.data, selected: true, addedAt: Date.now(),
      }],
    })
    setNotePickerOpen(false)
  }

  const addTextSource = (title: string, content: string): void => {
    if (!content.trim()) return
    const id = nextSourceId(notebook.sources)
    persist({
      ...notebook,
      sources: [...notebook.sources, {
        id, kind: 'text', title: title.trim() || `Snippet ${id}`,
        content, selected: true, addedAt: Date.now(),
      }],
    })
    setTextPickerOpen(false)
  }

  const toggleSource = (id: string): void => {
    persist({
      ...notebook,
      sources: notebook.sources.map((s) => s.id === id ? { ...s, selected: !s.selected } : s),
    })
  }

  const deleteSource = (id: string): void => {
    persist({ ...notebook, sources: notebook.sources.filter((s) => s.id !== id) })
  }

  const renameNotebook = (name: string): void => {
    persist({ ...notebook, name: name.trim() || notebook.name })
    setRenamingName(false)
  }

  // ── Chat ────────────────────────────────────────────────────
  const sendMessage = async (): Promise<void> => {
    const prompt = input.trim()
    if (!prompt || loading) return
    if (activeSources.length === 0) {
      setError('Select at least one source first.')
      return
    }
    setError(null)
    setInput('')
    setLoading(true)

    const userMsg: NotebookMessage = {
      id: `m${Date.now()}-u`,
      role: 'user',
      content: prompt,
      createdAt: Date.now(),
    }
    const withUser: Notebook = { ...notebook, messages: [...notebook.messages, userMsg] }
    persist(withUser)

    try {
      const routed = useUIStore.getState().getAIProviderForFeature?.('chat')
      if (!routed) {
        setError('No AI provider configured. Open Settings → AI to add one.')
        setLoading(false)
        return
      }
      const { provider, model } = routed

      const system = buildSystemPrompt(activeSources)
      // Include the last ~10 turns as conversation context.
      const recent: AIChatMessage[] = withUser.messages.slice(-10).map((m) => ({ role: m.role, content: m.content }))
      const messages: AIChatMessage[] = [{ role: 'system', content: system }, ...recent]

      const result = await window.api.ai.chat(provider.id, messages, 0.4, 1800, false, model)
      if (!result.ok) {
        setError(`Chat failed: ${result.error}`)
        setLoading(false)
        return
      }
      const raw = result.data.content
      const parsed = parseCitations(raw, notebook.sources)
      const aiMsg: NotebookMessage = {
        id: `m${Date.now()}-a`,
        role: 'assistant',
        content: parsed.content,
        citations: parsed.citations,
        createdAt: Date.now(),
      }
      persist({ ...withUser, messages: [...withUser.messages, aiMsg] })
    } catch (e) {
      setError(`Chat failed: ${String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  // ── Studio: Report ──────────────────────────────────────────
  const generateReport = async (): Promise<void> => {
    if (activeSources.length === 0) {
      setError('Select at least one source first.')
      return
    }
    if (studioRunning) return
    setError(null)
    setStudioRunning('report')
    try {
      const routed = useUIStore.getState().getAIProviderForFeature?.('chat')
      if (!routed) {
        setError('No AI provider configured.')
        setStudioRunning(null)
        return
      }
      const { provider, model } = routed
      const { system, user } = buildReportPrompt(notebook, activeSources, input.trim() || undefined)
      const messages: AIChatMessage[] = [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ]
      const result = await window.api.ai.chat(provider.id, messages, 0.3, 4000, false, model)
      if (!result.ok) {
        setError(`Report failed: ${result.error}`)
        setStudioRunning(null)
        return
      }

      const parsed = parseCitations(result.data.content, notebook.sources)
      // Append a "Sources" footnote section so the markdown stands alone
      // outside the notebook (a saved report Note should be readable in Notes
      // without context to the original notebook).
      const sourceFootnote = '\n\n---\n\n### Source legend\n\n' + notebook.sources
        .filter((s) => parsed.citations.some((c) => c.sourceId === s.id))
        .map((s) => {
          const num = parsed.citations.find((c) => c.sourceId === s.id)!.number
          const loc = s.kind === 'note' ? s.path : (s.kind === 'url' ? s.url : 'inline text')
          return `- **[${num}]** ${s.title}${loc ? ` — \`${loc}\`` : ''}`
        }).join('\n')

      const markdown = parsed.content + sourceFootnote

      // Write to {liteHome}/notes/Notebook Reports/<safeName>-<date>.md
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
      const safeName = notebook.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
      const dir = `${liteHome}/notes/Notebook Reports`
      const filePath = `${dir}/${safeName} — ${stamp}.md`
      await window.api.fs.createDir(dir).catch(() => undefined)
      const createRes = await window.api.fs.createFile(filePath)
      if (!createRes.ok) {
        setError(`Failed to save report: ${createRes.error}`)
        setStudioRunning(null)
        return
      }
      await window.api.fs.writeFile(filePath, markdown)

      const product: NotebookProduct = {
        id: `p${Date.now()}`,
        type: 'report',
        notePath: filePath,
        label: `Report — ${new Date().toLocaleString()}`,
        createdAt: Date.now(),
      }
      persist({ ...notebook, products: [...notebook.products, product] })
    } catch (e) {
      setError(`Report failed: ${String(e)}`)
    } finally {
      setStudioRunning(null)
    }
  }

  const openProduct = (p: NotebookProduct): void => {
    // Close overlay and route the file into the active pane via existing
    // store API. The user can pick it back up in the Notes app.
    useUIStore.getState().setActiveFilePath?.(p.notePath)
    useUIStore.getState().setCurrentApp('notes.app')
    setNotebookOverlay(null)
  }

  // ── Render ──────────────────────────────────────────────────
  return createPortal(
    <Backdrop onClose={() => setNotebookOverlay(null)}>
      <div className="flex flex-col h-full bg-bg-app">
        {/* Title bar */}
        <div className="flex items-center gap-3 px-5 h-12 border-b border-border-subtle shrink-0">
          <BookOpen size={16} className="text-accent-main shrink-0" />
          {renamingName ? (
            <input
              autoFocus
              defaultValue={notebook.name}
              onBlur={(e) => renameNotebook(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setRenamingName(false)
              }}
              className="flex-1 bg-transparent text-tx-main text-sm font-medium outline-none"
            />
          ) : (
            <button
              onClick={() => setRenamingName(true)}
              className="flex-1 text-left text-tx-main text-sm font-medium hover:text-accent-main transition-colors"
            >
              {notebook.name}
            </button>
          )}
          <span className="text-[11px] text-tx-faint">Agent mode · ⌘⇧N</span>
          <button
            onClick={() => setNotebookOverlay(null)}
            className="w-7 h-7 flex items-center justify-center rounded text-tx-muted hover:text-tx-main hover:bg-bg-hover transition-colors"
            title="Close (Esc)"
          >
            <X size={14} />
          </button>
        </div>

        {/* 3-column body */}
        <div className="flex flex-1 min-h-0">
          {/* ── Sources column ── */}
          <div className="flex flex-col border-r border-border-subtle shrink-0" style={{ width: COLUMN_SOURCES_W }}>
            <div className="px-4 pt-4 pb-2 text-[11px] text-tx-faint uppercase tracking-wider">来源 · Sources</div>
            <div className="px-3 flex flex-col gap-2">
              <button
                onClick={() => setNotePickerOpen(true)}
                className="flex items-center gap-2 px-3 h-8 rounded bg-bg-active text-tx-main text-xs hover:bg-bg-hover transition-colors"
              >
                <FilePlus2 size={13} className="text-accent-main" />
                Add from Notes…
              </button>
              <button
                onClick={() => setTextPickerOpen(true)}
                className="flex items-center gap-2 px-3 h-8 rounded bg-bg-active text-tx-main text-xs hover:bg-bg-hover transition-colors"
              >
                <Plus size={13} className="text-accent-main" />
                Paste text
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-3 mt-3 scroll-thin">
              {notebook.sources.length === 0 ? (
                <div className="text-[11px] text-tx-faint px-1 py-4 leading-relaxed">
                  No sources yet. Add at least one to start chatting.
                </div>
              ) : (
                <ul className="space-y-1 pb-3">
                  {notebook.sources.map((s) => (
                    <SourceRow
                      key={s.id}
                      source={s}
                      onToggle={() => toggleSource(s.id)}
                      onDelete={() => deleteSource(s.id)}
                    />
                  ))}
                </ul>
              )}
            </div>
            <div className="px-4 py-2 border-t border-border-subtle text-[11px] text-tx-faint">
              {sourceCount} of {notebook.sources.length} selected
            </div>
          </div>

          {/* ── Chat column ── */}
          <div className="flex flex-col flex-1 min-w-0">
            <div ref={chatScrollRef} className="flex-1 min-h-0 overflow-y-auto scroll-thin px-8 py-6">
              {notebook.messages.length === 0 && (
                <div className="text-tx-faint text-sm leading-relaxed max-w-2xl mx-auto py-12">
                  <Sparkles size={18} className="text-accent-main mb-3" />
                  Ask anything about your selected sources. Responses cite the
                  source they came from — click any <span className="inline-flex items-center justify-center px-1.5 h-4 rounded bg-accent-main/15 text-accent-main text-[10px] font-mono">N</span> badge
                  to peek at the original text.
                </div>
              )}
              {notebook.messages.map((m) => (
                <ChatMessage
                  key={m.id}
                  message={m}
                  sources={notebook.sources}
                  onCitationClick={(sourceId, e) => setOpenCitation({ sourceId, x: e.clientX, y: e.clientY })}
                />
              ))}
              {loading && (
                <div className="flex items-center gap-2 text-tx-faint text-xs my-3">
                  <Loader2 size={12} className="animate-spin text-accent-main" />
                  Thinking…
                </div>
              )}
              {error && (
                <div className="mt-2 px-3 py-2 rounded bg-status-error/10 border border-status-error/30 text-status-error text-xs">
                  {error}
                </div>
              )}
            </div>

            {/* Composer */}
            <div className="border-t border-border-subtle px-6 py-3 shrink-0">
              <div className="relative rounded-xl bg-bg-active focus-within:ring-1 focus-within:ring-accent-main/40 transition">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      void sendMessage()
                    }
                  }}
                  placeholder={sourceCount === 0 ? 'Add and select at least one source first…' : 'Ask anything about the selected sources…  (⌘↵ to send)'}
                  rows={2}
                  className="w-full bg-transparent text-tx-main text-sm outline-none resize-none px-4 py-3 pr-28 placeholder-tx-faint"
                />
                <div className="absolute right-3 bottom-2.5 flex items-center gap-2 text-[11px] text-tx-faint">
                  <span>{sourceCount} sources</span>
                  <button
                    onClick={() => void sendMessage()}
                    disabled={loading || !input.trim() || sourceCount === 0}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-accent-main text-bg-app font-medium disabled:opacity-40 disabled:cursor-default hover:opacity-90 transition-opacity"
                  >
                    <Send size={11} />
                    Send
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ── Studio column ── */}
          <div className="flex flex-col border-l border-border-subtle shrink-0" style={{ width: COLUMN_STUDIO_W }}>
            <div className="px-4 pt-4 pb-2 text-[11px] text-tx-faint uppercase tracking-wider">Studio</div>
            <div className="px-3 grid grid-cols-1 gap-2">
              <StudioCard
                icon={<FileEdit size={14} />}
                title="Report"
                subtitle="Briefing doc with citations"
                running={studioRunning === 'report'}
                disabled={sourceCount === 0 || studioRunning != null}
                onClick={() => void generateReport()}
              />
              <StudioCard icon={<BookOpen size={14} />} title="Mind map" subtitle="Coming soon" disabled comingSoon />
              <StudioCard icon={<Sparkles size={14} />} title="Quiz" subtitle="Coming soon" disabled comingSoon />
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto scroll-thin px-3 mt-4">
              <div className="text-[10px] text-tx-faint uppercase tracking-wider px-1 mb-1">Products</div>
              {notebook.products.length === 0 ? (
                <div className="text-[11px] text-tx-faint px-1 py-2">No outputs yet.</div>
              ) : (
                <ul className="space-y-1 pb-3">
                  {[...notebook.products].reverse().map((p) => (
                    <li key={p.id}>
                      <button
                        onClick={() => openProduct(p)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg-hover text-left text-xs text-tx-main transition-colors"
                      >
                        <FileText size={12} className="text-accent-main shrink-0" />
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

        {/* Text source modal */}
        {textPickerOpen && (
          <TextSourceModal
            onCancel={() => setTextPickerOpen(false)}
            onConfirm={addTextSource}
          />
        )}

        {/* Note picker modal — searchable list of .md files under liteHome/notes */}
        {notePickerOpen && liteHome && (
          <NotePickerModal
            notesRoot={`${liteHome}/notes`}
            existingPaths={new Set(notebook.sources.filter((s) => s.kind === 'note' && s.path).map((s) => s.path!))}
            onCancel={() => setNotePickerOpen(false)}
            onPick={addNoteSourceFromPath}
          />
        )}

        {/* Citation popover */}
        {openCitation && (
          <CitationPopover
            sourceId={openCitation.sourceId}
            x={openCitation.x}
            y={openCitation.y}
            sources={notebook.sources}
            onClose={() => setOpenCitation(null)}
          />
        )}
      </div>
    </Backdrop>,
    document.body,
  )
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components (kept inline for V1 — promote when files grow)
// ─────────────────────────────────────────────────────────────────────

const Backdrop: React.FC<{ children: React.ReactNode; onClose: () => void }> = ({ children, onClose }) => {
  // Esc to close. Layered above CommandPalette (z-100) at z-200.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[200] bg-bg-app/95 backdrop-blur-sm" role="dialog">
      {children}
    </div>
  )
}

const SourceRow: React.FC<{
  source: NotebookSource
  onToggle: () => void
  onDelete: () => void
}> = ({ source, onToggle, onDelete }) => (
  <li className="group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg-hover transition-colors">
    <input
      type="checkbox"
      checked={source.selected}
      onChange={onToggle}
      className="w-3.5 h-3.5 accent-accent-main shrink-0 cursor-pointer"
    />
    <span className="text-[10px] uppercase tracking-wider text-accent-main/70 font-mono shrink-0">{source.id}</span>
    <span className="flex-1 min-w-0 text-xs text-tx-main truncate" title={source.path || source.url || ''}>
      {source.title}
    </span>
    <button
      onClick={onDelete}
      className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center text-tx-faint hover:text-status-error transition-all"
      title="Remove"
    >
      <Trash2 size={11} />
    </button>
  </li>
)

interface NoteEntry {
  path: string
  /** Filename without `.md`. */
  name: string
  /** Path relative to notes root, used as a "where it lives" hint. */
  relGroup: string
}

/** Recursively walk a directory and collect every `.md` file. */
async function walkNotes(root: string, current: string): Promise<NoteEntry[]> {
  const out: NoteEntry[] = []
  const res = await window.api.fs.readDir(current)
  if (!res.ok) return out
  for (const node of res.data) {
    if (node.isDirectory) {
      const nested = await walkNotes(root, node.path)
      out.push(...nested)
    } else if (node.name.toLowerCase().endsWith('.md')) {
      const rel = node.path.startsWith(root) ? node.path.slice(root.length + 1) : node.path
      const lastSlash = rel.lastIndexOf('/')
      out.push({
        path: node.path,
        name: node.name.replace(/\.md$/i, ''),
        relGroup: lastSlash >= 0 ? rel.slice(0, lastSlash) : '',
      })
    }
  }
  return out
}

const NotePickerModal: React.FC<{
  notesRoot: string
  existingPaths: Set<string>
  onCancel: () => void
  onPick: (path: string) => void
}> = ({ notesRoot, existingPaths, onCancel, onPick }) => {
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<NoteEntry[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [loading, setLoading] = useState(true)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    void walkNotes(notesRoot, notesRoot).then((items) => {
      if (cancelled) return
      items.sort((a, b) => a.name.localeCompare(b.name))
      setEntries(items)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [notesRoot])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    return entries.filter((e) =>
      e.name.toLowerCase().includes(q) || e.relGroup.toLowerCase().includes(q),
    )
  }, [entries, query])

  // Reset active row when filter changes; clamp when list shrinks.
  useEffect(() => { setActiveIdx(0) }, [query])
  useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(Math.max(0, filtered.length - 1))
  }, [filtered.length, activeIdx])

  // Scroll active row into view on keyboard nav.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row="${activeIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  const commit = (idx: number): void => {
    const e = filtered[idx]
    if (!e) return
    if (existingPaths.has(e.path)) {
      onCancel()
      return
    }
    onPick(e.path)
  }

  return (
    <div className="fixed inset-0 z-[210] flex items-start justify-center pt-[10vh] bg-black/40" onClick={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[520px] max-h-[60vh] rounded-xl bg-bg-popover border border-border-subtle shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="flex items-center gap-2 px-3 h-10 border-b border-border-subtle shrink-0">
          <Search size={13} className="text-tx-faint shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); onCancel(); return }
              if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, filtered.length - 1)); return }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); return }
              if (e.key === 'Enter') { e.preventDefault(); commit(activeIdx); return }
            }}
            placeholder="Search notes by name or folder…"
            className="flex-1 bg-transparent text-tx-main text-sm outline-none placeholder-tx-faint"
          />
          <span className="text-[10px] text-tx-faint shrink-0">{filtered.length} / {entries.length}</span>
        </div>
        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto scroll-thin py-1">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-tx-faint text-xs gap-2">
              <Loader2 size={12} className="animate-spin" /> Scanning notes…
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-6 text-xs text-tx-faint">No notes match.</div>
          ) : (
            filtered.map((e, i) => {
              const already = existingPaths.has(e.path)
              const active = i === activeIdx
              return (
                <button
                  key={e.path}
                  data-row={i}
                  onMouseEnter={() => setActiveIdx(i)}
                  onMouseDown={(ev) => { ev.preventDefault(); commit(i) }}
                  disabled={already}
                  className={`w-full text-left flex items-center gap-2 px-3 h-8 text-xs transition-colors ${
                    active ? 'bg-accent-main/15 text-tx-main' : 'text-tx-main hover:bg-bg-hover'
                  } ${already ? 'opacity-40 cursor-default' : 'cursor-pointer'}`}
                >
                  <FileText size={12} className={active ? 'text-accent-main shrink-0' : 'text-tx-faint shrink-0'} />
                  <span className="truncate flex-1">{e.name}</span>
                  {e.relGroup && (
                    <span className="text-[10px] text-tx-faint shrink-0 max-w-[180px] truncate">{e.relGroup}</span>
                  )}
                  {already && <span className="text-[9px] text-tx-faint uppercase tracking-wider shrink-0">added</span>}
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

const TextSourceModal: React.FC<{
  onCancel: () => void
  onConfirm: (title: string, content: string) => void
}> = ({ onCancel, onConfirm }) => {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[520px] rounded-xl bg-bg-popover border border-border-subtle shadow-2xl overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-border-subtle text-sm font-medium text-tx-main">Paste text source</div>
        <div className="px-4 py-3 space-y-2">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional)"
            className="w-full px-3 h-9 rounded bg-bg-active text-tx-main text-sm outline-none focus:ring-1 focus:ring-accent-main/40"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Paste the content…"
            rows={10}
            className="w-full px-3 py-2 rounded bg-bg-active text-tx-main text-sm outline-none focus:ring-1 focus:ring-accent-main/40 resize-none"
          />
        </div>
        <div className="px-4 py-3 border-t border-border-subtle flex items-center justify-end gap-2">
          <button onClick={onCancel} className="px-3 h-8 rounded text-xs text-tx-muted hover:text-tx-main">Cancel</button>
          <button
            onClick={() => onConfirm(title, content)}
            disabled={!content.trim()}
            className="px-3 h-8 rounded bg-accent-main text-bg-app text-xs font-medium disabled:opacity-40"
          >
            Add source
          </button>
        </div>
      </div>
    </div>
  )
}

const ChatMessage: React.FC<{
  message: NotebookMessage
  sources: NotebookSource[]
  onCitationClick: (sourceId: string, e: React.MouseEvent) => void
}> = ({ message, sources, onCitationClick }) => {
  const isUser = message.role === 'user'
  const citationMap = useMemo(() => {
    const m = new Map<number, string>()
    message.citations?.forEach((c) => m.set(c.number, c.sourceId))
    return m
  }, [message.citations])

  // Replace `[N]` with sentinels for inline interactive badges. Rendering is
  // done by wrapping the markdown output's text after react-markdown processes
  // the rest — simplest path is to substitute `[N]` with a `(@cite:N)`
  // placeholder, then post-process text nodes via remark plugin OR via a
  // simple replace on the rendered HTML. We take the simpler route: render
  // markdown, then in components.text wrap [N] occurrences with a button.
  const renderText = (text: string): React.ReactNode => {
    const parts: React.ReactNode[] = []
    let lastIdx = 0
    const re = /\[(\d+)\]/g
    let m: RegExpExecArray | null
    let key = 0
    while ((m = re.exec(text)) !== null) {
      const n = Number(m[1])
      if (!citationMap.has(n)) continue
      parts.push(text.slice(lastIdx, m.index))
      const sourceId = citationMap.get(n)!
      parts.push(
        <button
          key={`c${key++}-${n}`}
          onClick={(e) => onCitationClick(sourceId, e)}
          className="inline-flex items-center justify-center mx-0.5 px-1.5 h-4 rounded bg-accent-main/15 text-accent-main text-[10px] font-mono align-middle hover:bg-accent-main/25 transition-colors"
          title={sources.find((s) => s.id === sourceId)?.title}
        >
          {n}
        </button>,
      )
      lastIdx = m.index + m[0].length
    }
    parts.push(text.slice(lastIdx))
    return parts
  }

  return (
    <div className={`mb-5 ${isUser ? 'flex justify-end' : ''}`}>
      <div className={`${isUser
        ? 'max-w-[80%] bg-bg-active rounded-2xl rounded-tr-sm px-4 py-2.5 text-tx-main text-sm leading-relaxed whitespace-pre-wrap'
        : 'max-w-[92%] text-tx-main text-sm leading-relaxed markdown-body'}`}>
        {isUser ? (
          message.content
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // Override text rendering to inject clickable [N] badges.
              p: ({ children }) => <p>{wrapTextNodes(children, renderText)}</p>,
              li: ({ children }) => <li>{wrapTextNodes(children, renderText)}</li>,
              h1: ({ children }) => <h1>{wrapTextNodes(children, renderText)}</h1>,
              h2: ({ children }) => <h2>{wrapTextNodes(children, renderText)}</h2>,
              h3: ({ children }) => <h3>{wrapTextNodes(children, renderText)}</h3>,
            }}
          >
            {message.content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  )
}

/** Walk React children; replace each string node by `renderText(str)`. */
function wrapTextNodes(children: React.ReactNode, renderText: (s: string) => React.ReactNode): React.ReactNode {
  const arr = Array.isArray(children) ? children : [children]
  return arr.map((c, i): React.ReactNode => {
    if (typeof c === 'string') return <span key={i}>{renderText(c)}</span>
    return c
  })
}

const CitationPopover: React.FC<{
  sourceId: string
  x: number
  y: number
  sources: NotebookSource[]
  onClose: () => void
}> = ({ sourceId, x, y, sources, onClose }) => {
  const source = sources.find((s) => s.id === sourceId)
  useEffect(() => {
    const onAny = (): void => onClose()
    window.addEventListener('mousedown', onAny)
    return () => window.removeEventListener('mousedown', onAny)
  }, [onClose])
  if (!source) return null
  const preview = (source.content || '').slice(0, 600)
  // Clamp to viewport.
  const left = Math.min(x, window.innerWidth - 380)
  const top = Math.min(y + 14, window.innerHeight - 280)
  return (
    <div
      className="fixed z-[230] w-[360px] max-h-[260px] rounded-lg bg-bg-popover border border-border-subtle shadow-2xl overflow-hidden flex flex-col"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
        <span className="text-[10px] font-mono text-accent-main">{source.id}</span>
        <span className="flex-1 text-xs text-tx-main truncate">{source.title}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 text-[12px] text-tx-muted whitespace-pre-wrap leading-relaxed">
        {preview}
        {source.content && source.content.length > 600 && '…'}
      </div>
    </div>
  )
}

const StudioCard: React.FC<{
  icon: JSX.Element
  title: string
  subtitle: string
  running?: boolean
  disabled?: boolean
  comingSoon?: boolean
  onClick?: () => void
}> = ({ icon, title, subtitle, running, disabled, comingSoon, onClick }) => (
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
      <span className={`text-xs font-medium ${disabled ? 'text-tx-muted' : 'text-tx-main'}`}>
        {title}
        {comingSoon && <span className="ml-1.5 text-[9px] font-normal text-tx-faint uppercase">soon</span>}
      </span>
      <span className="text-[10px] text-tx-faint truncate">{subtitle}</span>
    </span>
  </button>
)
