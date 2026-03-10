import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  Search, FileText, FileCode, Terminal, Settings, Globe, Archive,
  Plus, PanelLeft, Moon, Sun, ArrowRight,
} from 'lucide-react'
import { useUIStore } from '../store/useUIStore'
import type { AppType } from '../../../shared/types'

// ── Types ──

interface PaletteItem {
  id: string
  label: string
  hint?: string
  icon: React.FC<{ size?: number; className?: string }>
  category: string
  action: () => void
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
  let score = 0
  let qi = 0
  let lastMatch = -1
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += 10
      // Consecutive match bonus
      if (lastMatch === ti - 1) score += 5
      // Start-of-word bonus
      if (ti === 0 || t[ti - 1] === '/' || t[ti - 1] === '.' || t[ti - 1] === ' ') score += 8
      lastMatch = ti
      qi++
    }
  }
  return qi === q.length ? score : 0
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

// ── Component ──

export const CommandPalette: React.FC = () => {
  const show = useUIStore((s) => s.showCommandPalette)
  const setShow = useUIStore((s) => s.setShowCommandPalette)

  if (!show) return null

  return <CommandPaletteInner onClose={() => setShow(false)} />
}

function CommandPaletteInner({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Store data
  const liteHome = useUIStore((s) => s.liteHome)
  const codeProjectPath = useUIStore((s) => s.codeProjectPath)
  const terminalSessions = useUIStore((s) => s.terminalSessions)
  const currentApp = useUIStore((s) => s.currentApp)
  const theme = useUIStore((s) => s.theme)

  // Loaded file lists
  const [noteFiles, setNoteFiles] = useState<{ name: string; path: string }[]>([])
  const [codeFiles, setCodeFiles] = useState<{ name: string; path: string }[]>([])

  // Load files on mount
  useEffect(() => {
    if (liteHome) {
      flattenFileTree(`${liteHome}/notes`).then(setNoteFiles)
    }
  }, [liteHome])

  useEffect(() => {
    if (codeProjectPath) {
      flattenFileTree(codeProjectPath).then((files) => setCodeFiles(files.slice(0, 200)))
    }
  }, [codeProjectPath])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Detect command mode
  const isCommandMode = query.startsWith('>')
  const searchQuery = isCommandMode ? query.slice(1).trim() : query.trim()

  // Build items
  const items = useMemo((): PaletteItem[] => {
    const store = useUIStore.getState()
    const all: PaletteItem[] = []

    if (isCommandMode) {
      // ── Command mode: actions only ──
      const commands: PaletteItem[] = [
        {
          id: 'cmd:new-note',
          label: 'New Note',
          icon: Plus,
          category: 'Actions',
          action: () => {
            store.setCurrentApp('notes.app')
            // Trigger note creation via sidebar
          },
        },
        {
          id: 'cmd:new-terminal',
          label: 'New Terminal',
          icon: Terminal,
          category: 'Actions',
          action: async () => {
            const cwd = store.codeProjectPath ?? undefined
            const res = await window.api.terminal.create(cwd)
            if (res.ok) {
              store.addTerminalSession({
                id: res.data,
                title: `Terminal ${store.terminalSessions.length + 1}`,
                cwd,
              })
              store.setCurrentApp('terminal.app')
            }
          },
        },
        {
          id: 'cmd:toggle-sidebar',
          label: 'Toggle Sidebar',
          icon: PanelLeft,
          category: 'Actions',
          action: () => store.toggleSidebar(),
        },
        {
          id: 'cmd:toggle-theme',
          label: theme.includes('dark') ? 'Switch to Light Theme' : 'Switch to Dark Theme',
          icon: theme.includes('dark') ? Sun : Moon,
          category: 'Actions',
          action: () => {
            const isDark = theme.includes('dark')
            const next = isDark ? theme.replace('dark', 'light') : theme.replace('light', 'dark')
            store.setTheme(next)
          },
        },
        {
          id: 'cmd:open-project',
          label: 'Open Project Folder',
          icon: FileCode,
          category: 'Actions',
          action: async () => {
            const res = await window.api.project.open()
            if (res.ok) {
              store.setCodeProjectPath(res.data)
              store.addRecentProject(res.data)
              store.setCurrentApp('code.app')
            }
          },
        },
        {
          id: 'cmd:settings',
          label: 'Open Settings',
          icon: Settings,
          category: 'Actions',
          action: () => store.setCurrentApp('settings.app'),
        },
      ]

      // Add app switch commands
      for (const [appId, meta] of Object.entries(APP_META)) {
        if (appId === currentApp) continue
        commands.push({
          id: `cmd:switch-${appId}`,
          label: `Switch to ${meta.label}`,
          icon: meta.icon,
          category: 'Apps',
          action: () => store.setCurrentApp(appId as AppType),
        })
      }

      return commands
    }

    // ── Search mode: resources + apps + actions ──

    // App switching
    for (const [appId, meta] of Object.entries(APP_META)) {
      if (appId === currentApp) continue
      all.push({
        id: `app:${appId}`,
        label: meta.label,
        icon: meta.icon,
        category: 'Apps',
        action: () => store.setCurrentApp(appId as AppType),
      })
    }

    // Note files
    for (const file of noteFiles) {
      all.push({
        id: `note:${file.path}`,
        label: file.name,
        icon: FileText,
        category: 'Notes',
        action: () => {
          store.setCurrentApp('notes.app')
          const appStates = store.appStates
          useUIStore.setState({
            appStates: {
              ...appStates,
              'notes.app': { ...appStates['notes.app'], activeFilePath: file.path },
            },
          })
        },
      })
    }

    // Code files
    for (const file of codeFiles) {
      all.push({
        id: `code:${file.path}`,
        label: file.name,
        hint: codeProjectPath ? file.name.split('/').slice(0, -1).join('/') : undefined,
        icon: FileCode,
        category: 'Code',
        action: () => {
          store.setCurrentApp('code.app')
          const appStates = store.appStates
          useUIStore.setState({
            appStates: {
              ...appStates,
              'code.app': { ...appStates['code.app'], activeFilePath: file.path },
            },
          })
        },
      })
    }

    // Terminal sessions
    for (const session of terminalSessions) {
      all.push({
        id: `term:${session.id}`,
        label: session.title,
        hint: session.cwd?.split('/').pop(),
        icon: Terminal,
        category: 'Terminals',
        action: () => {
          store.setCurrentApp('terminal.app')
          store.setActiveTerminalId(session.id)
        },
      })
    }

    // Quick actions (always shown when no query)
    all.push(
      {
        id: 'action:new-note',
        label: 'New Note',
        icon: Plus,
        category: 'Actions',
        action: () => store.setCurrentApp('notes.app'),
      },
      {
        id: 'action:new-terminal',
        label: 'New Terminal',
        icon: Plus,
        category: 'Actions',
        action: async () => {
          const cwd = store.codeProjectPath ?? undefined
          const res = await window.api.terminal.create(cwd)
          if (res.ok) {
            store.addTerminalSession({
              id: res.data,
              title: `Terminal ${store.terminalSessions.length + 1}`,
              cwd,
            })
            store.setCurrentApp('terminal.app')
          }
        },
      },
    )

    return all
  }, [isCommandMode, noteFiles, codeFiles, terminalSessions, currentApp, codeProjectPath, theme])

  // Filter + sort
  const filtered = useMemo(() => {
    if (!searchQuery) return items
    return items
      .filter((item) => fuzzyMatch(searchQuery, item.label))
      .sort((a, b) => fuzzyScore(searchQuery, b.label) - fuzzyScore(searchQuery, a.label))
  }, [items, searchQuery])

  // Group by category
  const grouped = useMemo(() => {
    const groups: { category: string; items: PaletteItem[] }[] = []
    const categoryOrder = ['Actions', 'Apps', 'Notes', 'Code', 'Terminals']
    const map = new Map<string, PaletteItem[]>()

    for (const item of filtered) {
      const arr = map.get(item.category) || []
      arr.push(item)
      map.set(item.category, arr)
    }

    for (const cat of categoryOrder) {
      const items = map.get(cat)
      if (items?.length) groups.push({ category: cat, items: items.slice(0, 10) })
    }

    return groups
  }, [filtered])

  // Flat list for keyboard navigation
  const flatItems = useMemo(() => grouped.flatMap((g) => g.items), [grouped])

  // Clamp selection
  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(flatItems.length - 1, 0)))
  }, [flatItems.length])

  // Execute selected
  const executeSelected = useCallback(() => {
    const item = flatItems[selectedIndex]
    if (item) {
      onClose()
      item.action()
    }
  }, [flatItems, selectedIndex, onClose])

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
        executeSelected()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [flatItems.length, executeSelected, onClose])

  // Scroll selected into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[100] bg-black/20" onClick={onClose} />

      {/* Panel */}
      <div className="fixed top-[12%] left-1/2 -translate-x-1/2 w-[90%] max-w-[520px] bg-bg-popover rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.5)] border border-border-strong overflow-hidden z-[101] flex flex-col">
        {/* Search input */}
        <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border-subtle">
          <Search size={15} className="text-tx-faint shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
            placeholder={isCommandMode ? 'Type a command...' : 'Search files, apps, actions...'}
            className="flex-1 bg-transparent text-tx-main text-[13px] outline-none placeholder:text-tx-faint"
            spellCheck={false}
          />
          {!isCommandMode && (
            <kbd className="text-[10px] text-tx-faint bg-bg-hover px-1.5 py-0.5 rounded border border-border-subtle">
              {'>'} cmds
            </kbd>
          )}
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[340px] overflow-y-auto py-1">
          {grouped.length === 0 ? (
            <div className="px-4 py-6 text-center text-tx-faint text-[13px]">
              No results found
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
                      onClick={() => {
                        onClose()
                        item.action()
                      }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`flex items-center gap-2.5 px-3.5 py-2 mx-1 rounded-lg cursor-pointer transition-colors ${
                        isSelected ? 'bg-accent-bg text-accent-main' : 'text-tx-main hover:bg-bg-hover'
                      }`}
                    >
                      <item.icon size={15} className={isSelected ? 'text-accent-main' : 'text-tx-faint'} />
                      <span className="flex-1 text-[13px] truncate">
                        <HighlightMatch text={item.label} query={searchQuery} />
                      </span>
                      {item.hint && (
                        <span className="text-[11px] text-tx-faint truncate max-w-[140px]">
                          {item.hint}
                        </span>
                      )}
                      {isSelected && (
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
            <kbd className="bg-bg-hover px-1 py-0.5 rounded border border-border-subtle">↑↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="bg-bg-hover px-1 py-0.5 rounded border border-border-subtle">↵</kbd>
            open
          </span>
          <span className="flex items-center gap-1">
            <kbd className="bg-bg-hover px-1 py-0.5 rounded border border-border-subtle">esc</kbd>
            close
          </span>
        </div>
      </div>
    </>
  )
}
