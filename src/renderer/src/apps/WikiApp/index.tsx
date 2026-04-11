/**
 * Wiki App — Main view.
 *
 * Layout:
 *   ┌─ Header (stats) ─────────────────────────────┐
 *   │ ┌─ Left: Queue ─┐ ┌─ Main: Pages / Graph ─┐  │
 *   │ │  pending      │ │                       │  │
 *   │ │  running      │ │    (page list  or     │  │
 *   │ │  done         │ │     graph view)       │  │
 *   │ └───────────────┘ └───────────────────────┘  │
 *   │ ┌─ Bottom: Chat ────────────────────────────┐│
 *   │ │ "Ask the wiki..."                         ││
 *   │ └───────────────────────────────────────────┘│
 *   └──────────────────────────────────────────────┘
 *
 * Phase 2 scaffold — graph view is a placeholder; chat is a placeholder.
 * Phase 3 fills in the ingest pipeline (already implemented in ingest.ts).
 * Phase 4 will add the sigma.js graph.
 * Phase 5 will add the working chat panel.
 */
import React, { useEffect, useState, useCallback } from 'react'
import {
  BookOpen, RefreshCw, Loader2, CheckCircle2, AlertCircle, Trash2,
  Play, Pause, FolderOpen, FileText, Zap,
} from 'lucide-react'
import { useUIStore } from '../../store/useUIStore'
import { useWikiIngestStore } from './ingest-queue'
import { runIngest } from './ingest'

interface WikiStats {
  root: string
  total: number
  byType: Record<string, number>
  hasIndex: boolean
  hasPurpose: boolean
  lastLogEntry: string | null
}

interface WikiPage {
  path: string
  relPath: string
  type: string
  title: string
}

export const WikiApp: React.FC = () => {
  const showCommandPalette = useUIStore((s) => s.showCommandPalette)
  const [stats, setStats] = useState<WikiStats | null>(null)
  const [pages, setPages] = useState<WikiPage[]>([])
  const [selectedPage, setSelectedPage] = useState<string | null>(null)
  const [pageContent, setPageContent] = useState<string>('')
  const [loading, setLoading] = useState(false)

  const queue = useWikiIngestStore((s) => s.queue)
  const autoIngest = useWikiIngestStore((s) => s.autoIngest)
  const setAutoIngest = useWikiIngestStore((s) => s.setAutoIngest)
  const clearDone = useWikiIngestStore((s) => s.clearDone)

  // ── Data loading ──
  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      await window.api.wiki.init()
      const [statsRes, pagesRes] = await Promise.all([
        window.api.wiki.stats(),
        window.api.wiki.listPages(),
      ])
      if (statsRes.ok) setStats(statsRes.data as WikiStats)
      if (pagesRes.ok) setPages(pagesRes.data as WikiPage[])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Refresh when queue reaches a "done" state (new pages were written)
  useEffect(() => {
    const hasJustFinished = queue.some((q) => q.status === 'done')
    if (hasJustFinished) {
      refresh()
    }
  }, [queue, refresh])

  // ── Actions ──
  const handleOpenPage = useCallback(async (relPath: string) => {
    setSelectedPage(relPath)
    const res = await window.api.wiki.read(relPath)
    if (res.ok) setPageContent(res.data || '')
  }, [])

  const handleRevealWiki = useCallback(() => {
    if (stats?.root) window.api.shell.revealPath(stats.root)
  }, [stats])

  const handleIngestNow = useCallback(async (itemId: string) => {
    await runIngest(itemId)
  }, [])

  const blurClass = showCommandPalette
    ? 'opacity-50 transition-opacity duration-200'
    : 'transition-opacity duration-200'

  const pageTypes = Object.keys(stats?.byType || {}).sort()

  // ── Render ──
  return (
    <div className={`flex-1 flex flex-col overflow-hidden ${blurClass}`}>
      {/* Header */}
      <div className="shrink-0 border-b border-border-subtle px-6 py-4">
        <div className="flex items-center gap-3 mb-2">
          <BookOpen size={18} className="text-accent-main" />
          <h1 className="text-[16px] font-semibold text-tx-main">Wiki</h1>
          {stats && (
            <span className="text-[11px] text-tx-faint">
              {stats.total} page{stats.total === 1 ? '' : 's'}
            </span>
          )}
          <button
            onClick={refresh}
            className="ml-auto p-1.5 rounded-md text-tx-faint hover:text-tx-main hover:bg-bg-hover transition-colors"
            title="Refresh"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={handleRevealWiki}
            className="p-1.5 rounded-md text-tx-faint hover:text-tx-main hover:bg-bg-hover transition-colors"
            title="Reveal wiki folder"
          >
            <FolderOpen size={13} />
          </button>
        </div>
        {/* Type breakdown */}
        {pageTypes.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {pageTypes.map((t) => (
              <span
                key={t}
                className="text-[10px] text-tx-muted px-2 py-0.5 rounded-full bg-bg-hover border border-border-subtle"
              >
                {t}: {stats!.byType[t]}
              </span>
            ))}
          </div>
        )}
        {stats?.lastLogEntry && (
          <div className="text-[10px] text-tx-faint mt-2 font-mono truncate">
            Last: {stats.lastLogEntry}
          </div>
        )}
      </div>

      {/* Main area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left — Ingest Queue + Pages tree */}
        <div className="w-[260px] shrink-0 border-r border-border-subtle flex flex-col overflow-hidden">
          {/* Queue section */}
          <div className="shrink-0 border-b border-border-subtle p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase tracking-wider text-tx-faint">
                Ingest Queue ({queue.length})
              </div>
              <button
                onClick={() => setAutoIngest(!autoIngest)}
                className={`flex items-center gap-1 text-[10px] transition-colors ${
                  autoIngest ? 'text-accent-main' : 'text-tx-faint hover:text-tx-muted'
                }`}
                title={autoIngest ? 'Auto-ingest on — click to pause' : 'Auto-ingest off — click to enable'}
              >
                {autoIngest ? <Play size={9} /> : <Pause size={9} />}
                {autoIngest ? 'auto' : 'manual'}
              </button>
            </div>
            {queue.length === 0 ? (
              <div className="text-[11px] text-tx-faint">
                No items queued. Add to Collector to trigger.
              </div>
            ) : (
              <div className="space-y-1 max-h-[240px] overflow-y-auto scroll-thin">
                {queue.map((q) => (
                  <div
                    key={q.itemId}
                    className="flex items-center gap-2 px-2 py-1.5 rounded border border-border-subtle bg-bg-hover/30 text-[10px]"
                  >
                    {q.status === 'pending' && <Zap size={10} className="text-tx-faint shrink-0" />}
                    {q.status === 'running' && <Loader2 size={10} className="animate-spin text-accent-main shrink-0" />}
                    {q.status === 'done' && <CheckCircle2 size={10} className="text-status-success shrink-0" />}
                    {q.status === 'error' && (
                      <span title={q.error ?? ''}>
                        <AlertCircle size={10} className="text-status-error shrink-0" />
                      </span>
                    )}
                    <span className="flex-1 font-mono truncate text-tx-muted">
                      {q.itemType} · {q.itemId.slice(0, 8)}
                    </span>
                    {q.status === 'pending' && (
                      <button
                        onClick={() => handleIngestNow(q.itemId)}
                        className="text-[9px] text-accent-main hover:text-accent-main/80"
                        title="Run now"
                      >
                        run
                      </button>
                    )}
                  </div>
                ))}
                {queue.some((q) => q.status === 'done') && (
                  <button
                    onClick={clearDone}
                    className="w-full mt-2 text-[10px] text-tx-faint hover:text-tx-muted flex items-center justify-center gap-1 py-1"
                  >
                    <Trash2 size={9} />
                    Clear done
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Pages tree */}
          <div className="flex-1 overflow-y-auto scroll-thin p-3">
            <div className="text-[10px] uppercase tracking-wider text-tx-faint mb-2">
              Pages
            </div>
            {pages.length === 0 ? (
              <div className="text-[11px] text-tx-faint">
                No pages yet. Ingest a collector item to start.
              </div>
            ) : (
              <div className="space-y-0.5">
                {pages.map((p) => (
                  <button
                    key={p.relPath}
                    onClick={() => handleOpenPage(p.relPath)}
                    className={`w-full flex items-start gap-2 px-2 py-1.5 rounded text-left transition-colors ${
                      selectedPage === p.relPath
                        ? 'bg-bg-active text-tx-active'
                        : 'text-tx-muted hover:bg-bg-hover hover:text-tx-main'
                    }`}
                  >
                    <FileText size={11} className="mt-0.5 shrink-0 text-tx-faint" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] truncate">{p.title}</div>
                      <div className="text-[9px] text-tx-faint font-mono truncate">
                        {p.type} · {p.relPath}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right — Page preview / Graph placeholder */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedPage && pageContent ? (
            <div className="flex-1 overflow-y-auto scroll-thin p-6">
              <div className="text-[10px] text-tx-faint font-mono mb-3">{selectedPage}</div>
              <pre className="text-[12px] text-tx-main whitespace-pre-wrap font-mono leading-relaxed">
                {pageContent}
              </pre>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-tx-faint">
              <BookOpen size={32} />
              <div className="text-sm">
                {pages.length === 0 ? 'Empty wiki' : 'Select a page'}
              </div>
              <div className="text-xs text-tx-faint max-w-[320px] text-center leading-relaxed">
                {pages.length === 0
                  ? 'Add items to Collector — they\'ll flow here automatically and become wiki pages.'
                  : 'Click any page on the left to read it. Graph view coming next.'}
              </div>
            </div>
          )}

          {/* Chat placeholder */}
          <div className="shrink-0 border-t border-border-subtle p-3 bg-bg-hover/30">
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-bg-app border border-border-subtle">
              <span className="text-[11px] text-tx-faint">💬</span>
              <input
                type="text"
                placeholder="Ask the wiki... (coming soon)"
                disabled
                className="flex-1 bg-transparent text-[12px] text-tx-main outline-none placeholder-tx-faint disabled:cursor-not-allowed"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
