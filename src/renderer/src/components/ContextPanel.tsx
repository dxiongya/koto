/**
 * Context Panel — Quick reference notes & collector resources from terminal.
 * Triggered by Cmd+Shift+K. Injects file paths / URLs into the active terminal PTY.
 */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Search, FileText, Folder, Link, Image, Video, Twitter, Monitor, Type, X } from 'lucide-react'
import { useUIStore } from '../store/useUIStore'

// ── Types ──

interface ContextItem {
  id: string
  label: string
  hint?: string
  icon: React.FC<{ size?: number; className?: string }>
  category: 'Notes' | 'Collector'
  /** What gets written to the terminal on Enter */
  injectPath: string
  /** Full content for Shift+Enter (notes only) */
  injectContent?: () => Promise<string | null>
}

// ── Fuzzy match ──

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let score = 0, qi = 0, lastMatch = -1
  if (t.includes(q)) score += 50
  if (t === q) score += 100
  if (t.startsWith(q)) score += 30
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += 10
      if (lastMatch === ti - 1) score += 5
      if (ti === 0 || '/.-_ '.includes(t[ti - 1])) score += 8
      lastMatch = ti
      qi++
    }
  }
  if (qi === q.length) score += Math.max(0, 20 - t.length)
  return qi === q.length ? score : 0
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const q = query.toLowerCase()
  const chars: { char: string; matched: boolean }[] = []
  let qi = 0
  for (let i = 0; i < text.length; i++) {
    if (qi < q.length && text[i].toLowerCase() === q[qi]) {
      chars.push({ char: text[i], matched: true })
      qi++
    } else {
      chars.push({ char: text[i], matched: false })
    }
  }
  return (
    <>
      {chars.map((c, i) =>
        c.matched ? <span key={i} className="text-accent-main font-semibold">{c.char}</span> : c.char,
      )}
    </>
  )
}

// ── Collector item icon ──

const collectorIcon: Record<string, React.FC<{ size?: number; className?: string }>> = {
  link: Link, image: Image, video: Video, tweet: Twitter,
  screenshot: Monitor, text: Type,
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
  const [noteItems, setNoteItems] = useState<ContextItem[]>([])
  const [collectorItems, setCollectorItems] = useState<ContextItem[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const liteHome = useUIStore((s) => s.liteHome)

  // Mode detection
  const isNotesMode = query.startsWith('notes:')
  const isCollectorMode = query.startsWith('collector:') || query.startsWith('group:')
  const searchQuery = isNotesMode ? query.slice(6).trim()
    : isCollectorMode ? (query.startsWith('group:') ? query.slice(6).trim() : query.slice(10).trim())
    : query.trim()
  const isGroupMode = query.startsWith('group:')

  // Load notes on mount
  useEffect(() => {
    if (!liteHome) return
    const loadNotes = async () => {
      try {
        const res = await window.api.fs.readDir(`${liteHome}/notes`)
        if (!res.ok) return
        const items: ContextItem[] = []
        const flatten = (nodes: { name: string; path: string; isDirectory: boolean }[], depth = 0) => {
          for (const node of nodes) {
            items.push({
              id: `note-${node.path}`,
              label: node.name,
              hint: node.isDirectory ? 'folder' : node.path.replace(liteHome + '/notes/', ''),
              icon: node.isDirectory ? Folder : FileText,
              category: 'Notes',
              injectPath: node.path,
              injectContent: node.isDirectory ? undefined : async () => {
                const r = await window.api.fs.readFile(node.path)
                return r.ok ? r.data : null
              },
            })
          }
        }
        flatten(res.data)
        setNoteItems(items)
      } catch { /* ignore */ }
    }
    loadNotes()
  }, [liteHome])

  // Load / search collector items (debounced)
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(async () => {
      try {
        let items: ContextItem[] = []
        if (isGroupMode && searchQuery) {
          // Search within a specific group
          const listRes = await window.api.collector.list(200, 0)
          if (listRes.ok) {
            items = listRes.data
              .filter((item: any) => item.group === searchQuery || item.group?.includes(searchQuery))
              .map(mapCollectorItem)
          }
        } else if (searchQuery && searchQuery.length >= 2) {
          const res = await window.api.collector.search(searchQuery)
          if (res.ok) {
            items = res.data.slice(0, 20).map((r: any) => mapCollectorItem(r.item ?? r))
          }
        } else {
          // Default: show recent collector items
          const res = await window.api.collector.list(20, 0)
          if (res.ok) {
            items = res.data.map(mapCollectorItem)
          }
        }
        setCollectorItems(items)
      } catch { /* ignore */ }
    }, searchQuery ? 200 : 0)
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
  }, [searchQuery, isGroupMode])

  function mapCollectorItem(item: any): ContextItem {
    const icon = collectorIcon[item.type] || Link
    const injectPath = item.url || item.assetPath || item.title || ''
    return {
      id: `col-${item.id}`,
      label: item.title || item.url || 'Untitled',
      hint: item.group !== 'all' ? item.group : item.type,
      icon,
      category: 'Collector',
      injectPath,
    }
  }

  // Filter + sort
  const filtered = useMemo(() => {
    const allItems = isNotesMode ? noteItems
      : isCollectorMode ? collectorItems
      : [...noteItems, ...collectorItems]

    if (!searchQuery) return allItems

    return allItems
      .filter((item) => fuzzyMatch(searchQuery, item.label))
      .sort((a, b) => fuzzyScore(searchQuery, b.label) - fuzzyScore(searchQuery, a.label))
  }, [noteItems, collectorItems, searchQuery, isNotesMode, isCollectorMode])

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, ContextItem[]>()
    for (const item of filtered) {
      const arr = map.get(item.category) || []
      arr.push(item)
      map.set(item.category, arr)
    }
    // Limit per category
    for (const [k, v] of map) {
      if (v.length > 15) map.set(k, v.slice(0, 15))
    }
    return map
  }, [filtered])

  const flatItems = useMemo(() => {
    const order = ['Notes', 'Collector']
    const result: ContextItem[] = []
    for (const cat of order) {
      const items = grouped.get(cat)
      if (items) result.push(...items)
    }
    return result
  }, [grouped])

  // Clamp selection
  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, flatItems.length - 1)))
  }, [flatItems.length])

  // Inject into terminal
  const inject = useCallback(async (item: ContextItem, content = false) => {
    const { activeTerminalId } = useUIStore.getState()
    if (!activeTerminalId) return

    let text: string
    if (content && item.injectContent) {
      const c = await item.injectContent()
      text = c ?? item.injectPath
    } else {
      // Escape spaces in paths for shell compatibility
      text = item.injectPath.includes(' ') ? `"${item.injectPath}"` : item.injectPath
    }

    window.api.terminal.write(activeTerminalId, text)
    onClose()
  }, [onClose])

  // Keyboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(prev + 1, flatItems.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const item = flatItems[selectedIndex]
        if (item) inject(item, e.shiftKey)
      } else if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'Tab') {
        e.preventDefault()
        if (!isNotesMode && !isCollectorMode) setQuery('notes:')
        else if (isNotesMode) setQuery('collector:')
        else setQuery('')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [flatItems, selectedIndex, inject, onClose, isNotesMode, isCollectorMode])

  // Auto-scroll selected
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  // Auto-focus
  useEffect(() => { inputRef.current?.focus() }, [])

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[100]" onClick={onClose} />

      {/* Panel */}
      <div className="fixed top-[12%] left-1/2 -translate-x-1/2 w-[90%] max-w-[520px] z-[101]
        bg-bg-popover rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.5)] border border-border-strong
        flex flex-col overflow-hidden"
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
          <Search size={14} className="text-tx-faint shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0) }}
            placeholder={isNotesMode ? 'Search notes...' : isCollectorMode ? (isGroupMode ? 'Group name...' : 'Search collector...') : 'Search notes & collector...'}
            className="flex-1 bg-transparent text-[13px] text-tx-main outline-none placeholder:text-tx-faint"
          />
          {query && (
            <button onClick={() => { setQuery(''); inputRef.current?.focus() }} className="text-tx-faint hover:text-tx-main">
              <X size={12} />
            </button>
          )}
        </div>

        {/* Mode buttons */}
        {!isNotesMode && !isCollectorMode && (
          <div className="flex items-center gap-1.5 px-4 py-1.5 border-b border-border-subtle">
            <button
              onClick={() => { setQuery('notes:'); inputRef.current?.focus() }}
              className="text-[10px] text-tx-faint bg-bg-hover px-1.5 py-0.5 rounded border border-border-subtle hover:text-tx-muted"
            >notes:</button>
            <button
              onClick={() => { setQuery('collector:'); inputRef.current?.focus() }}
              className="text-[10px] text-tx-faint bg-bg-hover px-1.5 py-0.5 rounded border border-border-subtle hover:text-tx-muted"
            >collector:</button>
            <button
              onClick={() => { setQuery('group:'); inputRef.current?.focus() }}
              className="text-[10px] text-tx-faint bg-bg-hover px-1.5 py-0.5 rounded border border-border-subtle hover:text-tx-muted"
            >group:</button>
          </div>
        )}

        {/* Results */}
        <div ref={listRef} className="max-h-[320px] overflow-y-auto py-1">
          {flatItems.length === 0 && (
            <div className="px-4 py-6 text-center text-[13px] text-tx-faint">
              {searchQuery ? 'No results' : 'Loading...'}
            </div>
          )}
          {['Notes', 'Collector'].map((cat) => {
            const items = grouped.get(cat)
            if (!items?.length) return null
            return (
              <div key={cat}>
                <div className="px-4 py-1 text-[10px] text-tx-faint uppercase tracking-widest">{cat}</div>
                {items.map((item) => {
                  const globalIdx = flatItems.indexOf(item)
                  const isSelected = globalIdx === selectedIndex
                  return (
                    <div
                      key={item.id}
                      data-index={globalIdx}
                      className={`flex items-center gap-2 px-4 py-[5px] cursor-pointer text-[13px]
                        ${isSelected ? 'bg-accent-main/15 text-tx-main' : 'text-tx-muted hover:bg-bg-hover'}`}
                      onClick={() => inject(item)}
                      onMouseEnter={() => setSelectedIndex(globalIdx)}
                    >
                      <item.icon size={14} className={isSelected ? 'text-accent-main' : 'text-tx-faint'} />
                      <span className="truncate flex-1">
                        <HighlightMatch text={item.label} query={searchQuery} />
                      </span>
                      {item.hint && (
                        <span className="text-[11px] text-tx-faint truncate max-w-[120px]">{item.hint}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-border-subtle text-[10px] text-tx-faint">
          <span><kbd className="bg-bg-hover px-1 py-0.5 rounded border border-border-subtle">Enter</kbd> inject path</span>
          <span><kbd className="bg-bg-hover px-1 py-0.5 rounded border border-border-subtle">Shift+Enter</kbd> inject content</span>
          <span><kbd className="bg-bg-hover px-1 py-0.5 rounded border border-border-subtle">Tab</kbd> switch mode</span>
        </div>
      </div>
    </>
  )
}
