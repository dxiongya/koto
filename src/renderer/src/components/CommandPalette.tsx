import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  Search, FileText, FileCode, Terminal, Settings, Globe, Archive,
  Plus, PanelLeft, Moon, Sun, ArrowRight, Hash, Clock, HelpCircle,
  Link, Image, Video, Twitter, Monitor, Type,
} from 'lucide-react'
import { useUIStore, genTerminalPersistKey } from '../store/useUIStore'
import type { AppType } from '../../../shared/types'

// ── Types ──

interface PaletteItem {
  id: string
  label: string
  hint?: string
  detail?: string
  shortcut?: string
  icon: React.FC<{ size?: number; className?: string }>
  category: string
  action: () => void
  boost?: number
  keepOpen?: boolean
}

import { fuzzyMatch, fuzzyScore } from '../utils/fuzzySearch'

// ── Highlight matched chars ──

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
        c.matched ? (
          <span key={i} className="text-accent-main font-semibold">{c.char}</span>
        ) : (
          <span key={i}>{c.char}</span>
        ),
      )}
    </>
  )
}

// ── File tree flattener ──

async function flattenFileTree(basePath: string, prefix = ''): Promise<{ name: string; path: string }[]> {
  const result: { name: string; path: string }[] = []
  try {
    const res = await window.api.fs.readDir(basePath)
    if (!res.ok) return result
    for (const node of res.data) {
      const rel = prefix ? `${prefix}/${node.name}` : node.name
      if (node.isDirectory) {
        const children = await flattenFileTree(node.path, rel)
        result.push(...children)
      } else {
        result.push({ name: rel, path: node.path })
      }
    }
  } catch {}
  return result
}

// ── App metadata ──

const APP_META: Record<AppType, { label: string; icon: React.FC<{ size?: number; className?: string }> }> = {
  'notes.app': { label: 'Notes', icon: FileText },
  'code.app': { label: 'Code', icon: FileCode },
  'terminal.app': { label: 'Terminal', icon: Terminal },
  'browser.app': { label: 'Browser', icon: Globe },
  'collector.app': { label: 'Collector', icon: Archive },
  'settings.app': { label: 'Settings', icon: Settings },
}

// ── Help items ──

const HELP_ITEMS: PaletteItem[] = [
  { id: 'help:files', label: 'Type to search files by name', icon: Search, category: 'Help', action: () => {} },
  { id: 'help:cmd', label: '> Commands and actions', icon: Settings, category: 'Help', action: () => {} },
  { id: 'help:search', label: '# Search file contents', icon: Hash, category: 'Help', action: () => {} },
  { id: 'help:collector', label: 'collector: Search collected items', icon: Archive, category: 'Help', action: () => {} },
  { id: 'help:line', label: ': Go to line number', icon: ArrowRight, category: 'Help', action: () => {} },
  { id: 'help:camel', label: 'ABC CamelCase abbreviation (e.g. CP → CommandPalette)', icon: FileCode, category: 'Help', action: () => {} },
]

// ── Component ──

export const CommandPalette: React.FC = () => {
  const show = useUIStore((s) => s.showCommandPalette)
  const setShow = useUIStore((s) => s.setShowCommandPalette)

  if (!show) return null

  return <CommandPaletteInner onClose={() => setShow(false)} />
}

function CommandPaletteInner({ onClose }: { onClose: () => void }) {
  // Pick up initial query from store (e.g. '>' from Cmd+Shift+P)
  const initialQuery = useUIStore((s) => s._commandPaletteInitialQuery)
  const [query, setQuery] = useState(initialQuery || '')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Clear the initial query flag
  useEffect(() => {
    if (initialQuery) {
      useUIStore.setState({ _commandPaletteInitialQuery: null })
    }
  }, [initialQuery])

  // Store data
  const liteHome = useUIStore((s) => s.liteHome)
  const codeProjectPath = useUIStore((s) => s.codeProjectPath)
  const terminalSessions = useUIStore((s) => s.terminalSessions)
  const currentApp = useUIStore((s) => s.currentApp)
  const theme = useUIStore((s) => s.theme)
  const recentFiles = useUIStore((s) => s.recentFiles)

  // Loaded file lists
  const [noteFiles, setNoteFiles] = useState<{ name: string; path: string }[]>([])
  const [codeFiles, setCodeFiles] = useState<{ name: string; path: string }[]>([])
  const [collectorItems, setCollectorItems] = useState<{ id: string; title: string; type: string; url?: string }[]>([])

  // Content search results
  const [searchResults, setSearchResults] = useState<PaletteItem[]>([])
  const [searching, setSearching] = useState(false)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (liteHome) flattenFileTree(`${liteHome}/notes`).then(setNoteFiles)
  }, [liteHome])

  useEffect(() => {
    if (codeProjectPath) flattenFileTree(codeProjectPath).then((f) => setCodeFiles(f.slice(0, 200)))
  }, [codeProjectPath])

  // Load collector items for global search
  useEffect(() => {
    window.api.collector.list().then((res) => {
      if (res.ok) setCollectorItems(res.data.map((i: { id: string; title: string; type: string; url?: string }) => ({ id: i.id, title: i.title, type: i.type, url: i.url })))
    })
  }, [])

  useEffect(() => { inputRef.current?.focus() }, [])

  // ── Mode detection ──
  // > = commands/system, # = content search (notes + collector), : = line, ? = help
  const isCommandMode = query.startsWith('>')
  const isContentMode = query.startsWith('#')  // content + collector search
  const isLineMode = query.startsWith(':')
  const isHelpMode = query.startsWith('?')
  const searchQuery = (isCommandMode || isContentMode || isLineMode || isHelpMode)
    ? query.slice(1).trim()
    : query.trim()

  // ── Unified Bus search — each app provides its own search via AppBus ──
  // Notes → 'notes.search', Collector → 'collector.search', future apps → '*.search'

  const SEARCH_ICON_MAP: Record<string, React.FC<{ size?: number; className?: string }>> = {
    'file-text': FileText, link: Link, image: Image, twitter: Twitter,
    archive: Archive, video: Video, monitor: Monitor, type: Type,
  }

  const shouldSearch = (isContentMode && searchQuery.length >= 1) ||
    (!isCommandMode && !isLineMode && !isHelpMode && searchQuery.length >= 2)

  useEffect(() => {
    if (!shouldSearch) { setSearchResults([]); setSearching(false); return }
    setSearching(true)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(async () => {
      const bus = (await import('../core/AppContext')).getAppBus()

      // Fan out to all registered search providers
      const providers = ['notes.search', 'collector.search']
      const results = await Promise.all(
        providers
          .filter((cap) => bus.has(cap))
          .map((cap) => bus.request<any[]>(cap, { query: searchQuery }).catch(() => null)),
      )

      // Merge + sort by score
      const allResults = results.flat().filter(Boolean) as import('../../../../shared/app-interface').AppSearchResult[]
      allResults.sort((a, b) => b.score - a.score)

      // Convert to PaletteItems
      const items: PaletteItem[] = allResults.map((r) => ({
        id: r.id,
        label: r.title,
        hint: r.subtitle,
        detail: r.snippet,
        icon: SEARCH_ICON_MAP[r.icon || ''] || Archive,
        category: r.source === 'notes.app' ? 'Notes Results' : 'Collector Results',
        action: () => {
          const store = useUIStore.getState()
          if (r.action.type === 'open-file') {
            const app: AppType = r.source === 'notes.app' ? 'notes.app' : 'code.app'
            store.setCurrentApp(app)
            useUIStore.setState({
              appStates: { ...store.appStates, [app]: { ...store.appStates[app], activeFilePath: r.action.path } },
            })
            if (r.action.line) {
              setTimeout(() => window.dispatchEvent(new CustomEvent('lite:goto-line', { detail: { line: r.action.line } })), 100)
            }
          } else if (r.action.type === 'open-url') {
            window.open(r.action.url, '_blank')
          } else if (r.action.type === 'navigate') {
            store.setCurrentApp(r.action.app as AppType)
          }
        },
      }))

      setSearchResults(items)
      setSearching(false)
    }, 250)
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
  }, [shouldSearch, searchQuery])

  // Recent files lookup
  const recentPathSet = useMemo(() => {
    const map = new Map<string, number>()
    recentFiles.forEach((f, i) => map.set(f.path, recentFiles.length - i))
    return map
  }, [recentFiles])

  // ── Build items ──
  const items = useMemo((): PaletteItem[] => {
    const store = useUIStore.getState()

    if (isHelpMode) return HELP_ITEMS
    if (isContentMode) return searchResults
    if (isLineMode) {
      // ":42" → go to line (only meaningful in code.app / notes.app)
      const lineNum = parseInt(searchQuery, 10)
      if (lineNum > 0) {
        return [{
          id: 'line:goto',
          label: `Go to line ${lineNum}`,
          icon: ArrowRight,
          category: 'Navigation',
          action: () => {
            // Dispatch a custom event that CodeMirror can listen to
            window.dispatchEvent(new CustomEvent('lite:goto-line', { detail: { line: lineNum } }))
          },
        }]
      }
      return [{ id: 'line:hint', label: 'Type a line number...', icon: ArrowRight, category: 'Navigation', action: () => {} }]
    }

    const all: PaletteItem[] = []

    if (isCommandMode) {
      const commands: PaletteItem[] = [
        {
          id: 'cmd:new-note', label: 'New Note', icon: Plus, category: 'Actions',
          action: () => store.setCurrentApp('notes.app'),
        },
        {
          id: 'cmd:new-terminal', label: 'New Terminal', icon: Terminal, category: 'Actions',
          action: async () => {
            const cwd = store.codeProjectPath ?? undefined
            const res = await window.api.terminal.create(cwd)
            if (res.ok) {
              store.addTerminalSession({ id: res.data, persistKey: genTerminalPersistKey(), title: `Terminal ${store.terminalSessions.length + 1}`, cwd })
              store.setCurrentApp('terminal.app')
            }
          },
        },
        {
          id: 'cmd:toggle-sidebar', label: 'Toggle Sidebar', shortcut: '⌘\\', icon: PanelLeft, category: 'Actions',
          action: () => store.toggleSidebar(),
        },
        {
          id: 'cmd:toggle-theme',
          label: theme.includes('dark') ? 'Switch to Light Theme' : 'Switch to Dark Theme',
          icon: theme.includes('dark') ? Sun : Moon, category: 'Actions',
          action: () => {
            const isDark = theme.includes('dark')
            store.setTheme(isDark ? theme.replace('dark', 'light') : theme.replace('light', 'dark'))
          },
        },
        {
          id: 'cmd:open-project', label: 'Open Project Folder', icon: FileCode, category: 'Actions',
          action: async () => {
            const res = await window.api.project.open()
            if (res.ok) { store.setCodeProjectPath(res.data); store.addRecentProject(res.data); store.setCurrentApp('code.app') }
          },
        },
        {
          id: 'cmd:settings', label: 'Open Settings', icon: Settings, category: 'Actions',
          action: () => store.setCurrentApp('settings.app'),
        },
        {
          id: 'cmd:search-collector', label: 'Search Collector', icon: Archive, category: 'Actions',
          keepOpen: true,
          action: () => { setQuery('collector:'); setTimeout(() => inputRef.current?.focus(), 0) },
        },
        {
          id: 'cmd:go-back', label: 'Go Back', shortcut: '⌃-', icon: ArrowRight, category: 'Navigation',
          action: () => store.navigateBack(),
        },
        {
          id: 'cmd:go-forward', label: 'Go Forward', shortcut: '⌃⇧-', icon: ArrowRight, category: 'Navigation',
          action: () => store.navigateForward(),
        },
      ]

      for (const [appId, meta] of Object.entries(APP_META)) {
        if (appId === currentApp) continue
        commands.push({
          id: `cmd:switch-${appId}`, label: `Switch to ${meta.label}`, icon: meta.icon, category: 'Apps',
          action: () => store.setCurrentApp(appId as AppType),
        })
      }
      return commands
    }

    // ── Default file search mode ──

    // Recent files
    for (const recent of recentFiles.slice(0, 10)) {
      const fileName = recent.path.split('/').pop() || recent.path
      const isNote = recent.app === 'notes.app'
      all.push({
        id: `recent:${recent.path}`,
        label: fileName,
        hint: isNote ? 'notes' : recent.path.split('/').slice(-2, -1)[0],
        icon: Clock,
        category: 'Recent',
        boost: recentPathSet.get(recent.path) || 0,
        action: () => {
          store.setCurrentApp(recent.app)
          useUIStore.setState({
            appStates: { ...store.appStates, [recent.app]: { ...store.appStates[recent.app], activeFilePath: recent.path } },
          })
        },
      })
    }

    // Apps
    for (const [appId, meta] of Object.entries(APP_META)) {
      if (appId === currentApp) continue
      all.push({
        id: `app:${appId}`, label: meta.label, icon: meta.icon, category: 'Apps',
        action: () => store.setCurrentApp(appId as AppType),
      })
    }

    // Note files (skip if already in recent)
    for (const file of noteFiles) {
      if (recentPathSet.has(file.path)) continue
      all.push({
        id: `note:${file.path}`, label: file.name, icon: FileText, category: 'Notes',
        // Boost if currently in notes.app
        boost: currentApp === 'notes.app' ? 5 : 0,
        action: () => {
          store.setCurrentApp('notes.app')
          useUIStore.setState({
            appStates: { ...store.appStates, 'notes.app': { ...store.appStates['notes.app'], activeFilePath: file.path } },
          })
        },
      })
    }

    // Code files (skip if already in recent)
    for (const file of codeFiles) {
      if (recentPathSet.has(file.path)) continue
      all.push({
        id: `code:${file.path}`, label: file.name,
        hint: file.name.split('/').slice(0, -1).join('/') || undefined,
        icon: FileCode, category: 'Code',
        boost: currentApp === 'code.app' ? 5 : 0,
        action: () => {
          store.setCurrentApp('code.app')
          useUIStore.setState({
            appStates: { ...store.appStates, 'code.app': { ...store.appStates['code.app'], activeFilePath: file.path } },
          })
        },
      })
    }

    // Terminals
    for (const session of terminalSessions) {
      all.push({
        id: `term:${session.id}`, label: session.title, hint: session.cwd?.split('/').pop(),
        icon: Terminal, category: 'Terminals',
        action: () => { store.setCurrentApp('terminal.app'); store.setActiveTerminalId(session.id) },
      })
    }

    // Collector items (static list — subject to fuzzyMatch filtering)
    if (collectorItems.length > 0 && !searchQuery) {
      const CTYPE_ICONS: Record<string, typeof Link> = { link: Link, image: Image, video: Video, tweet: Twitter, screenshot: Monitor, text: Type }
      for (const ci of collectorItems) {
        all.push({
          id: `collector:${ci.id}`,
          label: ci.title,
          hint: 'collector',
          icon: CTYPE_ICONS[ci.type] || Archive,
          category: 'Collector Items',
          boost: currentApp === 'collector.app' ? 5 : 0,
          action: () => {
            store.setCurrentApp('collector.app')
            useUIStore.setState({
              appStates: { ...store.appStates, 'collector.app': { ...store.appStates['collector.app'], activeFilePath: 'all' } },
            })
          },
        })
      }
    }

    // Quick actions
    all.push(
      { id: 'action:new-note', label: 'New Note', icon: Plus, category: 'Actions', action: () => store.setCurrentApp('notes.app') },
      {
        id: 'action:new-terminal', label: 'New Terminal', icon: Plus, category: 'Actions',
        action: async () => {
          const cwd = store.codeProjectPath ?? undefined
          const res = await window.api.terminal.create(cwd)
          if (res.ok) {
            store.addTerminalSession({ id: res.data, persistKey: genTerminalPersistKey(), title: `Terminal ${store.terminalSessions.length + 1}`, cwd })
            store.setCurrentApp('terminal.app')
          }
        },
      },
    )

    // Merge async content search results into default mode
    if (searchResults.length > 0) all.push(...searchResults)
    return all
  }, [isCommandMode, isContentMode, isLineMode, isHelpMode, searchResults, noteFiles, codeFiles, collectorItems, terminalSessions, currentApp, codeProjectPath, theme, recentFiles, recentPathSet, searchQuery])

  // ── Filter + sort ──
  // Content search results (category 'Content Matches' / 'Collector') bypass fuzzyMatch
  // because they're already validated by the backend search.
  const filtered = useMemo(() => {
    if (isContentMode || isLineMode || isHelpMode) return items
    if (!searchQuery) return items
    // Bus search results bypass fuzzyMatch (already ranked by backend)
    const busCategories = new Set(['Notes Results', 'Collector Results'])
    return items
      .filter((item) => busCategories.has(item.category) || fuzzyMatch(searchQuery, item.label))
      .sort((a, b) => {
        // Bus results first (already sorted by score), then fuzzy matches
        const isA = busCategories.has(a.category) ? 1 : 0
        const isB = busCategories.has(b.category) ? 1 : 0
        if (isA !== isB) return isB - isA
        // Within same tier, use fuzzy score
        const scoreA = fuzzyScore(searchQuery, a.label) + (a.boost || 0) * 2
        const scoreB = fuzzyScore(searchQuery, b.label) + (b.boost || 0) * 2
        return scoreB - scoreA
      })
  }, [items, searchQuery, isContentMode, isLineMode, isHelpMode])

  // ── Group by category ──
  const grouped = useMemo(() => {
    const groups: { category: string; items: PaletteItem[] }[] = []
    const categoryOrder = isHelpMode
      ? ['Help']
      : isLineMode
        ? ['Navigation']
        : ['Notes Results', 'Collector Results', 'Recent', 'Actions', 'Apps', 'Notes', 'Code', 'Collector Items', 'Terminals', 'Navigation']
    const map = new Map<string, PaletteItem[]>()
    for (const item of filtered) {
      const arr = map.get(item.category) || []
      arr.push(item)
      map.set(item.category, arr)
    }
    const hasQuery = searchQuery.length > 0
    for (const cat of categoryOrder) {
      if (hasQuery && cat === 'Recent') continue
      const catItems = map.get(cat)
      if (catItems?.length) groups.push({ category: cat, items: catItems.slice(0, 10) })
    }
    return groups
  }, [filtered, isContentMode, isContentMode, isHelpMode, isLineMode, searchQuery])

  const flatItems = useMemo(() => grouped.flatMap((g) => g.items), [grouped])

  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(flatItems.length - 1, 0)))
  }, [flatItems.length])

  const executeSelected = useCallback(() => {
    const item = flatItems[selectedIndex]
    if (item) { if (!item.keepOpen) onClose(); item.action() }
  }, [flatItems, selectedIndex, onClose])

  // Keyboard navigation
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
        executeSelected()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [flatItems.length, executeSelected, onClose])

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const placeholder = isCommandMode ? 'Type a command...'
    : isContentMode ? 'Search notes & collector content...'
    : isLineMode ? 'Type a line number...'
    : isHelpMode ? ''
    : 'Search files, apps, actions...'

  const modeIcon = isContentMode ? Hash
    : isLineMode ? ArrowRight
    : isHelpMode ? HelpCircle
    : Search

  const ModeIcon = modeIcon

  return (
    <>
      <div className="fixed inset-0 z-[100] bg-bg-app/20" role="presentation" onClick={onClose} />
      <div className="fixed top-[12%] left-1/2 -translate-x-1/2 w-[90%] max-w-[520px] bg-bg-popover rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.5)] border border-border-strong overflow-hidden z-[101] flex flex-col">
        {/* Input */}
        <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border-subtle">
          <ModeIcon size={15} className={isCommandMode || isContentMode || isLineMode ? 'text-accent-main shrink-0' : 'text-tx-faint shrink-0'} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0) }}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-tx-main text-[13px] outline-none placeholder:text-tx-faint"
            spellCheck={false}
          />
          {!isCommandMode && !isContentMode && !isLineMode && !isHelpMode && (
            <div className="flex items-center gap-1.5">
              <button type="button" aria-label="Command mode" className="text-[10px] text-tx-faint bg-bg-hover px-1.5 py-0.5 rounded border border-border-subtle cursor-pointer hover:text-tx-muted focus-visible:ring-1 focus-visible:ring-accent-main/50"
                onClick={() => { setQuery('>'); inputRef.current?.focus() }}>{'>'}</button>
              <button type="button" aria-label="Search content" className="text-[10px] text-tx-faint bg-bg-hover px-1.5 py-0.5 rounded border border-border-subtle cursor-pointer hover:text-tx-muted focus-visible:ring-1 focus-visible:ring-accent-main/50"
                onClick={() => { setQuery('#'); inputRef.current?.focus() }}>#</button>
              <button type="button" aria-label="Go to line" className="text-[10px] text-tx-faint bg-bg-hover px-1.5 py-0.5 rounded border border-border-subtle cursor-pointer hover:text-tx-muted focus-visible:ring-1 focus-visible:ring-accent-main/50"
                onClick={() => { setQuery(':'); inputRef.current?.focus() }}>:</button>
              <button type="button" aria-label="Help" className="text-[10px] text-tx-faint bg-bg-hover px-1.5 py-0.5 rounded border border-border-subtle cursor-pointer hover:text-tx-muted focus-visible:ring-1 focus-visible:ring-accent-main/50"
                onClick={() => { setQuery('?'); inputRef.current?.focus() }}>?</button>
            </div>
          )}
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[380px] overflow-y-auto py-1">
          {searching ? (
            <div className="px-4 py-6 text-center text-tx-faint text-[13px]">Searching...</div>
          ) : grouped.length === 0 ? (
            <div className="px-4 py-6 text-center text-tx-faint text-[13px]">
              {isContentMode && searchQuery.length < 2 ? 'Type at least 2 characters...' : 'No results found'}
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.category}>
                <div className="px-3.5 pt-2 pb-1 text-[11px] text-tx-faint uppercase tracking-wider">
                  {group.category}
                </div>
                {group.items.map((item) => {
                  const idx = flatItems.indexOf(item)
                  const isSelected = idx === selectedIndex
                  return (
                    <div
                      key={item.id}
                      data-index={idx}
                      onClick={() => { if (!item.keepOpen) onClose(); item.action() }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`flex items-center gap-2.5 px-3.5 py-2 mx-1 rounded-lg cursor-pointer transition-colors ${
                        isSelected ? 'bg-accent-bg text-accent-main' : 'text-tx-main hover:bg-bg-hover'
                      }`}
                    >
                      <item.icon size={15} className={`shrink-0 ${isSelected ? 'text-accent-main' : 'text-tx-faint'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] truncate">
                            <HighlightMatch text={item.label} query={isContentMode || isLineMode || isHelpMode ? '' : searchQuery} />
                          </span>
                          {item.hint && (
                            <span className="text-[11px] text-tx-faint truncate max-w-[140px] shrink-0">{item.hint}</span>
                          )}
                        </div>
                        {item.detail && (
                          <div className="text-[11px] text-tx-faint truncate mt-0.5">
                            <HighlightMatch text={item.detail} query={searchQuery} />
                          </div>
                        )}
                      </div>
                      {item.shortcut && (
                        <kbd className="text-[10px] text-tx-faint bg-bg-hover px-1.5 py-0.5 rounded border border-border-subtle shrink-0">
                          {item.shortcut}
                        </kbd>
                      )}
                      {isSelected && !item.shortcut && (
                        <ArrowRight size={12} className="text-accent-main shrink-0" />
                      )}
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-3.5 py-2 border-t border-border-subtle text-[11px] text-tx-faint">
          <span className="flex items-center gap-1">
            <kbd className="bg-bg-hover px-1 py-0.5 rounded border border-border-subtle">↑↓</kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="bg-bg-hover px-1 py-0.5 rounded border border-border-subtle">↵</kbd> open
          </span>
          <span className="flex items-center gap-1">
            <kbd className="bg-bg-hover px-1 py-0.5 rounded border border-border-subtle">esc</kbd> close
          </span>
        </div>
      </div>
    </>
  )
}
