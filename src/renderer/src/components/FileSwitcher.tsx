import { useState, useEffect, useRef, useCallback } from 'react'
import { FileText, FileCode, Terminal, Settings, Globe, Archive } from 'lucide-react'
import { useUIStore } from '../store/useUIStore'
import type { AppType } from '../../../shared/types'

const APP_ICONS: Record<AppType, React.FC<{ size?: number; className?: string }>> = {
  'notes.app': FileText,
  'code.app': FileCode,
  'terminal.app': Terminal,
  'browser.app': Globe,
  'collector.app': Archive,
  'settings.app': Settings,
}

interface SwitcherItem {
  label: string
  hint?: string
  app: AppType
  filePath?: string
  terminalId?: string
  icon: React.FC<{ size?: number; className?: string }>
}

function buildItems(): SwitcherItem[] {
  const store = useUIStore.getState()
  const items: SwitcherItem[] = []
  const seenTerminals = new Set<string>()
  const seenFiles = new Set<string>()

  // Determine the "current item" — the file/terminal the user is actively
  // working on right now. This MUST be at position 0 regardless of MRU
  // staleness (e.g. if the file was opened via back-navigation or was
  // restored from saved state without a tracking call).
  let currentItem: SwitcherItem | null = null
  if (store.currentApp === 'terminal.app' && store.activeTerminalId) {
    const session = store.terminalSessions.find((s) => s.id === store.activeTerminalId)
    if (session) {
      currentItem = {
        label: session.title || 'Terminal',
        hint: session.cwd?.split('/').pop(),
        app: 'terminal.app',
        terminalId: session.id,
        icon: Terminal,
      }
      seenTerminals.add(session.id)
    }
  } else {
    const activePath = store.appStates[store.currentApp]?.activeFilePath
    if (activePath) {
      const fileName = activePath.split('/').pop() || activePath
      const dirHint = activePath.split('/').slice(-2, -1)[0]
      currentItem = {
        label: fileName,
        hint: dirHint,
        app: store.currentApp,
        filePath: activePath,
        icon: APP_ICONS[store.currentApp] || FileText,
      }
      seenFiles.add(activePath)
    }
  }
  if (currentItem) items.push(currentItem)

  // Walk the unified MRU list — sorted by openedAt desc. Skip anything
  // already included as the current item.
  for (const rf of store.recentFiles.slice(0, 20)) {
    if (rf.terminalId) {
      if (seenTerminals.has(rf.terminalId)) continue
      const session = store.terminalSessions.find((s) => s.id === rf.terminalId)
      if (!session) continue
      seenTerminals.add(session.id)
      items.push({
        label: session.title || rf.title || 'Terminal',
        hint: session.cwd?.split('/').pop(),
        app: 'terminal.app',
        terminalId: session.id,
        icon: Terminal,
      })
    } else if (rf.path) {
      if (seenFiles.has(rf.path)) continue
      seenFiles.add(rf.path)
      const fileName = rf.path.split('/').pop() || rf.path
      const dirHint = rf.path.split('/').slice(-2, -1)[0]
      items.push({
        label: fileName,
        hint: dirHint,
        app: rf.app,
        filePath: rf.path,
        icon: APP_ICONS[rf.app] || FileText,
      })
    }
  }

  // Append any terminals that have never been used. They go at the end;
  // once activated they'll surface to the top naturally.
  for (const ts of store.terminalSessions) {
    if (seenTerminals.has(ts.id)) continue
    items.push({
      label: ts.title || 'Terminal',
      hint: ts.cwd?.split('/').pop(),
      app: 'terminal.app',
      terminalId: ts.id,
      icon: Terminal,
    })
  }

  return items
}

export const FileSwitcher: React.FC = () => {
  const show = useUIStore((s) => s.showFileSwitcher)
  const recentFiles = useUIStore((s) => s.recentFiles)
  const terminalSessions = useUIStore((s) => s.terminalSessions)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selectedRef = useRef(0)
  const [items, setItems] = useState<SwitcherItem[]>([])
  const itemsRef = useRef<SwitcherItem[]>([])
  const listRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  // Build items + set initial index when switcher opens
  useEffect(() => {
    if (show) {
      const built = buildItems()
      setItems(built)
      itemsRef.current = built
      // Start at index 1 (previous file) — index 0 is the current file
      const startIdx = built.length > 1 ? 1 : 0
      setSelectedIndex(startIdx)
      selectedRef.current = startIdx
    }
  }, [show, recentFiles, terminalSessions])

  // Sync ref + auto-scroll
  useEffect(() => {
    selectedRef.current = selectedIndex
    const el = itemRefs.current.get(selectedIndex)
    if (el) {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  const commitAndClose = useCallback((index?: number) => {
    const idx = index ?? selectedRef.current
    const currentItems = itemsRef.current
    const item = currentItems[idx]
    if (item) {
      const store = useUIStore.getState()
      if (item.terminalId) {
        store.setCurrentApp('terminal.app')
        useUIStore.setState({ activeTerminalId: item.terminalId })
      } else if (item.filePath) {
        store.setCurrentApp(item.app)
        useUIStore.setState({
          appStates: {
            ...store.appStates,
            [item.app]: { ...store.appStates[item.app], activeFilePath: item.filePath },
          },
        })
      }
    }
    useUIStore.getState().setShowFileSwitcher(false)
  }, [])

  const moveSelection = useCallback((delta: number) => {
    setSelectedIndex((prev) => {
      const len = itemsRef.current.length
      if (len === 0) return 0
      const next = (prev + delta + len) % len
      selectedRef.current = next
      return next
    })
  }, [])

  // Listen for next/prev/commit events from main process IPC
  useEffect(() => {
    if (!show) return

    const handleNext = () => moveSelection(1)
    const handlePrev = () => moveSelection(-1)
    const handleCommit = () => commitAndClose()

    window.addEventListener('lite:file-switcher-next', handleNext)
    window.addEventListener('lite:file-switcher-prev', handlePrev)
    window.addEventListener('lite:file-switcher-commit', handleCommit)
    return () => {
      window.removeEventListener('lite:file-switcher-next', handleNext)
      window.removeEventListener('lite:file-switcher-prev', handlePrev)
      window.removeEventListener('lite:file-switcher-commit', handleCommit)
    }
  }, [show, commitAndClose, moveSelection])

  // Keyboard: Enter to confirm, Escape to close, Ctrl release to commit
  useEffect(() => {
    if (!show) return

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') {
        commitAndClose()
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        commitAndClose()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        useUIStore.getState().setShowFileSwitcher(false)
      }
    }

    window.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [show, commitAndClose])

  if (!show) return null

  return (
    <>
      <div className="fixed inset-0 z-[100]" onClick={() => useUIStore.getState().setShowFileSwitcher(false)} />
      <div className="fixed top-[15%] left-1/2 -translate-x-1/2 w-[90%] max-w-[400px] bg-bg-popover rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.5)] border border-border-strong overflow-hidden z-[101] flex flex-col">
        <div className="px-3.5 py-2 border-b border-border-subtle text-[11px] text-tx-faint uppercase tracking-wider">
          Switch To
        </div>
        <div ref={listRef} className="max-h-[320px] overflow-y-auto py-1">
          {items.length === 0 ? (
            <div className="px-4 py-6 text-center text-tx-faint text-[13px]">
              No recent items. Open some files first.
            </div>
          ) : items.map((item, idx) => {
            const isSelected = idx === selectedIndex
            const Icon = item.icon
            return (
              <div
                key={`${item.label}-${item.filePath || item.terminalId}-${idx}`}
                ref={(el) => { if (el) itemRefs.current.set(idx, el); else itemRefs.current.delete(idx) }}
                onMouseEnter={() => {
                  setSelectedIndex(idx)
                  selectedRef.current = idx
                }}
                onMouseDown={(e) => {
                  // Prevent Ctrl+click from selecting text
                  e.preventDefault()
                  commitAndClose(idx)
                }}
                className={`flex items-center gap-2.5 px-3.5 py-2 mx-1 rounded-lg cursor-pointer transition-colors ${
                  isSelected ? 'bg-accent-bg text-accent-main' : 'text-tx-main hover:bg-bg-hover'
                }`}
              >
                <Icon size={14} className={isSelected ? 'text-accent-main' : 'text-tx-faint'} />
                <span className="flex-1 text-[13px] truncate">{item.label}</span>
                {item.hint && (
                  <span className="text-[11px] text-tx-faint truncate max-w-[120px]">{item.hint}</span>
                )}
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-3 px-3.5 py-1.5 border-t border-border-subtle text-[11px] text-tx-faint">
          <span><kbd className="bg-bg-hover px-1 py-0.5 rounded border border-border-subtle">⌃Tab</kbd> navigate</span>
          <span><kbd className="bg-bg-hover px-1 py-0.5 rounded border border-border-subtle">↵</kbd> open</span>
          <span>release ⌃ to open</span>
        </div>
      </div>
    </>
  )
}
