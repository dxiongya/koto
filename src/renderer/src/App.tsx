import { useEffect, useState } from 'react'
import { useUIStore } from './store/useUIStore'
import { MainLayout } from './layouts/MainLayout'
import { CodeApp } from './apps/CodeApp'
import { NotesApp } from './apps/NotesApp'
import { TerminalApp } from './apps/TerminalApp'

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
    window.api.state.get().then((res) => {
      if (!res.ok) {
        setRestored(true)
        return
      }
      const s = res.data
      const store = useUIStore.getState()
      if (s.lastTheme) {
        store.theme = s.lastTheme
        if (s.lastTheme === 'dark') document.documentElement.classList.add('dark')
        else document.documentElement.classList.remove('dark')
      } else {
        // default dark
        document.documentElement.classList.add('dark')
      }
      if (s.lastWorkspacePath) store.setWorkspacePath(s.lastWorkspacePath)
      if (s.lastApp) store.setCurrentApp(s.lastApp)
      if (s.lastActiveFilePath) store.setActiveFilePath(s.lastActiveFilePath)
      if (s.sidebarExpandedPaths) store.setSidebarExpandedPaths(s.sidebarExpandedPaths)
      if (s.sidebarOpen !== undefined) useUIStore.setState({ sidebarOpen: s.sidebarOpen })
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

  // Wait for state restore before rendering to avoid flicker
  if (!restored) {
    return <div className="w-screen h-screen bg-bg-app" />
  }

  const ActiveApp = appComponents[currentApp]

  return (
    <MainLayout>
      {ActiveApp ? <ActiveApp /> : <PlaceholderApp name={currentApp} />}
    </MainLayout>
  )
}

function PlaceholderApp({ name }: { name: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-tx-faint text-sm">
      {name} — coming soon
    </div>
  )
}
