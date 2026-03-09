import { useEffect, useState } from 'react'
import { useUIStore } from './store/useUIStore'
import { MainLayout } from './layouts/MainLayout'
import { CodeApp } from './apps/CodeApp'
import { NotesApp } from './apps/NotesApp'
import { TerminalApp } from './apps/TerminalApp'
import { ContextMenuProvider } from './components/ContextMenu'

const appComponents: Record<string, React.FC> = {
  'code.app': CodeApp,
  'notes.app': NotesApp,
  'terminal.app': TerminalApp,
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

      if (configRes.ok) {
        const c = configRes.data
        // Theme
        if (c.lastTheme) {
          useUIStore.setState({ theme: c.lastTheme })
          if (c.lastTheme === 'dark') document.documentElement.classList.add('dark')
          else document.documentElement.classList.remove('dark')
        } else {
          document.documentElement.classList.add('dark')
        }
        // App state
        if (c.lastApp) store.setCurrentApp(c.lastApp)
        if (c.appStates) useUIStore.setState({ appStates: { ...store.appStates, ...c.appStates } })
        if (c.sidebarOpen !== undefined) useUIStore.setState({ sidebarOpen: c.sidebarOpen })
        // notes.app
        if (c.notesExpandedGroups) useUIStore.setState({ notesExpandedGroups: c.notesExpandedGroups })
        if (c.notesSortBy) useUIStore.setState({ notesSortBy: c.notesSortBy })
        // code.app
        if (c.codeProjectPath) useUIStore.setState({ codeProjectPath: c.codeProjectPath })
        if (c.recentProjects) useUIStore.setState({ recentProjects: c.recentProjects })

        // terminal.app — recreate PTY sessions from saved titles
        if (c.terminalSessions?.length > 0) {
          const cwd = c.codeProjectPath || undefined
          Promise.all(
            c.terminalSessions.map(async (saved: { title: string }) => {
              const res = await window.api.terminal.create(cwd)
              if (res.ok) return { id: res.data, title: saved.title }
              return null
            }),
          ).then((results) => {
            const sessions = results.filter(Boolean) as { id: string; title: string }[]
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
    })
  }, [])

  // Cmd+K command palette and Cmd+\ sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
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
