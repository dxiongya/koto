import { useEffect, useState } from 'react'
import { useUIStore } from './store/useUIStore'
import { MainLayout } from './layouts/MainLayout'
import { CodeApp } from './apps/CodeApp'
import { NotesApp } from './apps/NotesApp'
import { TerminalApp, getTerminalRefs } from './apps/TerminalApp'
import { SettingsApp } from './apps/SettingsApp'
import { ContextMenuProvider } from './components/ContextMenu'
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
  const setShowCommandPalette = useUIStore((s) => s.setShowCommandPalette)
  const [restored, setRestored] = useState(false)

  // Restore full persisted state on launch
  useEffect(() => {
    Promise.all([
      window.api.lite.getHome(),
      window.api.state.get(),
    ]).then(([homeRes, configRes]) => {
      const store = useUIStore.getState()

      // Set Lite Home
      if (homeRes.ok) {
        store.setLiteHome(homeRes.data)
      }

      // Apply default theme immediately (will be overridden if config loads)
      applyTheme(builtinThemes.dark)

      if (configRes.ok) {
        const c = configRes.data
        // Theme
        const themeId = c.lastTheme || 'dark'
        const theme = builtinThemes[themeId]
        if (theme) {
          useUIStore.setState({ theme: themeId })
          applyTheme(theme)
        }
        // Font
        if (c.fontFamily) {
          useUIStore.setState({ fontFamily: c.fontFamily as FontId })
          applyFont(c.fontFamily as FontId)
        }
        // App state — only restore to known app components
        if (c.lastApp && c.lastApp in appComponents) store.setCurrentApp(c.lastApp)
        if (c.appStates) useUIStore.setState({ appStates: { ...store.appStates, ...c.appStates } })
        if (c.sidebarOpen !== undefined) useUIStore.setState({ sidebarOpen: c.sidebarOpen })
        // notes.app
        if (c.notesExpandedGroups) useUIStore.setState({ notesExpandedGroups: c.notesExpandedGroups })
        if (c.notesSortBy) useUIStore.setState({ notesSortBy: c.notesSortBy })
        // code.app
        if (c.codeProjectPath) useUIStore.setState({ codeProjectPath: c.codeProjectPath })
        if (c.recentProjects) useUIStore.setState({ recentProjects: c.recentProjects })
        // recent files
        if (c.recentFiles) useUIStore.setState({ recentFiles: c.recentFiles })

        // terminal.app — recreate PTY sessions with saved cwd + buffer
        if (c.terminalSessions?.length > 0) {
          const defaultCwd = c.codeProjectPath || undefined
          Promise.all(
            c.terminalSessions.map(async (saved: { title: string; cwd?: string }, idx: number) => {
              const cwd = saved.cwd || defaultCwd
              const res = await window.api.terminal.create(cwd)
              if (!res.ok) return null

              // Try to load saved buffer
              let buffer: string | undefined
              const bufferRes = await window.api.terminal.loadBuffer(`session-${idx}`)
              if (bufferRes.ok) {
                buffer = bufferRes.data
              }

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

  // Periodically refresh terminal cwds so we have them ready at quit time
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
        if (buffer) {
          window.api.terminal.saveBuffer(`session-${idx}`, buffer)
        }
      })

      // Persist terminal session metadata (cwd already refreshed by interval)
      window.api.state.update({
        terminalSessions: terminalSessions.map((t) => ({ title: t.title, cwd: t.cwd })),
      })
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  // Cmd+K command palette and Cmd+\ sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'p')) {
        e.preventDefault()
        setShowCommandPalette(true)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault()
        useUIStore.getState().toggleSidebar()
      }
      if (e.key === 'Escape') {
        setShowCommandPalette(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [setShowCommandPalette])

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
