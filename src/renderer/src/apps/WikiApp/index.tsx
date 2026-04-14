/**
 * Wiki App — Main view.
 *
 * Layout:
 *   Header (stats)
 *   ├─ Left panel: Ingest Queue + Content Pages + System Files
 *   └─ Right panel: Page preview (or placeholder)
 *   Bottom: Chat placeholder
 */
import React, { useEffect, useState, useCallback, useMemo, lazy, Suspense } from 'react'
import {
  BookOpen, RefreshCw, Loader2, CheckCircle2, AlertCircle, Trash2,
  Play, Pause, FolderOpen, FileText, Zap, Settings, ChevronDown, ChevronRight,
  Network, List, MessageSquare,
} from 'lucide-react'
import { useUIStore } from '../../store/useUIStore'
import { useWikiIngestStore } from './ingest-queue'
import { runIngest } from './ingest'

const WikiGraph = lazy(() => import('./WikiGraph').then(m => ({ default: m.WikiGraph })))
const WikiChat = lazy(() => import('./WikiChat').then(m => ({ default: m.WikiChat })))

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

// System files — always present, form the wiki skeleton.
// Users shouldn't delete these; they're shown in a collapsed section.
const SYSTEM_FILES = new Set(['SCHEMA.md', 'index.md', 'log.md', 'overview.md', 'purpose.md'])

function isSystemFile(relPath: string): boolean {
  return SYSTEM_FILES.has(relPath)
}

// Group content pages by directory for a cleaner tree
interface PageGroup {
  label: string
  icon: string
  pages: WikiPage[]
}

function groupContentPages(pages: WikiPage[]): PageGroup[] {
  const groups: Record<string, WikiPage[]> = {}
  for (const p of pages) {
    const dir = p.relPath.includes('/') ? p.relPath.split('/').slice(0, -1).join('/') : '_root'
    if (!groups[dir]) groups[dir] = []
    groups[dir].push(p)
  }

  const ORDER = ['entities', 'concepts', 'sources/links', 'sources/images', 'sources/videos', 'sources/notes', '_root']
  const LABELS: Record<string, string> = {
    entities: 'Entities',
    concepts: 'Concepts',
    'sources/links': 'Sources — Links',
    'sources/images': 'Sources — Images',
    'sources/videos': 'Sources — Videos',
    'sources/notes': 'Sources — Notes',
    sources: 'Sources',
    _root: 'Other',
  }

  const result: PageGroup[] = []
  const seen = new Set<string>()

  for (const dir of ORDER) {
    if (groups[dir] && groups[dir].length > 0) {
      result.push({ label: LABELS[dir] || dir, icon: dir, pages: groups[dir] })
      seen.add(dir)
    }
  }
  // Remaining dirs not in ORDER
  for (const [dir, pages] of Object.entries(groups)) {
    if (!seen.has(dir) && pages.length > 0) {
      result.push({ label: LABELS[dir] || dir, icon: dir, pages })
    }
  }
  return result
}

export const WikiApp: React.FC = () => {
  const showCommandPalette = useUIStore((s) => s.showCommandPalette)
  const [stats, setStats] = useState<WikiStats | null>(null)
  const [pages, setPages] = useState<WikiPage[]>([])
  const [selectedPage, setSelectedPage] = useState<string | null>(null)
  const [pageContent, setPageContent] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [showSystem, setShowSystem] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'list' | 'graph'>('list')
  const [showChat, setShowChat] = useState(false)

  const queue = useWikiIngestStore((s) => s.queue)
  const autoIngest = useWikiIngestStore((s) => s.autoIngest)
  const setAutoIngest = useWikiIngestStore((s) => s.setAutoIngest)
  const clearDone = useWikiIngestStore((s) => s.clearDone)

  // Split pages into content vs system
  const contentPages = useMemo(() => pages.filter((p) => !isSystemFile(p.relPath)), [pages])
  const systemPages = useMemo(() => pages.filter((p) => isSystemFile(p.relPath)), [pages])
  const pageGroups = useMemo(() => groupContentPages(contentPages), [contentPages])

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

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    if (queue.some((q) => q.status === 'done')) refresh()
  }, [queue, refresh])

  // ── Actions ──
  const handleOpenPage = useCallback(async (relPath: string) => {
    setSelectedPage(relPath)
    setConfirmDelete(null)
    const res = await window.api.wiki.read(relPath)
    if (res.ok) setPageContent(res.data || '')
  }, [])

  const handleDeletePage = useCallback(async (relPath: string) => {
    const res = await window.api.wiki.delete(relPath)
    if (res.ok) {
      if (selectedPage === relPath) {
        setSelectedPage(null)
        setPageContent('')
      }
      setConfirmDelete(null)
      refresh()
    }
  }, [selectedPage, refresh])

  const handleRevealWiki = useCallback(() => {
    if (stats?.root) window.api.shell.revealPath(stats.root)
  }, [stats])

  const handleIngestNow = useCallback(async (itemId: string) => {
    await runIngest(itemId)
  }, [])

  const blurClass = showCommandPalette
    ? 'opacity-50 transition-opacity duration-200'
    : 'transition-opacity duration-200'

  // ── Render ──
  return (
    <div className={`flex-1 flex flex-col overflow-hidden ${blurClass}`}>
      {/* Header */}
      <div className="shrink-0 border-b border-border-subtle px-6 py-4">
        <div className="flex items-center gap-3 mb-2">
          <BookOpen size={18} className="text-accent-main" />
          <h1 className="text-[17px] font-semibold text-tx-main">Wiki</h1>
          {stats && (
            <span className="text-[12px] text-tx-faint">
              {contentPages.length} page{contentPages.length === 1 ? '' : 's'}
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
          <button
            onClick={() => setShowChat(!showChat)}
            className={`p-1.5 rounded-md transition-colors ${
              showChat ? 'text-accent-main bg-accent-main/10' : 'text-tx-faint hover:text-tx-main hover:bg-bg-hover'
            }`}
            title={showChat ? 'Hide Chat' : 'Ask the Wiki'}
          >
            <MessageSquare size={13} />
          </button>
        </div>
        {/* Content type breakdown (skip system pages from count) */}
        {contentPages.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {pageGroups.map((g) => (
              <span
                key={g.label}
                className="text-[11px] text-tx-muted px-2 py-0.5 rounded-full bg-bg-hover border border-border-subtle"
              >
                {g.label}: {g.pages.length}
              </span>
            ))}
          </div>
        )}
        {stats?.lastLogEntry && (
          <div className="text-[11px] text-tx-faint mt-2 font-mono truncate">
            Last: {stats.lastLogEntry}
          </div>
        )}
      </div>

      {/* Main area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left — Ingest Queue + Content Pages + System */}
        <div className="w-[260px] shrink-0 border-r border-border-subtle flex flex-col overflow-hidden">
          {/* Queue section */}
          <div className="shrink-0 border-b border-border-subtle p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] uppercase tracking-wider text-tx-faint">
                Ingest Queue ({queue.length})
              </div>
              <button
                onClick={() => setAutoIngest(!autoIngest)}
                className={`flex items-center gap-1 text-[11px] transition-colors ${
                  autoIngest ? 'text-accent-main' : 'text-tx-faint hover:text-tx-muted'
                }`}
                title={autoIngest ? 'Auto-ingest on — click to pause' : 'Auto-ingest off — click to enable'}
              >
                {autoIngest ? <Play size={9} /> : <Pause size={9} />}
                {autoIngest ? 'auto' : 'manual'}
              </button>
            </div>
            {queue.length === 0 ? (
              <div className="text-[12px] text-tx-faint">
                No items queued. Add to Collector to trigger.
              </div>
            ) : (
              <div className="space-y-1 max-h-[240px] overflow-y-auto scroll-thin">
                {queue.map((q) => (
                  <div
                    key={q.itemId}
                    className="flex items-center gap-2 px-2 py-1.5 rounded border border-border-subtle bg-bg-hover/30 text-[11px]"
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
                      {q.status === 'running' && q.step
                        ? q.step
                        : `${q.itemType} · ${q.itemId.slice(0, 8)}`}
                    </span>
                    {q.status === 'pending' && (
                      <button
                        onClick={() => handleIngestNow(q.itemId)}
                        className="text-[10px] text-accent-main hover:text-accent-main/80"
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
                    className="w-full mt-2 text-[11px] text-tx-faint hover:text-tx-muted flex items-center justify-center gap-1 py-1"
                  >
                    <Trash2 size={9} />
                    Clear done
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Content pages (grouped by directory) */}
          <div className="flex-1 overflow-y-auto scroll-thin p-3">
            {contentPages.length === 0 ? (
              <div className="text-[12px] text-tx-faint py-2">
                No pages yet. Ingest a collector item to start.
              </div>
            ) : (
              <div className="space-y-3">
                {pageGroups.map((group) => (
                  <div key={group.label}>
                    <div className="text-[11px] uppercase tracking-wider text-tx-faint mb-1.5">
                      {group.label}
                    </div>
                    <div className="space-y-0.5">
                      {group.pages.map((p) => (
                        <div key={p.relPath} className="group flex items-center">
                          <button
                            onClick={() => handleOpenPage(p.relPath)}
                            className={`flex-1 flex items-start gap-2 px-2 py-1.5 rounded text-left transition-colors min-w-0 ${
                              selectedPage === p.relPath
                                ? 'bg-bg-active text-tx-active'
                                : 'text-tx-muted hover:bg-bg-hover hover:text-tx-main'
                            }`}
                          >
                            <FileText size={12} className="mt-0.5 shrink-0 text-tx-faint" />
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] truncate">{p.title}</div>
                            </div>
                          </button>
                          {/* Delete button (appears on hover) */}
                          <button
                            onClick={(e) => { e.stopPropagation(); setConfirmDelete(p.relPath) }}
                            className="opacity-0 group-hover:opacity-100 p-1 rounded text-tx-faint hover:text-status-error transition-all shrink-0"
                            title="Delete page"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* System files — collapsed by default */}
            {systemPages.length > 0 && (
              <div className="mt-4 pt-3 border-t border-border-subtle">
                <button
                  onClick={() => setShowSystem(!showSystem)}
                  className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-tx-faint hover:text-tx-muted transition-colors w-full"
                >
                  {showSystem ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                  <Settings size={9} />
                  System ({systemPages.length})
                </button>
                {showSystem && (
                  <div className="space-y-0.5 mt-1">
                    {systemPages.map((p) => (
                      <button
                        key={p.relPath}
                        onClick={() => handleOpenPage(p.relPath)}
                        className={`w-full flex items-start gap-2 px-2 py-1.5 rounded text-left transition-colors ${
                          selectedPage === p.relPath
                            ? 'bg-bg-active text-tx-active'
                            : 'text-tx-faint hover:bg-bg-hover hover:text-tx-muted'
                        }`}
                      >
                        <Settings size={10} className="mt-0.5 shrink-0" />
                        <div className="text-[11px] truncate">{p.title || p.relPath}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right — Page preview / Graph */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* View mode toggle */}
          <div className="shrink-0 flex items-center gap-1 px-4 pt-3 pb-1">
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] transition-colors ${
                viewMode === 'list' ? 'bg-bg-active text-tx-active' : 'text-tx-faint hover:text-tx-muted hover:bg-bg-hover'
              }`}
            >
              <List size={13} /> Pages
            </button>
            <button
              onClick={() => setViewMode('graph')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] transition-colors ${
                viewMode === 'graph' ? 'bg-bg-active text-tx-active' : 'text-tx-faint hover:text-tx-muted hover:bg-bg-hover'
              }`}
            >
              <Network size={13} /> Graph
            </button>
          </div>

          {/* Content area — Pages or Graph */}
          {viewMode === 'graph' && contentPages.length > 0 ? (
            <div className="flex-1 overflow-hidden">
              <Suspense fallback={
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 size={20} className="animate-spin text-accent-main" />
                </div>
              }>
                <WikiGraph onSelectPage={(relPath) => { setViewMode('list'); handleOpenPage(relPath) }} />
              </Suspense>
            </div>
          ) : selectedPage && pageContent ? (
            <div className="flex-1 overflow-y-auto scroll-thin p-6">
              <div className="flex items-center gap-2 mb-3">
                <div className="text-[11px] text-tx-faint font-mono flex-1 truncate">{selectedPage}</div>
                {!isSystemFile(selectedPage) && (
                  confirmDelete === selectedPage ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-status-error">Delete?</span>
                      <button
                        onClick={() => handleDeletePage(selectedPage)}
                        className="text-[11px] text-status-error hover:underline font-medium"
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="text-[11px] text-tx-faint hover:text-tx-muted"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(selectedPage)}
                      className="p-1 rounded text-tx-faint hover:text-status-error transition-colors shrink-0"
                      title="Delete this page"
                    >
                      <Trash2 size={12} />
                    </button>
                  )
                )}
              </div>
              <pre className="text-[13px] text-tx-main whitespace-pre-wrap font-mono leading-relaxed">
                {pageContent}
              </pre>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-tx-faint">
              <BookOpen size={32} />
              <div className="text-sm">
                {contentPages.length === 0 ? 'Empty wiki' : 'Select a page'}
              </div>
              <div className="text-xs text-tx-faint max-w-[320px] text-center leading-relaxed">
                {contentPages.length === 0
                  ? 'Add items to Collector — they\'ll flow here automatically and become wiki pages.'
                  : 'Click any page on the left to read it, or switch to Graph view.'}
              </div>
            </div>
          )}
        </div>

        {/* Chat side panel — slides in from right */}
        {showChat && (
          <div className="w-[380px] shrink-0 border-l border-border-subtle flex flex-col overflow-hidden bg-bg-sidebar">
            <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border-subtle">
              <div className="flex items-center gap-2 text-[13px] text-tx-main font-medium">
                <MessageSquare size={14} className="text-accent-main" />
                Wiki Chat
              </div>
              <button
                onClick={() => setShowChat(false)}
                className="p-1 rounded text-tx-faint hover:text-tx-main transition-colors"
                title="Close chat"
              >
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <Suspense fallback={
                <div className="flex items-center justify-center h-full">
                  <Loader2 size={14} className="animate-spin text-accent-main" />
                </div>
              }>
                <WikiChat onNavigateToPage={(relPath) => { setShowChat(false); setViewMode('list'); handleOpenPage(relPath) }} />
              </Suspense>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
