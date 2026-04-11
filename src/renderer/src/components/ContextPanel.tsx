/**
 * Context Panel — Quick inject notes & collector resources into terminal.
 * Triggered by Cmd+Shift+K.
 *
 * Uses the same Bus search providers as CommandPalette (notes.search,
 * collector.search). Only the action differs: inject path/content into
 * terminal PTY instead of navigating.
 */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  Search, FileText, Folder, Link, Image, Video, Twitter,
  Monitor, Type, X, Terminal, Archive,
} from 'lucide-react'
import { useUIStore } from '../store/useUIStore'
import { getAppBus } from '../core/AppContext'
import type { AppSearchResult } from '../../../shared/app-interface'

// ── Icon map (same as CommandPalette) ──

const ICON_MAP: Record<string, React.FC<{ size?: number; className?: string }>> = {
  'file-text': FileText, link: Link, image: Image, twitter: Twitter,
  archive: Archive, video: Video, monitor: Monitor, type: Type, terminal: Terminal,
}

// ── Highlight ──
// Word-level matching for search results (whole tokens, not fuzzy chars).

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function HighlightMatch({ text, query }: { text?: string; query: string }) {
  const safe = text || ''
  if (!query || !safe) return <>{safe}</>
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]+/gu, ''))
    .filter((t) => t.length >= 2)
  if (tokens.length === 0) return <>{safe}</>
  const pattern = new RegExp(`(${tokens.map(escapeRegex).join('|')})`, 'gi')
  const parts = safe.split(pattern)
  return (
    <>
      {parts.map((part, i) => {
        if (!part) return null
        const isMatch = tokens.some((t) => part.toLowerCase() === t)
        return isMatch
          ? <span key={i} className="text-accent-main font-semibold">{part}</span>
          : <span key={i}>{part}</span>
      })}
    </>
  )
}

// ── Types ──

interface ContextItem {
  id: string
  label: string
  hint?: string
  snippet?: string
  icon: React.FC<{ size?: number; className?: string }>
  category: string
  /** What gets written to the terminal on Enter */
  injectText: string
}

// ── App shortcut map (same as CommandPalette) ──

const APP_SHORTCUTS: Record<string, { searchCap: string; label: string }> = {
  'n': { searchCap: 'notes.search', label: 'Notes' },
  'c': { searchCap: 'collector.search', label: 'Collector' },
}

// ── Component ──

export function ContextPanel() {
  const show = useUIStore((s) => s.showContextPanel)
  const setShow = useUIStore((s) => s.setShowContextPanel)
  if (!show) return null
  return <ContextPanelInner onClose={() => setShow(false)} />
}

function ContextPanelInner({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [searchResults, setSearchResults] = useState<ContextItem[]>([])
  const [noteFiles, setNoteFiles] = useState<ContextItem[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const liteHome = useUIStore((s) => s.liteHome)
  const recentFiles = useUIStore((s) => s.recentFiles)

  // Recency lookup: path → rank (higher = more recent).
  const recentRankByPath = useMemo(() => {
    const map = new Map<string, number>()
    recentFiles.forEach((f, i) => {
      if (f.path) map.set(f.path, recentFiles.length - i)
    })
    return map
  }, [recentFiles])

  // App shortcut detection (e.g. "n design")
  const appShortcut = query.length >= 2 && query[1] === ' ' && APP_SHORTCUTS[query[0]]
    ? APP_SHORTCUTS[query[0]] : null
  const searchQuery = appShortcut ? query.slice(2).trim() : query.trim()

  // Load note file list on mount (for browsing when no query)
  useEffect(() => {
    if (!liteHome) return
    window.api.fs.readDir(`${liteHome}/notes`).then((res) => {
      if (!res.ok) return
      setNoteFiles(res.data.map((node: any) => ({
        id: `note-${node.path}`,
        label: node.name,
        hint: node.isDirectory ? 'folder' : '',
        icon: node.isDirectory ? Folder : FileText,
        category: 'Notes',
        injectText: node.path,
      })))
    }).catch(() => {})
  }, [liteHome])

  // Bus search (debounced) — same providers as CommandPalette
  useEffect(() => {
    if (searchQuery.length < 1) { setSearchResults([]); setSearching(false); return }
    setSearching(true)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(async () => {
      const bus = getAppBus()
      // Each app's ranking is preserved; cross-app order is fixed by priority.
      const APP_PRIORITY = ['notes.search', 'collector.search']
      const providers = appShortcut
        ? APP_PRIORITY.filter((cap) => cap === appShortcut.searchCap)
        : APP_PRIORITY
      const perAppResults = await Promise.all(
        providers.filter((cap) => bus.has(cap))
          .map((cap) =>
            bus.request<AppSearchResult[]>(cap, { query: searchQuery })
              .then((res) => res || [])
              .catch(() => [] as AppSearchResult[]),
          ),
      )
      const allResults = perAppResults.flat()

      setSearchResults(allResults.map((r): ContextItem => {
        const action = r.action
        const injectText = action?.type === 'open-file'
          ? (action.path.includes(' ') ? `"${action.path}"` : action.path)
          : action?.type === 'open-url' ? action.url
          : r.title || ''
        return {
          id: r.id,
          label: r.title,
          hint: r.subtitle,
          snippet: r.snippet,
          icon: ICON_MAP[r.icon || ''] || Archive,
          category: r.source === 'notes.app' ? 'Notes Results' : 'Collector Results',
          injectText,
        }
      }))
      setSearching(false)
    }, 200)
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
  }, [searchQuery, appShortcut?.searchCap])

  // Merge: search results first, then browsable files (when no query).
  // In both cases, recently-used files get a recency bump to the top.
  const items = useMemo(() => {
    const rank = (item: ContextItem): number => {
      // item.id is `note-${path}` for browse mode, or from bus search
      const path = item.id.startsWith('note-') ? item.id.slice(5) : item.injectText
      return recentRankByPath.get(path) || 0
    }
    if (searchQuery) {
      // Stable sort: recency boost * large constant, preserve search order for non-recent
      return [...searchResults].sort((a, b) => rank(b) - rank(a))
    }
    // Browse mode — recent files first, then the rest in their original order
    return [...noteFiles].sort((a, b) => rank(b) - rank(a))
  }, [searchQuery, searchResults, noteFiles, recentRankByPath])

  // Clamp selection
  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, items.length - 1)))
  }, [items.length])

  // Inject into terminal
  const inject = useCallback((item: ContextItem) => {
    const { activeTerminalId } = useUIStore.getState()
    if (!activeTerminalId) return
    window.api.terminal.write(activeTerminalId, item.injectText)
    onClose()
  }, [onClose])

  // Keyboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault(); setSelectedIndex((p) => Math.min(p + 1, items.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault(); setSelectedIndex((p) => Math.max(p - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const item = items[selectedIndex]
        if (item) inject(item)
      } else if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'Tab') {
        e.preventDefault()
        if (!appShortcut) setQuery('n ')
        else if (appShortcut.searchCap === 'notes.search') setQuery('c ')
        else setQuery('')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [items, selectedIndex, inject, onClose, appShortcut])

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  useEffect(() => { inputRef.current?.focus() }, [])

  const placeholder = appShortcut ? `Search ${appShortcut.label}...` : 'Search notes & collector → inject to terminal'

  return (
    <>
      <div className="fixed inset-0 z-[100]" onClick={onClose} />
      <div className="fixed top-[12%] left-1/2 -translate-x-1/2 w-[90%] max-w-[520px] z-[101]
        bg-bg-popover rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.5)] border border-border-strong
        flex flex-col overflow-hidden">

        {/* Input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
          <Search size={14} className="text-tx-faint shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0) }}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-[13px] text-tx-main outline-none placeholder:text-tx-faint"
          />
          {appShortcut && <span className="text-[10px] text-accent-main px-1.5 py-0.5">{appShortcut.label}</span>}
          {query && (
            <button onClick={() => { setQuery(''); inputRef.current?.focus() }} className="text-tx-faint hover:text-tx-main">
              <X size={12} />
            </button>
          )}
        </div>

        {/* Shortcuts */}
        {!appShortcut && !searchQuery && (
          <div className="flex items-center gap-1.5 px-4 py-1.5 border-b border-border-subtle">
            {Object.entries(APP_SHORTCUTS).map(([key, { label }]) => (
              <button key={key} className="text-[10px] text-tx-faint bg-bg-hover px-1.5 py-0.5 rounded border border-border-subtle hover:text-tx-muted"
                onClick={() => { setQuery(`${key} `); inputRef.current?.focus() }}>{key} {label}</button>
            ))}
          </div>
        )}

        {/* Results */}
        <div ref={listRef} className="max-h-[320px] overflow-y-auto py-1">
          {searching && <div className="px-4 py-6 text-center text-[13px] text-tx-faint">Searching...</div>}
          {!searching && items.length === 0 && (
            <div className="px-4 py-6 text-center text-[13px] text-tx-faint">
              {searchQuery ? 'No results' : 'Type to search'}
            </div>
          )}
          {items.map((item, idx) => {
            const isSelected = idx === selectedIndex
            return (
              <div
                key={item.id}
                data-index={idx}
                className={`flex items-center gap-2 px-4 py-[5px] cursor-pointer text-[13px]
                  ${isSelected ? 'bg-accent-main/15 text-tx-main' : 'text-tx-muted hover:bg-bg-hover'}`}
                onClick={() => inject(item)}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <item.icon size={14} className={isSelected ? 'text-accent-main' : 'text-tx-faint'} />
                <div className="flex-1 min-w-0">
                  <div className="truncate">
                    <HighlightMatch text={item.label} query={searchQuery} />
                  </div>
                  {item.snippet && (
                    <div className="text-[11px] text-tx-faint truncate">
                      <HighlightMatch text={item.snippet} query={searchQuery} />
                    </div>
                  )}
                </div>
                {item.hint && <span className="text-[11px] text-tx-faint truncate max-w-[100px] shrink-0">{item.hint}</span>}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-border-subtle text-[10px] text-tx-faint">
          <span><kbd className="bg-bg-hover px-1 py-0.5 rounded border border-border-subtle">Enter</kbd> inject to terminal</span>
          <span><kbd className="bg-bg-hover px-1 py-0.5 rounded border border-border-subtle">Tab</kbd> switch mode</span>
        </div>
      </div>
    </>
  )
}
