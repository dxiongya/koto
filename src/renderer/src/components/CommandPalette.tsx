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

// ── Fuzzy match with CamelCase support ──

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  if (qi === q.length) return true

  // CamelCase abbreviation: "CP" matches "CommandPalette"
  if (query === query.toUpperCase() && query.length >= 2) {
    return camelCaseMatch(query, text)
  }
  return false
}

function camelCaseMatch(query: string, text: string): boolean {
  // Extract uppercase letters / word starts from text
  const wordStarts: string[] = []
  for (let i = 0; i < text.length; i++) {
    if (i === 0 || text[i] === text[i].toUpperCase() && text[i] !== text[i].toLowerCase()
      || '/.-_ '.includes(text[i - 1])) {
      wordStarts.push(text[i].toUpperCase())
    }
  }
  const abbr = wordStarts.join('')
  const q = query.toUpperCase()
  let qi = 0
  for (let ai = 0; ai < abbr.length && qi < q.length; ai++) {
    if (abbr[ai] === q[qi]) qi++
  }
  return qi === q.length
}

function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let score = 0
  let qi = 0
  let lastMatch = -1

  if (t.includes(q)) score += 50
  if (t === q) score += 100 // exact match
  if (t.startsWith(q)) score += 30 // prefix match

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += 10
      if (lastMatch === ti - 1) score += 5
      if (ti === 0 || '/.-_ '.includes(t[ti - 1])) score += 8
      if (qi === ti) score += 3
      lastMatch = ti
      qi++
    }
  }
  if (qi === q.length) score += Math.max(0, 20 - t.length)

  // CamelCase bonus
  if (query === query.toUpperCase() && query.length >= 2 && camelCaseMatch(query, text)) {
    score += 40
  }

  return qi === q.length || (query === query.toUpperCase() && camelCaseMatch(query, text)) ? score : 0
}

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
  const isCommandMode = query.startsWith('>')
  const isSearchMode = query.startsWith('#')
  const isCollectorSearch = query.startsWith('collector:')
  const isLineMode = query.startsWith(':')
  const isHelpMode = query.startsWith('?')
  const searchQuery = isCollectorSearch
    ? query.slice('collector:'.length).trim()
    : isCommandMode || isSearchMode || isLineMode || isHelpMode
      ? query.slice(1).trim()
      : query.trim()

  // ── Unified search: content + collector (any 2+ char query, no prefix needed) ──
  const [collectorResults, setCollectorResults] = useState<PaletteItem[]>([])
  const collectorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const COLLECTOR_TYPE_ICONS: Record<string, React.FC<{ size?: number; className?: string }>> = {
    link: Link, image: Image, video: Video, tweet: Twitter, screenshot: Monitor, text: Type,
  }

  const shouldSearch = !isCommandMode && !isLineMode && !isHelpMode && searchQuery.length >= 2

  // Content search (notes + code files)
  useEffect(() => {
    if (!shouldSearch) { setSearchResults([]); setSearching(false); return }
    setSearching(true)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(async () => {
      const dirs: string[] = []
      if (liteHome) dirs.push(`${liteHome}/notes`)
      if (codeProjectPath) dirs.push(codeProjectPath)
      if (dirs.length === 0) { setSearchResults([]); setSearching(false); return }

      const res = await window.api.search.content(searchQuery, dirs, 15)
      if (!res.ok) { setSearchResults([]); setSearching(false); return }

      const store = useUIStore.getState()
      const items: PaletteItem[] = res.data.map((match, i) => {
        const isNote = liteHome && match.filePath.startsWith(`${liteHome}/notes`)
        return {
          id: `search:${match.filePath}:${match.line}:${i}`,
          label: match.fileName,
          hint: `L${match.line}`,
          detail: match.content,
          icon: isNote ? FileText : FileCode,
          category: 'Content Matches',
          action: () => {
            const app: AppType = isNote ? 'notes.app' : 'code.app'
            store.setCurrentApp(app)
            useUIStore.setState({
              appStates: {
                ...store.appStates,
                [app]: { ...store.appStates[app], activeFilePath: match.filePath },
              },
            })
          },
        }
      })
      setSearchResults(items)
      setSearching(false)
    }, 300)
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
  }, [shouldSearch, searchQuery, liteHome, codeProjectPath])

  // Collector search
  useEffect(() => {
    if (!shouldSearch) { setCollectorResults([]); return }
    if (collectorTimerRef.current) clearTimeout(collectorTimerRef.current)
    collectorTimerRef.current = setTimeout(async () => {
      const res = await window.api.collector.search(searchQuery)
      if (!res.ok) { setCollectorResults([]); return }

      const items: PaletteItem[] = res.data.slice(0, 10).map((r: { item: Record<string, unknown>; score: number; source: string }, i: number) => {
        const item = r.item as { id: string; type: string; title: string; url?: string; meta?: Record<string, unknown> }
        const domain = item.url ? (() => { try { return new URL(item.url).hostname.replace('www.', '') } catch { return '' } })() : ''
        return {
          id: `collector:${item.id}:${i}`,
          label: item.title,
          hint: domain || item.type.toUpperCase(),
          detail: (item.meta?.ocrText as string)?.slice(0, 60) || (item.meta?.description as string)?.slice(0, 60) || undefined,
          icon: COLLECTOR_TYPE_ICONS[item.type] || Archive,
          category: 'Collector',
          action: () => {
            const store = useUIStore.getState()
            store.setCurrentApp('collector.app')
            useUIStore.setState({
              appStates: {
                ...store.appStates,
                'collector.app': { ...store.appStates['collector.app'], activeFilePath: 'all' },
              },
            })
          },
        }
      })
      setCollectorResults(items)
    }, 300)
    return () => { if (collectorTimerRef.current) clearTimeout(collectorTimerRef.current) }
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
    if (isSearchMode) return searchResults
    if (isCollectorSearch) return collectorResults
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

    // Collector items (in global search)
    if (collectorItems.length > 0) {
      const CTYPE_ICONS: Record<string, typeof Link> = { link: Link, image: Image, video: Video, tweet: Twitter, screenshot: Monitor, text: Type }
      for (const ci of collectorItems) {
        all.push({
          id: `collector:${ci.id}`,
          label: ci.title,
          hint: 'collector',
          icon: CTYPE_ICONS[ci.type] || Archive,
          category: 'Collector',
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

    return all
  }, [isCommandMode, isSearchMode, isCollectorSearch, isLineMode, isHelpMode, searchResults, collectorResults, noteFiles, codeFiles, collectorItems, terminalSessions, currentApp, codeProjectPath, theme, recentFiles, recentPathSet, searchQuery])

  // ── Filter + sort ──
  const filtered = useMemo(() => {
    if (isSearchMode || isCollectorSearch || isLineMode || isHelpMode) return items
    if (!searchQuery) return items
    return items
      .filter((item) => fuzzyMatch(searchQuery, item.label))
      .sort((a, b) => {
        const scoreA = fuzzyScore(searchQuery, a.label) + (a.boost || 0) * 2
        const scoreB = fuzzyScore(searchQuery, b.label) + (b.boost || 0) * 2
        return scoreB - scoreA
      })
  }, [items, searchQuery, isSearchMode, isCollectorSearch, isLineMode, isHelpMode])

  // ── Group by category ──
  const grouped = useMemo(() => {
    const groups: { category: string; items: PaletteItem[] }[] = []
    const categoryOrder = isHelpMode
      ? ['Help']
      : isLineMode
        ? ['Navigation']
        : ['Recent', 'Actions', 'Apps', 'Notes', 'Code', 'Collector', 'Content Matches', 'Terminals', 'Navigation']
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
  }, [filtered, isSearchMode, isCollectorSearch, isHelpMode, isLineMode, searchQuery])

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
    : isSearchMode ? 'Search file contents...'
    : isCollectorSearch ? 'Search collected items...'
    : isLineMode ? 'Type a line number...'
    : isHelpMode ? ''
    : 'Search files, apps, actions...'

  const modeIcon = isSearchMode ? Hash
    : isCollectorSearch ? Archive
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
          <ModeIcon size={15} className={isCommandMode || isSearchMode || isCollectorSearch || isLineMode ? 'text-accent-main shrink-0' : 'text-tx-faint shrink-0'} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0) }}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-tx-main text-[13px] outline-none placeholder:text-tx-faint"
            spellCheck={false}
          />
          {!isCommandMode && !isSearchMode && !isCollectorSearch && !isLineMode && !isHelpMode && (
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
              {isSearchMode && searchQuery.length < 2 ? 'Type at least 2 characters...' : 'No results found'}
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
                            <HighlightMatch text={item.label} query={isSearchMode || isCollectorSearch || isLineMode || isHelpMode ? '' : searchQuery} />
                          </span>
                          {item.hint && (
                            <span className="text-[11px] text-tx-faint truncate max-w-[140px] shrink-0">{item.hint}</span>
                          )}
                        </div>
                        {item.detail && (
                          <div className="text-[11px] text-tx-faint truncate mt-0.5">{item.detail}</div>
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
