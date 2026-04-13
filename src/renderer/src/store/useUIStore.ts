import { create } from 'zustand'
import type { AppType, PerAppState, RecentFileEntry, AISettings, AIProviderConfig, AIFeature, AIUsageRecord, MCPServerConfig } from '../../../shared/types'
import { DEFAULT_PER_APP_STATE, DEFAULT_AI_SETTINGS, DEFAULT_AI_USAGE_STATS } from '../../../shared/types'
import type { FontId } from '../themes/types'
import { builtinThemes, applyTheme, applyFont } from '../themes'

export interface NavEntry {
  app: AppType
  filePath: string | null
}

export interface TerminalSession {
  id: string
  /** Stable key for persistence — survives PTY recreation across restarts */
  persistKey: string
  title: string
  cwd?: string
  /** Transient: raw PTY output to replay on restore (adapts to current column width) */
  _replayBuffer?: string
}

/** Generate a stable persist key for terminal buffer storage */
export function genTerminalPersistKey(): string {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

/** A split tree node — either a single terminal or a directional split of children */
export type SplitNode =
  | { type: 'terminal'; terminalId: string }
  | { type: 'split'; direction: 'horizontal' | 'vertical'; children: SplitNode[]; sizes?: number[] }

/** Helpers for working with SplitNode trees */
export function collectTerminalIds(node: SplitNode): string[] {
  if (node.type === 'terminal') return [node.terminalId]
  return node.children.flatMap(collectTerminalIds)
}

export function removeFromTree(node: SplitNode, termId: string): SplitNode | null {
  if (node.type === 'terminal') return node.terminalId === termId ? null : node
  const children = node.children.map((c) => removeFromTree(c, termId)).filter(Boolean) as SplitNode[]
  if (children.length === 0) return null
  if (children.length === 1) return children[0]
  // Preserve reference if nothing changed
  if (children.length === node.children.length && children.every((c, i) => c === node.children[i])) return node
  return { ...node, children }
}

export function insertIntoTree(
  node: SplitNode,
  targetTermId: string,
  newTermId: string,
  direction: 'horizontal' | 'vertical',
  position: 'before' | 'after',
): SplitNode {
  if (node.type === 'terminal') {
    if (node.terminalId !== targetTermId) return node
    const newNode: SplitNode = { type: 'terminal', terminalId: newTermId }
    const children = position === 'before' ? [newNode, node] : [node, newNode]
    return { type: 'split', direction, children }
  }
  // If this split has the target as a direct child and same direction, insert inline
  if (node.direction === direction) {
    const idx = node.children.findIndex(
      (c) => c.type === 'terminal' && c.terminalId === targetTermId,
    )
    if (idx !== -1) {
      const newChildren = [...node.children]
      const insertIdx = position === 'before' ? idx : idx + 1
      newChildren.splice(insertIdx, 0, { type: 'terminal', terminalId: newTermId })
      return { ...node, children: newChildren }
    }
  }
  // Recurse
  return { ...node, children: node.children.map((c) => insertIntoTree(c, targetTermId, newTermId, direction, position)) }
}

export interface TerminalWorkspace {
  id: string
  path: string        // absolute folder path
  name: string        // display name (folder basename)
  groups: { id: string; layout: SplitNode }[]
  activeGroupId: string | null
}

/** Compat helper: extract flat terminalIds from a group's layout tree */
function groupTerminalIds(group: { layout: SplitNode }): string[] {
  return collectTerminalIds(group.layout)
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
  showContextPanel: boolean

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
  terminalWorkspaces: TerminalWorkspace[]
  activeWorkspaceId: string | null

  // recent files
  recentFiles: RecentFileEntry[]

  // navigation history
  navBackStack: NavEntry[]
  navForwardStack: NavEntry[]

  // AI
  ai: AISettings

  // MCP Servers
  mcpServers: MCPServerConfig[]

  // Markdown theme
  markdownTheme: string
  setMarkdownTheme: (themeId: string) => void

  // First-run welcome dialog
  hasSeenWelcome: boolean
  setHasSeenWelcome: (seen: boolean) => void

  // App registry change counter — bump to force sidebar re-render after
  // enabling/disabling apps (e.g. from Welcome onboarding).
  appsVersion: number
  bumpAppsVersion: () => void

  // collector.app data version (bump to trigger sidebar + main refresh)
  collectorVersion: number
  bumpCollectorVersion: () => void

  // file switcher (Ctrl+Tab)
  showFileSwitcher: boolean

  // transient: initial query for command palette (e.g. '>' from Cmd+Shift+P)
  _commandPaletteInitialQuery: string | null

  // ── Actions ──

  setLiteHome: (path: string) => void
  setCurrentApp: (app: AppType) => void
  setShowCommandPalette: (show: boolean) => void
  toggleCommandPalette: () => void
  setShowContextPanel: (show: boolean) => void
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
  addTerminalWorkspace: (path: string) => void
  removeTerminalWorkspace: (id: string) => void
  setActiveWorkspace: (id: string) => void
  createTerminalInWorkspace: (workspaceId: string, sessionId: string) => void
  splitTerminalInWorkspace: (workspaceId: string, existingTermId: string, newTermId: string, direction?: 'horizontal' | 'vertical') => void
  unsplitTerminal: (terminalId: string) => void

  // recent files / terminals (unified MRU)
  trackRecentFile: (filePath: string, app: AppType) => void
  trackRecentTerminal: (terminalId: string, title: string) => void

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
  setAIFeatureProvider: (feature: AIFeature, route: { providerId: string; model?: string } | null) => void
  getAIProviderForFeature: (feature: AIFeature) => { provider: AIProviderConfig; model: string } | null
  trackAIUsage: (providerId: string, feature: AIFeature, usage: { promptTokens: number; completionTokens: number } | undefined, isError?: boolean) => void
  resetAIUsage: () => void

  // MCP
  updateMCPServers: (servers: MCPServerConfig[]) => void
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

const ALL_APPS: AppType[] = ['notes.app', 'code.app', 'browser.app', 'terminal.app', 'collector.app', 'wiki.app', 'settings.app']

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
  showContextPanel: false,
  sidebarOpen: true,
  appStates: defaultAppStates(),
  notesExpandedGroups: [],
  notesSortBy: 'modified',
  codeProjectPath: null,
  recentProjects: [],
  terminalSessions: [],
  activeTerminalId: null,
  terminalWorkspaces: [],
  activeWorkspaceId: null,
  recentFiles: [],
  ai: { ...DEFAULT_AI_SETTINGS },
  mcpServers: [],
  markdownTheme: 'default',
  setMarkdownTheme: (themeId: string) => {
    set({ markdownTheme: themeId })
    persistState({ markdownTheme: themeId })
  },
  hasSeenWelcome: false,
  setHasSeenWelcome: (seen: boolean) => {
    set({ hasSeenWelcome: seen })
    persistState({ hasSeenWelcome: seen })
  },
  appsVersion: 0,
  bumpAppsVersion: () => set((s) => ({ appsVersion: s.appsVersion + 1 })),
  navBackStack: [],
  navForwardStack: [],
  collectorVersion: 0,
  bumpCollectorVersion: () => set((s) => ({ collectorVersion: s.collectorVersion + 1 })),
  showFileSwitcher: false,
  _commandPaletteInitialQuery: null,

  setLiteHome: (path) => set({ liteHome: path }),

  setCurrentApp: (app) => {
    set({ currentApp: app })
    // Write immediately (no debounce) — app can close at any time
    window.api.state.update({ lastApp: app })
    // Refresh MRU for whatever is active in the target app.
    if (app === 'terminal.app') {
      const activeId = get().activeTerminalId
      const session = get().terminalSessions.find((s) => s.id === activeId)
      if (session) get().trackRecentTerminal(session.id, session.title || 'Terminal')
    } else {
      const activePath = get().appStates[app]?.activeFilePath
      if (activePath) get().trackRecentFile(activePath, app)
    }
  },

  setShowCommandPalette: (show) => set({ showCommandPalette: show }),
  toggleCommandPalette: () => set((s) => ({ showCommandPalette: !s.showCommandPalette })),
  setShowContextPanel: (show) => set({ showContextPanel: show }),

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
    const prev = get()
    const nextSessions = [...prev.terminalSessions, session]
    set({
      terminalSessions: nextSessions,
      activeTerminalId: session.id,
    })
    persistState({ terminalSessions: nextSessions.map((t) => ({ persistKey: t.persistKey, title: t.title, cwd: t.cwd })) })
  },

  removeTerminalSession: (id) => {
    const prev = get()
    const nextSessions = prev.terminalSessions.filter((t) => t.id !== id)
    // Clean up from workspace groups
    const nextWorkspaces = prev.terminalWorkspaces.map((ws) => {
      const nextGroups = ws.groups
        .map((g) => {
          const newLayout = removeFromTree(g.layout, id)
          if (!newLayout) return null
          // Preserve reference if layout unchanged
          return newLayout === g.layout ? g : { ...g, layout: newLayout }
        })
        .filter(Boolean) as typeof ws.groups
      // Update activeGroupId if the active group was removed
      const activeGroupStillExists = nextGroups.some((g) => g.id === ws.activeGroupId)
      return {
        ...ws,
        groups: nextGroups,
        activeGroupId: activeGroupStillExists
          ? ws.activeGroupId
          : (nextGroups.length > 0 ? nextGroups[nextGroups.length - 1].id : null),
      }
    })
    // Determine new active terminal
    const newActiveId = prev.activeTerminalId === id
      ? (nextSessions.length > 0 ? nextSessions[nextSessions.length - 1].id : null)
      : prev.activeTerminalId
    set({
      terminalSessions: nextSessions,
      activeTerminalId: newActiveId,
      terminalWorkspaces: nextWorkspaces,
    })
    persistState({ terminalSessions: nextSessions.map((t) => ({ persistKey: t.persistKey, title: t.title, cwd: t.cwd })) })
  },

  setActiveTerminalId: (id) => {
    set({ activeTerminalId: id })
    if (id) {
      const session = get().terminalSessions.find((s) => s.id === id)
      if (session) get().trackRecentTerminal(id, session.title || 'Terminal')
    }
  },

  addTerminalWorkspace: (path) => {
    const prev = get()
    // Don't add duplicate workspace for same path
    if (prev.terminalWorkspaces.some((ws) => ws.path === path)) {
      const existing = prev.terminalWorkspaces.find((ws) => ws.path === path)!
      set({ activeWorkspaceId: existing.id })
      return
    }
    const name = path.split('/').filter(Boolean).pop() || path
    const id = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const newWs: TerminalWorkspace = { id, path, name, groups: [] as TerminalWorkspace['groups'], activeGroupId: null }
    const nextWorkspaces = [...prev.terminalWorkspaces, newWs]
    set({ terminalWorkspaces: nextWorkspaces, activeWorkspaceId: id })
    persistState({ terminalWorkspaces: nextWorkspaces.map((ws) => ({ id: ws.id, path: ws.path, name: ws.name, groups: ws.groups, activeGroupId: ws.activeGroupId })) })
  },

  removeTerminalWorkspace: (id) => {
    const prev = get()
    const ws = prev.terminalWorkspaces.find((w) => w.id === id)
    if (!ws) return
    // Close all terminals in this workspace
    const termIdsToRemove = new Set(ws.groups.flatMap((g) => groupTerminalIds(g)))
    const nextSessions = prev.terminalSessions.filter((t) => !termIdsToRemove.has(t.id))
    const nextWorkspaces = prev.terminalWorkspaces.filter((w) => w.id !== id)
    const newActiveWsId = prev.activeWorkspaceId === id
      ? (nextWorkspaces.length > 0 ? nextWorkspaces[nextWorkspaces.length - 1].id : null)
      : prev.activeWorkspaceId
    const newActiveTermId = termIdsToRemove.has(prev.activeTerminalId ?? '')
      ? (nextSessions.length > 0 ? nextSessions[nextSessions.length - 1].id : null)
      : prev.activeTerminalId
    set({
      terminalWorkspaces: nextWorkspaces,
      activeWorkspaceId: newActiveWsId,
      terminalSessions: nextSessions,
      activeTerminalId: newActiveTermId,
    })
    persistState({
      terminalWorkspaces: nextWorkspaces.map((ws) => ({ id: ws.id, path: ws.path, name: ws.name, groups: ws.groups, activeGroupId: ws.activeGroupId })),
      terminalSessions: nextSessions.map((t) => ({ title: t.title, cwd: t.cwd })),
    })
  },

  setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),

  createTerminalInWorkspace: (workspaceId, sessionId) => {
    const prev = get()
    const newGroupId = `group-${sessionId}-${Date.now()}`
    const nextWorkspaces = prev.terminalWorkspaces.map((ws) => {
      if (ws.id !== workspaceId) return ws
      const newGroup = { id: newGroupId, layout: { type: 'terminal' as const, terminalId: sessionId } }
      return { ...ws, groups: [...ws.groups, newGroup], activeGroupId: newGroupId }
    })
    set({ terminalWorkspaces: nextWorkspaces, activeWorkspaceId: workspaceId })
  },

  splitTerminalInWorkspace: (workspaceId, existingTermId, newTermId, direction) => {
    const prev = get()
    const dir = direction ?? 'horizontal'
    const nextWorkspaces = prev.terminalWorkspaces.map((ws) => {
      if (ws.id !== workspaceId) return ws
      // Remove newTermId from any previous group in this workspace
      let groups = ws.groups.map((g) => {
        const cleaned = removeFromTree(g.layout, newTermId)
        return cleaned ? { ...g, layout: cleaned } : null
      }).filter(Boolean) as typeof ws.groups
      // Find the group containing existingTermId and insert newTermId
      groups = groups.map((g) => {
        if (!collectTerminalIds(g.layout).includes(existingTermId)) return g
        const newLayout = insertIntoTree(g.layout, existingTermId, newTermId, dir, 'after')
        return { ...g, layout: newLayout }
      })
      return { ...ws, groups }
    })
    // Also remove newTermId from groups in other workspaces
    const finalWorkspaces = nextWorkspaces.map((ws) => {
      if (ws.id === workspaceId) return ws
      const groups = ws.groups.map((g) => {
        const cleaned = removeFromTree(g.layout, newTermId)
        return cleaned ? { ...g, layout: cleaned } : null
      }).filter(Boolean) as typeof ws.groups
      const activeGroupStillExists = groups.some((g) => g.id === ws.activeGroupId)
      return {
        ...ws,
        groups,
        activeGroupId: activeGroupStillExists ? ws.activeGroupId : (groups[0]?.id ?? null),
      }
    })
    set({
      terminalWorkspaces: finalWorkspaces,
      activeWorkspaceId: workspaceId,
      activeTerminalId: newTermId,
    })
  },

  unsplitTerminal: (terminalId) => {
    const prev = get()
    const ws = prev.terminalWorkspaces.find((w) => w.id === prev.activeWorkspaceId)
    if (!ws) return
    // Find the group containing this terminal
    const group = ws.groups.find((g) => collectTerminalIds(g.layout).includes(terminalId))
    if (!group) return
    // If terminal is alone in its group, nothing to unsplit
    if (group.layout.type === 'terminal') return
    // Remove terminal from its current group
    const cleaned = removeFromTree(group.layout, terminalId)
    // Create a new standalone group for this terminal
    const newGroupId = `group-${terminalId}-${Date.now()}`
    const newGroup = { id: newGroupId, layout: { type: 'terminal' as const, terminalId } }
    const nextWorkspaces = prev.terminalWorkspaces.map((w) => {
      if (w.id !== ws.id) return w
      const groups = w.groups.map((g) => {
        if (g.id !== group.id) return g
        return cleaned ? { ...g, layout: cleaned } : null
      }).filter(Boolean) as typeof w.groups
      return { ...w, groups: [...groups, newGroup], activeGroupId: newGroupId }
    })
    set({
      terminalWorkspaces: nextWorkspaces,
      activeTerminalId: terminalId,
    })
  },

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
    // Also refresh MRU so the back-navigated file bubbles up in ⌃Tab.
    if (target.filePath) get().trackRecentFile(target.filePath, target.app)
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
    if (target.filePath) get().trackRecentFile(target.filePath, target.app)
  },

  setShowFileSwitcher: (show) => set({ showFileSwitcher: show }),

  // ── recent files ──

  trackRecentFile: (filePath, app) => {
    const current = get().recentFiles
    const filtered = current.filter((f) => f.path !== filePath)
    filtered.unshift({ path: filePath, app, openedAt: Date.now() })
    const next = filtered.slice(0, 30)
    set({ recentFiles: next })
    persistState({ recentFiles: next })
  },

  trackRecentTerminal: (terminalId, title) => {
    const current = get().recentFiles
    const filtered = current.filter((f) => f.terminalId !== terminalId)
    filtered.unshift({ terminalId, title, app: 'terminal.app', openedAt: Date.now() })
    const next = filtered.slice(0, 30)
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

  setAIFeatureProvider: (feature, route) => {
    const ai = { ...get().ai }
    ai.featureRouting = { ...ai.featureRouting, [feature]: route }
    set({ ai })
    persistState({ ai })
  },

  getAIProviderForFeature: (feature) => {
    const { ai } = get()
    const routed = ai.featureRouting[feature]
    // Normalize in case old config has a plain string
    const route = typeof routed === 'string'
      ? { providerId: routed as unknown as string, model: undefined }
      : routed
    const targetId = route?.providerId ?? ai.activeProviderId
    if (!targetId) return null
    const provider = ai.providers.find((p) => p.id === targetId && p.enabled) ?? null
    if (!provider) return null
    // Resolve the active model: route override → provider.models[0] → legacy .model
    const model = route?.model || provider.models?.[0] || provider.model || ''
    return { provider, model }
  },

  trackAIUsage: (providerId, feature, usage, isError = false) => {
    const ai = { ...get().ai }
    const stats = ai.usage ?? { ...DEFAULT_AI_USAGE_STATS }
    const pt = usage?.promptTokens ?? 0
    const ct = usage?.completionTokens ?? 0
    const day = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

    const addTo = (rec: AIUsageRecord): AIUsageRecord => ({
      requests: rec.requests + 1,
      promptTokens: rec.promptTokens + pt,
      completionTokens: rec.completionTokens + ct,
      errors: rec.errors + (isError ? 1 : 0),
    })

    const empty: AIUsageRecord = { requests: 0, promptTokens: 0, completionTokens: 0, errors: 0 }

    stats.total = addTo(stats.total)
    stats.byProvider = { ...stats.byProvider, [providerId]: addTo(stats.byProvider[providerId] ?? empty) }
    stats.byFeature = { ...stats.byFeature, [feature]: addTo(stats.byFeature[feature] ?? empty) }
    stats.daily = { ...stats.daily, [day]: addTo(stats.daily[day] ?? empty) }
    stats.lastRequestAt = Date.now()

    ai.usage = stats
    set({ ai })
    persistState({ ai })
  },

  resetAIUsage: () => {
    const ai = { ...get().ai, usage: { ...DEFAULT_AI_USAGE_STATS } }
    set({ ai })
    persistState({ ai })
  },

  // ── MCP ──

  updateMCPServers: (servers) => {
    set({ mcpServers: servers })
    persistState({ mcpServers: servers })
    // Auto-refresh MCP connections after config is persisted
    if (window.api.mcp) {
      setTimeout(() => window.api.mcp.refresh().catch(() => {}), 500)
    }
  },
}))
