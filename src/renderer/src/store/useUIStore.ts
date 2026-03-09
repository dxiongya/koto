import { create } from 'zustand'
import type { AppType, PerAppState } from '../../../shared/types'
import { DEFAULT_PER_APP_STATE } from '../../../shared/types'

export interface TerminalSession {
  id: string
  title: string
}

interface UIState {
  // Theme
  theme: 'light' | 'dark'

  // Lite Home
  liteHome: string | null

  // Navigation
  currentApp: AppType
  showCommandPalette: boolean

  // Sidebar
  sidebarOpen: boolean

  // Per-app state
  appStates: Record<AppType, PerAppState>

  // notes.app specific
  notesExpandedGroups: string[]
  notesSortBy: 'modified' | 'name' | 'created'

  // code.app specific
  codeProjectPath: string | null
  recentProjects: string[]

  // terminal.app specific
  terminalSessions: TerminalSession[]
  activeTerminalId: string | null

  // ── Actions ──

  setLiteHome: (path: string) => void
  setCurrentApp: (app: AppType) => void
  setShowCommandPalette: (show: boolean) => void
  toggleCommandPalette: () => void
  toggleTheme: () => void
  toggleSidebar: () => void

  // Per-app state: operates on currentApp
  getActiveFilePath: () => string | null
  setActiveFilePath: (path: string | null) => void
  getExpandedPaths: () => string[]
  toggleExpandedPath: (path: string) => void
  setExpandedPaths: (paths: string[]) => void

  // Cross-app navigation
  openInApp: (app: AppType, filePath: string) => void

  // notes.app
  toggleNotesGroup: (groupPath: string) => void
  setNotesSortBy: (sort: 'modified' | 'name' | 'created') => void

  // code.app
  setCodeProjectPath: (path: string | null) => void
  addRecentProject: (path: string) => void

  // terminal.app
  addTerminalSession: (session: TerminalSession) => void
  removeTerminalSession: (id: string) => void
  setActiveTerminalId: (id: string | null) => void
}

// Debounced persist to main process
let persistTimer: ReturnType<typeof setTimeout> | null = null
function persistState(patch: Record<string, unknown>): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    window.api.state.update(patch)
  }, 300)
}

const ALL_APPS: AppType[] = ['notes.app', 'code.app', 'browser.app', 'terminal.app', 'collector.app']

function defaultAppStates(): Record<AppType, PerAppState> {
  const states = {} as Record<AppType, PerAppState>
  for (const app of ALL_APPS) {
    states[app] = { ...DEFAULT_PER_APP_STATE }
  }
  return states
}

export const useUIStore = create<UIState>((set, get) => ({
  theme: 'dark',
  liteHome: null,
  currentApp: 'notes.app',
  showCommandPalette: false,
  sidebarOpen: true,
  appStates: defaultAppStates(),
  notesExpandedGroups: [],
  notesSortBy: 'modified',
  codeProjectPath: null,
  recentProjects: [],
  terminalSessions: [],
  activeTerminalId: null,

  setLiteHome: (path) => set({ liteHome: path }),

  setCurrentApp: (app) => {
    set({ currentApp: app })
    persistState({ lastApp: app })
  },

  setShowCommandPalette: (show) => set({ showCommandPalette: show }),
  toggleCommandPalette: () => set((s) => ({ showCommandPalette: !s.showCommandPalette })),

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

  toggleSidebar: () => {
    set((s) => {
      const next = !s.sidebarOpen
      persistState({ sidebarOpen: next })
      return { sidebarOpen: next }
    })
  },

  // ── Per-app state ──

  getActiveFilePath: () => {
    const { currentApp, appStates } = get()
    return appStates[currentApp]?.activeFilePath ?? null
  },

  setActiveFilePath: (path) => {
    const { currentApp, appStates } = get()
    const updated = {
      ...appStates,
      [currentApp]: { ...appStates[currentApp], activeFilePath: path },
    }
    set({ appStates: updated })
    persistState({ appStates: updated })
  },

  getExpandedPaths: () => {
    const { currentApp, appStates } = get()
    return appStates[currentApp]?.expandedPaths ?? []
  },

  toggleExpandedPath: (path) => {
    const { currentApp, appStates } = get()
    const current = appStates[currentApp]?.expandedPaths ?? []
    const next = current.includes(path)
      ? current.filter((p) => p !== path)
      : [...current, path]
    const updated = {
      ...appStates,
      [currentApp]: { ...appStates[currentApp], expandedPaths: next },
    }
    set({ appStates: updated })
    persistState({ appStates: updated })
  },

  setExpandedPaths: (paths) => {
    const { currentApp, appStates } = get()
    const updated = {
      ...appStates,
      [currentApp]: { ...appStates[currentApp], expandedPaths: paths },
    }
    set({ appStates: updated })
  },

  // ── Cross-app navigation ──

  openInApp: (app, filePath) => {
    const { appStates } = get()
    const updated = {
      ...appStates,
      [app]: { ...appStates[app], activeFilePath: filePath },
    }
    set({ currentApp: app, appStates: updated })
    persistState({ lastApp: app, appStates: updated })
  },

  // ── notes.app ──

  toggleNotesGroup: (groupPath) => {
    const current = get().notesExpandedGroups
    const next = current.includes(groupPath)
      ? current.filter((p) => p !== groupPath)
      : [...current, groupPath]
    set({ notesExpandedGroups: next })
    persistState({ notesExpandedGroups: next })
  },

  setNotesSortBy: (sort) => {
    set({ notesSortBy: sort })
    persistState({ notesSortBy: sort })
  },

  // ── code.app ──

  setCodeProjectPath: (path) => {
    set({ codeProjectPath: path })
    persistState({ codeProjectPath: path })
  },

  addRecentProject: (path) => {
    const current = get().recentProjects
    const filtered = current.filter((p) => p !== path)
    filtered.unshift(path)
    const next = filtered.slice(0, 10)
    set({ recentProjects: next, codeProjectPath: path })
    persistState({ recentProjects: next, codeProjectPath: path })
  },

  // ── terminal.app ──

  addTerminalSession: (session) => {
    const next = [...get().terminalSessions, session]
    set({ terminalSessions: next, activeTerminalId: session.id })
    persistState({ terminalSessions: next.map((t) => ({ title: t.title })) })
  },

  removeTerminalSession: (id) => {
    const prev = get()
    const next = prev.terminalSessions.filter((t) => t.id !== id)
    const newActiveId = prev.activeTerminalId === id
      ? (next.length > 0 ? next[next.length - 1].id : null)
      : prev.activeTerminalId
    set({ terminalSessions: next, activeTerminalId: newActiveId })
    persistState({ terminalSessions: next.map((t) => ({ title: t.title })) })
  },

  setActiveTerminalId: (id) => set({ activeTerminalId: id }),
}))
