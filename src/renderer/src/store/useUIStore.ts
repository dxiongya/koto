import { create } from 'zustand'
import type { AppType } from '../../../shared/types'

interface UIState {
  // Workspace
  workspacePath: string | null

  // Navigation
  currentApp: AppType
  activeFilePath: string | null
  showCommandPalette: boolean

  // Sidebar
  sidebarExpandedPaths: string[]

  // Actions
  setWorkspacePath: (path: string | null) => void
  setCurrentApp: (app: AppType) => void
  setActiveFilePath: (path: string | null) => void
  setShowCommandPalette: (show: boolean) => void
  toggleCommandPalette: () => void
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
  workspacePath: null,
  currentApp: 'code.app',
  activeFilePath: null,
  showCommandPalette: false,
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
