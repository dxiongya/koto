import { create } from 'zustand'
import type { AppType, PerAppState, RecentFileEntry, AISettings, AIProviderConfig, AIFeature } from '../../../shared/types'
import { DEFAULT_PER_APP_STATE, DEFAULT_AI_SETTINGS } from '../../../shared/types'
import type { FontId } from '../themes/types'
import { builtinThemes, applyTheme, applyFont } from '../themes'

export interface NavEntry {
  app: AppType
  filePath: string | null
}

export interface TerminalSession {
  id: string
  title: string
  cwd?: string
  /** Transient: restored buffer content, not persisted */
  _restoredBuffer?: string
}

interface UIState {
  // Theme & Font
  theme: string
  fontFamily: FontId

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

  // recent files
  recentFiles: RecentFileEntry[]

  // navigation history
  navBackStack: NavEntry[]
  navForwardStack: NavEntry[]

  // AI
  ai: AISettings

  // file switcher (Ctrl+Tab)
  showFileSwitcher: boolean

  // transient: initial query for command palette (e.g. '>' from Cmd+Shift+P)
  _commandPaletteInitialQuery: string | null

  // ── Actions ──

  setLiteHome: (path: string) => void
  setCurrentApp: (app: AppType) => void
  setShowCommandPalette: (show: boolean) => void
  toggleCommandPalette: () => void
  setTheme: (themeId: string) => void
  toggleTheme: () => void
  setFontFamily: (fontId: FontId) => void
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

  // recent files
  trackRecentFile: (filePath: string, app: AppType) => void

  // navigation
  navigateBack: () => void
  navigateForward: () => void
  setShowFileSwitcher: (show: boolean) => void

  // AI
  setAIProviders: (providers: AIProviderConfig[]) => void
  addAIProvider: (provider: AIProviderConfig) => void
  updateAIProvider: (id: string, patch: Partial<AIProviderConfig>) => void
  removeAIProvider: (id: string) => void
  setActiveAIProvider: (id: string | null) => void
  setAIFeatureProvider: (feature: AIFeature, providerId: string | null) => void
  getAIProviderForFeature: (feature: AIFeature) => AIProviderConfig | null
}

// Debounced persist to main process — merges patches within the debounce window
let persistTimer: ReturnType<typeof setTimeout> | null = null
let pendingPatch: Record<string, unknown> = {}
function persistState(patch: Record<string, unknown>): void {
  Object.assign(pendingPatch, patch)
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    window.api.state.update(pendingPatch)
    pendingPatch = {}
  }, 300)
}

const ALL_APPS: AppType[] = ['notes.app', 'code.app', 'browser.app', 'terminal.app', 'collector.app', 'settings.app']

function defaultAppStates(): Record<AppType, PerAppState> {
  const states = {} as Record<AppType, PerAppState>
  for (const app of ALL_APPS) {
    states[app] = { ...DEFAULT_PER_APP_STATE }
  }
  return states
}

export const useUIStore = create<UIState>((set, get) => ({
  theme: 'dark',
  fontFamily: 'sf-mono' as FontId,
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
  recentFiles: [],
  ai: { ...DEFAULT_AI_SETTINGS },
  navBackStack: [],
  navForwardStack: [],
  showFileSwitcher: false,
  _commandPaletteInitialQuery: null,

  setLiteHome: (path) => set({ liteHome: path }),

  setCurrentApp: (app) => {
    set({ currentApp: app })
    persistState({ lastApp: app })
  },

  setShowCommandPalette: (show) => set({ showCommandPalette: show }),
  toggleCommandPalette: () => set((s) => ({ showCommandPalette: !s.showCommandPalette })),

  setTheme: (themeId) => {
    const theme = builtinThemes[themeId]
    if (!theme) return
    set({ theme: themeId })
    persistState({ lastTheme: themeId })
    applyTheme(theme)
  },

  toggleTheme: () => {
    const nextTheme = get().theme === 'dark' ? 'light' : 'dark'
    get().setTheme(nextTheme)
  },

  setFontFamily: (fontId) => {
    set({ fontFamily: fontId })
    persistState({ fontFamily: fontId })
    applyFont(fontId)
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
    const { currentApp, appStates, navBackStack } = get()
    // Push current location to back stack before navigating
    const prevFile = appStates[currentApp]?.activeFilePath ?? null
    if (path !== prevFile) {
      const entry: NavEntry = { app: currentApp, filePath: prevFile }
      const newBack = [...navBackStack, entry].slice(-50)
      set({ navBackStack: newBack, navForwardStack: [] })
    }
    const updated = {
      ...appStates,
      [currentApp]: { ...appStates[currentApp], activeFilePath: path },
    }
    set({ appStates: updated })
    persistState({ appStates: updated })
    if (path) get().trackRecentFile(path, currentApp)
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
    const { currentApp, appStates, navBackStack } = get()
    // Push current location to back stack
    const prevFile = appStates[currentApp]?.activeFilePath ?? null
    const entry: NavEntry = { app: currentApp, filePath: prevFile }
    const newBack = [...navBackStack, entry].slice(-50)
    set({ navBackStack: newBack, navForwardStack: [] })

    const updated = {
      ...appStates,
      [app]: { ...appStates[app], activeFilePath: filePath },
    }
    set({ currentApp: app, appStates: updated })
    persistState({ lastApp: app, appStates: updated })
    get().trackRecentFile(filePath, app)
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
    persistState({ terminalSessions: next.map((t) => ({ title: t.title, cwd: t.cwd })) })
  },

  removeTerminalSession: (id) => {
    const prev = get()
    const next = prev.terminalSessions.filter((t) => t.id !== id)
    const newActiveId = prev.activeTerminalId === id
      ? (next.length > 0 ? next[next.length - 1].id : null)
      : prev.activeTerminalId
    set({ terminalSessions: next, activeTerminalId: newActiveId })
    persistState({ terminalSessions: next.map((t) => ({ title: t.title, cwd: t.cwd })) })
  },

  setActiveTerminalId: (id) => set({ activeTerminalId: id }),

  // ── navigation ──

  navigateBack: () => {
    const { navBackStack, navForwardStack, currentApp, appStates } = get()
    if (navBackStack.length === 0) return

    const target = navBackStack[navBackStack.length - 1]
    const newBack = navBackStack.slice(0, -1)

    // Push current to forward stack
    const currentFile = appStates[currentApp]?.activeFilePath ?? null
    const newForward = [...navForwardStack, { app: currentApp, filePath: currentFile }]

    // Navigate to target
    const updated = {
      ...appStates,
      [target.app]: { ...appStates[target.app], activeFilePath: target.filePath },
    }
    set({
      navBackStack: newBack,
      navForwardStack: newForward,
      currentApp: target.app,
      appStates: updated,
    })
    persistState({ lastApp: target.app, appStates: updated })
  },

  navigateForward: () => {
    const { navBackStack, navForwardStack, currentApp, appStates } = get()
    if (navForwardStack.length === 0) return

    const target = navForwardStack[navForwardStack.length - 1]
    const newForward = navForwardStack.slice(0, -1)

    // Push current to back stack
    const currentFile = appStates[currentApp]?.activeFilePath ?? null
    const newBack = [...navBackStack, { app: currentApp, filePath: currentFile }]

    const updated = {
      ...appStates,
      [target.app]: { ...appStates[target.app], activeFilePath: target.filePath },
    }
    set({
      navBackStack: newBack,
      navForwardStack: newForward,
      currentApp: target.app,
      appStates: updated,
    })
    persistState({ lastApp: target.app, appStates: updated })
  },

  setShowFileSwitcher: (show) => set({ showFileSwitcher: show }),

  // ── recent files ──

  trackRecentFile: (filePath, app) => {
    const current = get().recentFiles
    const filtered = current.filter((f) => f.path !== filePath)
    filtered.unshift({ path: filePath, app, openedAt: Date.now() })
    const next = filtered.slice(0, 20)
    set({ recentFiles: next })
    persistState({ recentFiles: next })
  },

  // ── AI ──

  setAIProviders: (providers) => {
    const ai = { ...get().ai, providers }
    set({ ai })
    persistState({ ai })
  },

  addAIProvider: (provider) => {
    const ai = { ...get().ai }
    ai.providers = [...ai.providers, provider]
    // Auto-activate if first provider
    if (!ai.activeProviderId) ai.activeProviderId = provider.id
    set({ ai })
    persistState({ ai })
  },

  updateAIProvider: (id, patch) => {
    const ai = { ...get().ai }
    ai.providers = ai.providers.map((p) => (p.id === id ? { ...p, ...patch } : p))
    set({ ai })
    persistState({ ai })
  },

  removeAIProvider: (id) => {
    const ai = { ...get().ai }
    ai.providers = ai.providers.filter((p) => p.id !== id)
    if (ai.activeProviderId === id) {
      ai.activeProviderId = ai.providers[0]?.id ?? null
    }
    set({ ai })
    persistState({ ai })
  },

  setActiveAIProvider: (id) => {
    const ai = { ...get().ai, activeProviderId: id }
    set({ ai })
    persistState({ ai })
  },

  setAIFeatureProvider: (feature, providerId) => {
    const ai = { ...get().ai }
    ai.featureRouting = { ...ai.featureRouting, [feature]: providerId }
    set({ ai })
    persistState({ ai })
  },

  getAIProviderForFeature: (feature) => {
    const { ai } = get()
    const routedId = ai.featureRouting[feature]
    const targetId = routedId ?? ai.activeProviderId
    if (!targetId) return null
    return ai.providers.find((p) => p.id === targetId && p.enabled) ?? null
  },
}))
