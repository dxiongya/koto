import { useEffect, useState } from 'react'
import { useUIStore } from './store/useUIStore'
import { MainLayout } from './layouts/MainLayout'
import { CodeApp } from './apps/CodeApp'
import { NotesApp } from './apps/NotesApp'
import { TerminalApp, getTerminalRefs } from './apps/TerminalApp'
import { SettingsApp } from './apps/SettingsApp'
import { ContextMenuProvider } from './components/ContextMenu'
import { FileSwitcher } from './components/FileSwitcher'
import { builtinThemes, applyTheme, applyFont } from './themes'
import type { FontId } from './themes'

const appComponents: Record<string, React.FC> = {
  'code.app': CodeApp,
  'notes.app': NotesApp,
  'terminal.app': TerminalApp,
  'settings.app': SettingsApp,
}

export default function App() {
  const currentApp = useUIStore((s) => s.currentApp)
  const [restored, setRestored] = useState(false)

  // Restore full persisted state on launch
  useEffect(() => {
    Promise.all([
      window.api.lite.getHome(),
      window.api.state.get(),
    ]).then(([homeRes, configRes]) => {
      const store = useUIStore.getState()

      if (homeRes.ok) store.setLiteHome(homeRes.data)
      applyTheme(builtinThemes.dark)

      if (configRes.ok) {
        const c = configRes.data
        const themeId = c.lastTheme || 'dark'
        const theme = builtinThemes[themeId]
        if (theme) {
          useUIStore.setState({ theme: themeId })
          applyTheme(theme)
        }
        if (c.fontFamily) {
          useUIStore.setState({ fontFamily: c.fontFamily as FontId })
          applyFont(c.fontFamily as FontId)
        }
        if (c.lastApp && c.lastApp in appComponents) store.setCurrentApp(c.lastApp)
        if (c.appStates) useUIStore.setState({ appStates: { ...store.appStates, ...c.appStates } })
        if (c.sidebarOpen !== undefined) useUIStore.setState({ sidebarOpen: c.sidebarOpen })
        if (c.notesExpandedGroups) useUIStore.setState({ notesExpandedGroups: c.notesExpandedGroups })
        if (c.notesSortBy) useUIStore.setState({ notesSortBy: c.notesSortBy })
        if (c.codeProjectPath) useUIStore.setState({ codeProjectPath: c.codeProjectPath })
        if (c.recentProjects) useUIStore.setState({ recentProjects: c.recentProjects })
        if (c.recentFiles) useUIStore.setState({ recentFiles: c.recentFiles })
        if (c.ai) useUIStore.setState({ ai: { ...useUIStore.getState().ai, ...c.ai } })
        if (c.mcpServers) useUIStore.setState({ mcpServers: c.mcpServers })

        // terminal.app — recreate PTY sessions with saved cwd + buffer
        if (c.terminalSessions?.length > 0) {
          const defaultCwd = c.codeProjectPath || undefined
          Promise.all(
            c.terminalSessions.map(async (saved: { title: string; cwd?: string }, idx: number) => {
              const cwd = saved.cwd || defaultCwd
              const res = await window.api.terminal.create(cwd)
              if (!res.ok) return null
              let buffer: string | undefined
              const bufferRes = await window.api.terminal.loadBuffer(`session-${idx}`)
              if (bufferRes.ok) buffer = bufferRes.data
              return { id: res.data, title: saved.title, cwd, _restoredBuffer: buffer }
            }),
          ).then((results) => {
            const sessions = results.filter(Boolean) as {
              id: string; title: string; cwd?: string; _restoredBuffer?: string
            }[]
            if (sessions.length > 0) {
              useUIStore.setState({
                terminalSessions: sessions,
                activeTerminalId: sessions[sessions.length - 1].id,
              })
            }
          })
        }
      }

      setRestored(true)
    }).catch((err) => {
      console.error('Failed to restore state:', err)
      applyTheme(builtinThemes.dark)
      setRestored(true)
    })
  }, [])

  // Periodically refresh terminal cwds
  useEffect(() => {
    const interval = setInterval(async () => {
      const { terminalSessions } = useUIStore.getState()
      if (terminalSessions.length === 0) return
      const updated = await Promise.all(
        terminalSessions.map(async (s) => {
          try {
            const res = await window.api.terminal.getCwd(s.id)
            if (res.ok && res.data) return { ...s, cwd: res.data }
          } catch {}
          return s
        }),
      )
      useUIStore.setState({ terminalSessions: updated })
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  // Save terminal buffers + cwd before window unloads
  useEffect(() => {
    const handleBeforeUnload = (): void => {
      const { terminalSessions } = useUIStore.getState()
      const refs = getTerminalRefs()
      terminalSessions.forEach((session, idx) => {
        const ref = refs.get(session.id)
        const buffer = ref?.current?.serialize() || ''
        if (buffer) window.api.terminal.saveBuffer(`session-${idx}`, buffer)
      })
      window.api.state.update({
        terminalSessions: terminalSessions.map((t) => ({ title: t.title, cwd: t.cwd })),
      })
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  // ── Global keyboard shortcuts (renderer-side) ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const store = useUIStore.getState()

      // Cmd+K / Cmd+P — Command Palette (file search)
      if (e.metaKey && (e.key === 'k' || e.key === 'p') && !e.shiftKey) {
        e.preventDefault()
        store.setShowCommandPalette(true)
        return
      }

      // Cmd+Shift+P — Command Palette (command mode)
      if (e.metaKey && e.key === 'p' && e.shiftKey) {
        e.preventDefault()
        store.setShowCommandPalette(true)
        useUIStore.setState({ _commandPaletteInitialQuery: '>' })
        return
      }

      // Cmd+\ — Toggle sidebar
      if (e.metaKey && e.key === '\\') {
        e.preventDefault()
        store.toggleSidebar()
        return
      }

      // Escape — Close overlays
      if (e.key === 'Escape') {
        store.setShowCommandPalette(false)
        store.setShowFileSwitcher(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // ── Shortcuts forwarded from main process (Ctrl+Tab, Ctrl+-, etc.) ──
  useEffect(() => {
    // Debounce Ctrl+Tab to prevent double-fire (no preventDefault in main process)
    let lastTabTime = 0
    const TAB_DEBOUNCE = 80 // ms

    const unsub = window.api.shortcut.onShortcut((shortcut) => {
      const store = useUIStore.getState()
      switch (shortcut) {
        case 'ctrl+tab': {
          const now = Date.now()
          if (now - lastTabTime < TAB_DEBOUNCE) break
          lastTabTime = now
          if (!store.showFileSwitcher) {
            store.setShowFileSwitcher(true)
          } else {
            window.dispatchEvent(new CustomEvent('lite:file-switcher-next'))
          }
          break
        }
        case 'ctrl+shift+tab': {
          const now = Date.now()
          if (now - lastTabTime < TAB_DEBOUNCE) break
          lastTabTime = now
          if (!store.showFileSwitcher) {
            store.setShowFileSwitcher(true)
          }
          window.dispatchEvent(new CustomEvent('lite:file-switcher-prev'))
          break
        }
        case 'ctrl-release':
          window.dispatchEvent(new CustomEvent('lite:file-switcher-commit'))
          break
        case 'ctrl+-':
          store.navigateBack()
          break
        case 'ctrl+shift+-':
          store.navigateForward()
          break
      }
    })
    return unsub
  }, [])

  if (!restored) {
    return <div className="w-screen h-screen bg-bg-app" />
  }

  const ActiveApp = appComponents[currentApp]

  return (
    <>
      <MainLayout>
        {ActiveApp ? <ActiveApp /> : <PlaceholderApp name={currentApp} />}
      </MainLayout>
      <ContextMenuProvider />
      <FileSwitcher />
    </>
  )
}

function PlaceholderApp({ name }: { name: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-tx-faint text-sm">
      {name} — coming soon
    </div>
  )
}
