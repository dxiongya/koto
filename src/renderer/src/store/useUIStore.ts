import { create } from 'zustand'
import type { AppType } from '../../../shared/types'

interface UIState {
  // Theme
  theme: 'light' | 'dark'
  
  // Workspace
  workspacePath: string | null

  // Navigation
  currentApp: AppType
  activeFilePath: string | null
  showCommandPalette: boolean

  // Sidebar
  sidebarOpen: boolean
  sidebarExpandedPaths: string[]

  // Actions
  setWorkspacePath: (path: string | null) => void
  setCurrentApp: (app: AppType) => void
  setActiveFilePath: (path: string | null) => void
  setShowCommandPalette: (show: boolean) => void
  toggleCommandPalette: () => void
  toggleTheme: () => void
  toggleSidebar: () => void
  toggleSidebarPath: (path: string) => void
  setSidebarExpandedPaths: (paths: string[]) => void
}

// Debounced persist to main process
let persistTimer: ReturnType<typeof setTimeout> | null = null
function persistState(patch: Record<string, unknown>): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    window.api.state.update(patch)
  }, 300)
}

export const useUIStore = create<UIState>((set, get) => ({
  theme: 'dark',
  workspacePath: null,
  currentApp: 'code.app',
  activeFilePath: null,
  showCommandPalette: false,
  sidebarOpen: true,
  sidebarExpandedPaths: [],

  setWorkspacePath: (path) => {
    set({ workspacePath: path })
    persistState({ lastWorkspacePath: path })
  },
  setCurrentApp: (app) => {
    set({ currentApp: app })
    persistState({ lastApp: app })
  },
  setActiveFilePath: (path) => {
    set({ activeFilePath: path })
    persistState({ lastActiveFilePath: path })
  },
  setShowCommandPalette: (show) => set({ showCommandPalette: show }),
  toggleCommandPalette: () => set((state) => ({ showCommandPalette: !state.showCommandPalette })),
  toggleSidebar: () => {
    set((state) => {
      const next = !state.sidebarOpen
      persistState({ sidebarOpen: next })
      return { sidebarOpen: next }
    })
  },
  toggleTheme: () => {
    const nextTheme = get().theme === 'dark' ? 'light' : 'dark'
    set({ theme: nextTheme })
    persistState({ lastTheme: nextTheme })
    if (nextTheme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  },
  toggleSidebarPath: (path) => {
    const current = get().sidebarExpandedPaths
    const next = current.includes(path)
      ? current.filter((p) => p !== path)
      : [...current, path]
    set({ sidebarExpandedPaths: next })
    persistState({ sidebarExpandedPaths: next })
  },
  setSidebarExpandedPaths: (paths) => set({ sidebarExpandedPaths: paths }),
}))
