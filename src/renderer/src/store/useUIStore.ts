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

// ── Global pane layout (multi-app split panes) ──
// Parallel to terminal's SplitNode but at the top-level content area.
// Terminal.app's internal SplitNode stays nested inside a single pane.

export type PaneNode =
  | { type: 'pane'; paneId: string }
  | { type: 'split'; direction: 'horizontal' | 'vertical'; children: PaneNode[]; sizes?: number[] }

/** A single tab inside a pane — the VSCode-style "item" unit of display. */
export interface Item {
  id: string              // stable React key across renders
  appId: AppType          // which app renders this tab
  resource: string | null // file path / filter / null (empty)
  label: string           // display text (basename of file, or app name for empty)
}

export interface Pane {
  id: string
  /** Ordered list of tabs in this pane. */
  tabs: Item[]
  /** Currently visible tab. null only during transient empty states. */
  activeTabId: string | null
}

export function genPaneId(): string {
  return `pane-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

export function genItemId(): string {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

/** Derive a human label for a tab from its resource. */
export function itemLabel(appId: AppType, resource: string | null): string {
  if (!resource) return appId.replace('.app', '')
  return resource.split('/').filter(Boolean).pop() ?? resource
}

export function makeItem(appId: AppType, resource: string | null): Item {
  return { id: genItemId(), appId, resource, label: itemLabel(appId, resource) }
}

/** Get the active tab Item of a pane, or undefined when the pane has no tabs. */
export function getActiveItem(pane: Pane): Item | undefined {
  return pane.tabs.find((t) => t.id === pane.activeTabId) ?? pane.tabs[0]
}

/** Derive a pane's effective appId — the active tab's app, or a fallback. */
export function getPaneAppId(pane: Pane, fallback: AppType = 'notes.app'): AppType {
  return getActiveItem(pane)?.appId ?? fallback
}

/** Derive a pane's effective resource (file path / filter id / null). */
export function getPaneResource(pane: Pane): string | null {
  return getActiveItem(pane)?.resource ?? null
}

export function collectPaneIds(node: PaneNode): string[] {
  if (node.type === 'pane') return [node.paneId]
  return node.children.flatMap(collectPaneIds)
}

export function removePaneFromTree(node: PaneNode, paneId: string): PaneNode | null {
  if (node.type === 'pane') return node.paneId === paneId ? null : node
  const children = node.children.map((c) => removePaneFromTree(c, paneId)).filter(Boolean) as PaneNode[]
  if (children.length === 0) return null
  if (children.length === 1) return children[0]
  if (children.length === node.children.length && children.every((c, i) => c === node.children[i])) return node
  return { ...node, children }
}

export function insertPaneIntoTree(
  node: PaneNode,
  targetPaneId: string,
  newPaneId: string,
  direction: 'horizontal' | 'vertical',
  position: 'before' | 'after',
): PaneNode {
  if (node.type === 'pane') {
    if (node.paneId !== targetPaneId) return node
    const newNode: PaneNode = { type: 'pane', paneId: newPaneId }
    const children = position === 'before' ? [newNode, node] : [node, newNode]
    return { type: 'split', direction, children }
  }
  if (node.direction === direction) {
    const idx = node.children.findIndex((c) => c.type === 'pane' && c.paneId === targetPaneId)
    if (idx !== -1) {
      const newChildren = [...node.children]
      const insertIdx = position === 'before' ? idx : idx + 1
      newChildren.splice(insertIdx, 0, { type: 'pane', paneId: newPaneId })
      return { ...node, children: newChildren }
    }
  }
  return { ...node, children: node.children.map((c) => insertPaneIntoTree(c, targetPaneId, newPaneId, direction, position)) }
}

export interface TerminalWorkspace {
  id: string
  path: string            // absolute folder path
  name: string            // display name (folder basename)
  sessionIds: string[]    // flat list; internal splits retired in favor of outer pane splits
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

  // Content area layout mode:
  //   'tabs'   — VSCode-style: recursive split panes + tabs per pane
  //   'single' — classic: currentApp fills the content area, no tabs/splits
  // Pane state (rootLayout, panes) is preserved across toggles so switching
  // back to 'tabs' restores the previous layout.
  contentLayoutMode: 'tabs' | 'single'

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

  // Global multi-app split panes
  panes: Record<string, Pane>
  rootLayout: PaneNode | null
  focusedPaneId: string | null

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
  setContentLayoutMode: (mode: 'tabs' | 'single') => void

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

  // ── Global multi-app split panes ──
  /** Initialize single-pane layout from currentApp if rootLayout is null. Called after restore. */
  initializePanesIfEmpty: () => void
  /** Create a new pane. Returns its paneId. Does NOT insert into tree — use splitPane for that. */
  createPane: (appId: AppType, activeFilePath?: string | null) => string
  /** Split an existing pane by creating a new pane next to it. Returns the new paneId. */
  splitPane: (targetPaneId: string, newAppId: AppType, direction: 'horizontal' | 'vertical', position: 'before' | 'after', initialFilePath?: string | null) => string
  /** Remove a pane from the tree + panes map. If last pane, rootLayout becomes null. */
  removePane: (paneId: string) => void
  /** Move an existing pane to a new position relative to another pane. */
  movePane: (sourcePaneId: string, targetPaneId: string, direction: 'horizontal' | 'vertical', position: 'before' | 'after') => void
  /** Set which pane has keyboard focus (drives sidebar, command palette, etc). */
  setFocusedPane: (paneId: string) => void
  /** Update a specific pane's open file (Phase 2+ will use this when editors open files). */
  setPaneActiveFile: (paneId: string, filePath: string | null) => void
  /** Find a pane already showing a file. Returns its paneId if found. */
  findPaneByFile: (filePath: string) => string | null
  /** Tabs: add/activate an item in a pane; dedupes by appId+resource. */
  openTabInPane: (paneId: string, appId: AppType, resource: string | null) => void
  /** Tabs: activate an existing tab in a pane. */
  setActiveTab: (paneId: string, tabId: string) => void
  /** Tabs: close a tab; if it was the last tab and there are other panes, also remove the pane. */
  closeTab: (paneId: string, tabId: string) => void
  /** Tabs: reorder a tab within its pane. */
  moveTabWithinPane: (paneId: string, tabId: string, targetIndex: number) => void
  /** Tabs: move a tab from one pane to another. insertIndex omitted → append. */
  moveTabToPane: (sourcePaneId: string, tabId: string, targetPaneId: string, insertIndex?: number) => void
  /** Tabs: split target pane, move tab into the newly-created neighbor pane. */
  splitPaneWithTab: (
    sourcePaneId: string,
    tabId: string,
    targetPaneId: string,
    direction: 'horizontal' | 'vertical',
    position: 'before' | 'after',
  ) => void
  /** Open a file in the layout: dedupe existing, else create a new pane split off target. */
  openFileInPane: (args: {
    filePath: string
    appId: AppType
    targetPaneId: string
    direction: 'horizontal' | 'vertical'
    position: 'before' | 'after'
  }) => void

  // terminal.app
  addTerminalSession: (session: TerminalSession) => void
  removeTerminalSession: (id: string) => void
  setActiveTerminalId: (id: string | null) => void
  addTerminalWorkspace: (path: string) => void
  removeTerminalWorkspace: (id: string) => void
  setActiveWorkspace: (id: string) => void
  /** Attach a session id to a workspace. Also opens it as a tab in the focused pane. */
  createTerminalInWorkspace: (workspaceId: string, sessionId: string) => void
  /** Remove a session id from its workspace's sessionIds (cleanup helper). */
  detachTerminalFromWorkspaces: (sessionId: string) => void

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

const ALL_APPS: AppType[] = ['notes.app', 'code.app', 'terminal.app', 'collector.app', 'wiki.app', 'memory.app', 'settings.app']

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
  contentLayoutMode: 'tabs',
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
  panes: {},
  rootLayout: null,
  focusedPaneId: null,
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
    const state = get()
    // Settings is an overlay, never a pane. Switching to settings keeps the
    // pane layout intact; switching away from settings restores it as-is.
    if (app === 'settings.app') {
      set({ currentApp: app })
    } else {
      // Content app: find/create a tab for this app in the focused pane.
      const focusId = state.focusedPaneId
      const focusedPane = focusId ? state.panes[focusId] : null
      if (focusId && focusedPane) {
        if (getPaneAppId(focusedPane, state.currentApp) === app) {
          set({ currentApp: app })
        } else {
          const existingTab = focusedPane.tabs.find((t) => t.appId === app)
          if (existingTab) {
            const nextPane = ({ ...focusedPane, activeTabId: existingTab.id })
            set({ currentApp: app, panes: { ...state.panes, [focusId]: nextPane } })
          } else {
            const newTab = makeItem(app, null)
            const nextPane = ({
              ...focusedPane,
              tabs: [...focusedPane.tabs, newTab],
              activeTabId: newTab.id,
            })
            set({ currentApp: app, panes: { ...state.panes, [focusId]: nextPane } })
          }
        }
      } else {
        set({ currentApp: app })
      }
    }
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

  setContentLayoutMode: (mode) => {
    set({ contentLayoutMode: mode })
    persistState({ contentLayoutMode: mode })
    // When re-entering tabs mode, make sure a pane layout exists so the user
    // doesn't land on a blank PaneTree.
    if (mode === 'tabs') {
      get().initializePanesIfEmpty()
    }
  },

  // ── Per-app state ──

  getActiveFilePath: () => {
    const state = get()
    const focusId = state.focusedPaneId
    if (focusId && state.panes[focusId]) {
      return getPaneResource(state.panes[focusId])
    }
    return state.appStates[state.currentApp]?.activeFilePath ?? null
  },

  setActiveFilePath: (path) => {
    const state = get()
    const focusId = state.focusedPaneId
    if (focusId && state.panes[focusId]) {
      const pane = state.panes[focusId]
      const paneApp = getPaneAppId(pane, state.currentApp)
      const prevFile = getPaneResource(pane)
      if (path !== prevFile) {
        const entry: NavEntry = { app: paneApp, filePath: prevFile }
        const newBack = [...state.navBackStack, entry].slice(-50)
        set({ navBackStack: newBack, navForwardStack: [] })
      }
      // path=null: reset active tab to empty (rare). Else open-or-activate a tab.
      if (path === null) {
        if (pane.activeTabId) {
          const nextTabs = pane.tabs.map((t) =>
            t.id === pane.activeTabId ? { ...t, resource: null, label: itemLabel(t.appId, null) } : t,
          )
          const nextPane: Pane = { ...pane, tabs: nextTabs }
          const nextPanes = { ...state.panes, [focusId]: nextPane }
          const updatedAppStates = {
            ...state.appStates,
            [paneApp]: { ...state.appStates[paneApp], activeFilePath: null },
          }
          set({ panes: nextPanes, appStates: updatedAppStates })
          persistState({ panes: nextPanes, appStates: updatedAppStates })
        }
        return
      }
      const existing = pane.tabs.find((t) => t.appId === paneApp && t.resource === path)
      let nextTabs: Item[]
      let nextActiveTabId: string
      if (existing) {
        nextTabs = pane.tabs
        nextActiveTabId = existing.id
      } else {
        const fresh = makeItem(paneApp, path)
        nextTabs = [...pane.tabs, fresh]
        nextActiveTabId = fresh.id
      }
      const nextPane: Pane = { ...pane, tabs: nextTabs, activeTabId: nextActiveTabId }
      const nextPanes = { ...state.panes, [focusId]: nextPane }
      const updatedAppStates = {
        ...state.appStates,
        [paneApp]: { ...state.appStates[paneApp], activeFilePath: path },
      }
      set({ panes: nextPanes, appStates: updatedAppStates })
      persistState({ panes: nextPanes, appStates: updatedAppStates })
      if (path) get().trackRecentFile(path, paneApp)
      return
    }
    // Fallback (no pane): legacy path.
    const { currentApp, appStates, navBackStack } = state
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
    // Detach from all workspaces' flat sessionId lists.
    const nextWorkspaces = prev.terminalWorkspaces.map((ws) => {
      if (!ws.sessionIds.includes(id)) return ws
      return { ...ws, sessionIds: ws.sessionIds.filter((s) => s !== id) }
    })
    // Also close any panes whose active tab was this session (and its tabs).
    const nextPanes = { ...prev.panes }
    let panesChanged = false
    for (const paneId in nextPanes) {
      const pane = nextPanes[paneId]
      const filtered = pane.tabs.filter((t) => !(t.appId === 'terminal.app' && t.resource === id))
      if (filtered.length !== pane.tabs.length) {
        panesChanged = true
        nextPanes[paneId] = { ...pane, tabs: filtered, activeTabId: filtered[0]?.id ?? null }
      }
    }
    const newActiveId = prev.activeTerminalId === id
      ? (nextSessions.length > 0 ? nextSessions[nextSessions.length - 1].id : null)
      : prev.activeTerminalId
    set({
      terminalSessions: nextSessions,
      activeTerminalId: newActiveId,
      terminalWorkspaces: nextWorkspaces,
      ...(panesChanged ? { panes: nextPanes } : {}),
    })
    persistState({
      terminalSessions: nextSessions.map((t) => ({ persistKey: t.persistKey, title: t.title, cwd: t.cwd })),
      ...(panesChanged ? { panes: nextPanes } : {}),
    })
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
    const newWs: TerminalWorkspace = { id, path, name, sessionIds: [] }
    const nextWorkspaces = [...prev.terminalWorkspaces, newWs]
    set({ terminalWorkspaces: nextWorkspaces, activeWorkspaceId: id })
    persistState({ terminalWorkspaces: nextWorkspaces })
  },

  removeTerminalWorkspace: (id) => {
    const prev = get()
    const ws = prev.terminalWorkspaces.find((w) => w.id === id)
    if (!ws) return
    const termIdsToRemove = new Set(ws.sessionIds)
    const nextSessions = prev.terminalSessions.filter((t) => !termIdsToRemove.has(t.id))
    const nextWorkspaces = prev.terminalWorkspaces.filter((w) => w.id !== id)
    const newActiveWsId = prev.activeWorkspaceId === id
      ? (nextWorkspaces.length > 0 ? nextWorkspaces[nextWorkspaces.length - 1].id : null)
      : prev.activeWorkspaceId
    const newActiveTermId = termIdsToRemove.has(prev.activeTerminalId ?? '')
      ? (nextSessions.length > 0 ? nextSessions[nextSessions.length - 1].id : null)
      : prev.activeTerminalId
    // Drop any pane tabs pointing to removed sessions.
    const nextPanes = { ...prev.panes }
    let panesChanged = false
    for (const paneId in nextPanes) {
      const pane = nextPanes[paneId]
      const filtered = pane.tabs.filter(
        (t) => !(t.appId === 'terminal.app' && t.resource && termIdsToRemove.has(t.resource)),
      )
      if (filtered.length !== pane.tabs.length) {
        panesChanged = true
        nextPanes[paneId] = { ...pane, tabs: filtered, activeTabId: filtered[0]?.id ?? null }
      }
    }
    set({
      terminalWorkspaces: nextWorkspaces,
      activeWorkspaceId: newActiveWsId,
      terminalSessions: nextSessions,
      activeTerminalId: newActiveTermId,
      ...(panesChanged ? { panes: nextPanes } : {}),
    })
    persistState({
      terminalWorkspaces: nextWorkspaces,
      terminalSessions: nextSessions.map((t) => ({ title: t.title, cwd: t.cwd })),
      ...(panesChanged ? { panes: nextPanes } : {}),
    })
  },

  setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),

  createTerminalInWorkspace: (workspaceId, sessionId) => {
    const state = get()
    // Attach session to the workspace (dedupe).
    const nextWorkspaces = state.terminalWorkspaces.map((ws) => {
      if (ws.id !== workspaceId) return ws
      if (ws.sessionIds.includes(sessionId)) return ws
      return { ...ws, sessionIds: [...ws.sessionIds, sessionId] }
    })
    set({ terminalWorkspaces: nextWorkspaces, activeWorkspaceId: workspaceId })
    persistState({ terminalWorkspaces: nextWorkspaces })
    // Open the session as a tab in the focused pane so the user sees it.
    if (state.focusedPaneId) {
      get().openTabInPane(state.focusedPaneId, 'terminal.app', sessionId)
    }
  },

  detachTerminalFromWorkspaces: (sessionId) => {
    const state = get()
    let changed = false
    const nextWorkspaces = state.terminalWorkspaces.map((ws) => {
      if (!ws.sessionIds.includes(sessionId)) return ws
      changed = true
      return { ...ws, sessionIds: ws.sessionIds.filter((s) => s !== sessionId) }
    })
    if (!changed) return
    set({ terminalWorkspaces: nextWorkspaces })
    persistState({ terminalWorkspaces: nextWorkspaces })
  },

  // ── Global multi-app split panes ──

  initializePanesIfEmpty: () => {
    const { rootLayout, currentApp, appStates } = get()
    if (rootLayout) return
    // Settings is overlay-only; never seed a layout with it. Fallback to notes.app.
    const seedApp: AppType = currentApp === 'settings.app' ? 'notes.app' : currentApp
    const paneId = genPaneId()
    const seedResource = appStates[seedApp]?.activeFilePath ?? null
    const firstTab = makeItem(seedApp, seedResource)
    const pane: Pane = {
      id: paneId,
      tabs: [firstTab],
      activeTabId: firstTab.id,
    }
    set({
      panes: { [paneId]: pane },
      rootLayout: { type: 'pane', paneId },
      focusedPaneId: paneId,
    })
    persistState({ panes: { [paneId]: pane }, rootLayout: { type: 'pane', paneId }, focusedPaneId: paneId })
  },

  createPane: (appId, activeFilePath = null) => {
    const paneId = genPaneId()
    const firstTab = makeItem(appId, activeFilePath)
    const pane: Pane = {
      id: paneId,
      tabs: [firstTab],
      activeTabId: firstTab.id,
    }
    const nextPanes = { ...get().panes, [paneId]: pane }
    set({ panes: nextPanes })
    persistState({ panes: nextPanes })
    return paneId
  },

  splitPane: (targetPaneId, newAppId, direction, position, initialFilePath = null) => {
    const state = get()
    // settings.app is an overlay, never a pane. Deflect to notes.app.
    const safeAppId: AppType = newAppId === 'settings.app' ? 'notes.app' : newAppId
    const newPaneId = genPaneId()
    const newResource = safeAppId === newAppId ? initialFilePath : null
    const firstTab = makeItem(safeAppId, newResource)
    const newPane: Pane = {
      id: newPaneId,
      tabs: [firstTab],
      activeTabId: firstTab.id,
    }
    const nextPanes = { ...state.panes, [newPaneId]: newPane }
    let nextLayout: PaneNode
    if (!state.rootLayout) {
      nextLayout = { type: 'pane', paneId: newPaneId }
    } else {
      nextLayout = insertPaneIntoTree(state.rootLayout, targetPaneId, newPaneId, direction, position)
    }
    set({ panes: nextPanes, rootLayout: nextLayout, focusedPaneId: newPaneId })
    persistState({ panes: nextPanes, rootLayout: nextLayout, focusedPaneId: newPaneId })
    return newPaneId
  },

  removePane: (paneId) => {
    const state = get()
    if (!state.rootLayout) return
    const nextLayout = removePaneFromTree(state.rootLayout, paneId)
    const nextPanes = { ...state.panes }
    delete nextPanes[paneId]
    const remainingIds = nextLayout ? collectPaneIds(nextLayout) : []
    const nextFocus = state.focusedPaneId === paneId
      ? (remainingIds[remainingIds.length - 1] ?? null)
      : state.focusedPaneId
    set({ panes: nextPanes, rootLayout: nextLayout, focusedPaneId: nextFocus })
    persistState({ panes: nextPanes, rootLayout: nextLayout, focusedPaneId: nextFocus })
  },

  movePane: (sourcePaneId, targetPaneId, direction, position) => {
    const state = get()
    if (!state.rootLayout || sourcePaneId === targetPaneId) return
    // Step 1: pluck source out of the tree. Target paneId remains.
    const without = removePaneFromTree(state.rootLayout, sourcePaneId)
    if (!without) return
    // Step 2: re-insert source next to target.
    const nextLayout = insertPaneIntoTree(without, targetPaneId, sourcePaneId, direction, position)
    set({ rootLayout: nextLayout, focusedPaneId: sourcePaneId })
    persistState({ rootLayout: nextLayout, focusedPaneId: sourcePaneId })
  },

  setFocusedPane: (paneId) => {
    const state = get()
    const pane = state.panes[paneId]
    if (!pane) return
    const paneApp = getPaneAppId(pane, state.currentApp)
    if (paneApp !== state.currentApp) {
      set({ focusedPaneId: paneId, currentApp: paneApp })
      persistState({ focusedPaneId: paneId, lastApp: paneApp })
    } else {
      set({ focusedPaneId: paneId })
      persistState({ focusedPaneId: paneId })
    }
  },

  setPaneActiveFile: (paneId, filePath) => {
    const state = get()
    const pane = state.panes[paneId]
    if (!pane) return
    // Update the active tab's resource (and label). If no active tab exists,
    // create one under the pane's current effective app.
    let nextTabs: Item[]
    let nextActiveTabId = pane.activeTabId
    if (pane.activeTabId) {
      nextTabs = pane.tabs.map((t) =>
        t.id === pane.activeTabId
          ? { ...t, resource: filePath, label: itemLabel(t.appId, filePath) }
          : t,
      )
    } else {
      const fresh = makeItem(getPaneAppId(pane, state.currentApp), filePath)
      nextTabs = [...pane.tabs, fresh]
      nextActiveTabId = fresh.id
    }
    const nextPane: Pane = { ...pane, tabs: nextTabs, activeTabId: nextActiveTabId }
    const nextPanes = { ...state.panes, [paneId]: nextPane }
    set({ panes: nextPanes })
    persistState({ panes: nextPanes })
  },

  findPaneByFile: (filePath) => {
    const { panes } = get()
    for (const id in panes) {
      const pane = panes[id]
      if (pane.tabs.some((t) => t.resource === filePath)) return id
    }
    return null
  },

  openTabInPane: (paneId, appId, resource) => {
    const state = get()
    const pane = state.panes[paneId]
    if (!pane) return
    // Dedupe: if a tab with same appId+resource already exists, activate it.
    const existing = pane.tabs.find((t) => t.appId === appId && t.resource === resource)
    if (existing) {
      const nextPane = ({ ...pane, activeTabId: existing.id })
      const nextPanes = { ...state.panes, [paneId]: nextPane }
      set({ panes: nextPanes })
      persistState({ panes: nextPanes })
      return
    }
    const fresh = makeItem(appId, resource)
    const nextPane = ({
      ...pane,
      tabs: [...pane.tabs, fresh],
      activeTabId: fresh.id,
    })
    const nextPanes = { ...state.panes, [paneId]: nextPane }
    set({ panes: nextPanes, focusedPaneId: paneId })
    persistState({ panes: nextPanes, focusedPaneId: paneId })
  },

  setActiveTab: (paneId, tabId) => {
    const state = get()
    const pane = state.panes[paneId]
    if (!pane || pane.activeTabId === tabId) return
    if (!pane.tabs.some((t) => t.id === tabId)) return
    const nextPane: Pane = { ...pane, activeTabId: tabId }
    const nextPanes = { ...state.panes, [paneId]: nextPane }
    // Sync appStates mirror so sidebar highlights the active tab's file.
    const nextApp = getPaneAppId(nextPane, state.currentApp)
    const nextResource = getPaneResource(nextPane)
    const updatedAppStates = {
      ...state.appStates,
      [nextApp]: {
        ...state.appStates[nextApp],
        activeFilePath: nextResource,
      },
    }
    set({ panes: nextPanes, appStates: updatedAppStates, currentApp: nextApp })
    persistState({ panes: nextPanes, appStates: updatedAppStates, lastApp: nextApp })
  },

  closeTab: (paneId, tabId) => {
    const state = get()
    const pane = state.panes[paneId]
    if (!pane) return
    const idx = pane.tabs.findIndex((t) => t.id === tabId)
    if (idx === -1) return
    const nextTabs = pane.tabs.filter((t) => t.id !== tabId)
    // Last tab closed: if this is the only pane, leave an empty tab state.
    // Otherwise remove the pane entirely (VSCode convention).
    if (nextTabs.length === 0) {
      const paneCount = Object.keys(state.panes).length
      if (paneCount > 1) {
        get().removePane(paneId)
        return
      }
      // Single pane: re-seed with an empty tab of the same app (keeps layout).
      const emptyTab = makeItem(getPaneAppId(pane, get().currentApp), null)
      const nextPane = ({
        ...pane,
        tabs: [emptyTab],
        activeTabId: emptyTab.id,
      })
      const nextPanes = { ...state.panes, [paneId]: nextPane }
      set({ panes: nextPanes })
      persistState({ panes: nextPanes })
      return
    }
    // Pick a neighbor as the new active tab if we closed the active one.
    let nextActiveTabId = pane.activeTabId
    if (pane.activeTabId === tabId) {
      const neighbor = nextTabs[Math.min(idx, nextTabs.length - 1)]
      nextActiveTabId = neighbor.id
    }
    const nextPane = ({
      ...pane,
      tabs: nextTabs,
      activeTabId: nextActiveTabId,
    })
    const nextPanes = { ...state.panes, [paneId]: nextPane }
    set({ panes: nextPanes })
    persistState({ panes: nextPanes })
  },

  moveTabWithinPane: (paneId, tabId, targetIndex) => {
    const state = get()
    const pane = state.panes[paneId]
    if (!pane) return
    const idx = pane.tabs.findIndex((t) => t.id === tabId)
    if (idx === -1 || idx === targetIndex) return
    const clampedTarget = Math.max(0, Math.min(targetIndex, pane.tabs.length - 1))
    const nextTabs = [...pane.tabs]
    const [moved] = nextTabs.splice(idx, 1)
    nextTabs.splice(clampedTarget, 0, moved)
    const nextPane = { ...pane, tabs: nextTabs }
    const nextPanes = { ...state.panes, [paneId]: nextPane }
    set({ panes: nextPanes })
    persistState({ panes: nextPanes })
  },

  moveTabToPane: (sourcePaneId, tabId, targetPaneId, insertIndex) => {
    const state = get()
    if (sourcePaneId === targetPaneId) {
      if (insertIndex !== undefined) get().moveTabWithinPane(sourcePaneId, tabId, insertIndex)
      return
    }
    const source = state.panes[sourcePaneId]
    const target = state.panes[targetPaneId]
    if (!source || !target) return
    const tab = source.tabs.find((t) => t.id === tabId)
    if (!tab) return
    // Target dedupe: if target already has this resource under same app, just activate.
    const dupe = target.tabs.find(
      (t) => t.appId === tab.appId && t.resource === tab.resource && t.resource !== null,
    )
    const sourceRemaining = source.tabs.filter((t) => t.id !== tabId)
    const nextTargetTabs = dupe
      ? target.tabs
      : (() => {
          const arr = [...target.tabs]
          const idx = insertIndex ?? arr.length
          arr.splice(Math.max(0, Math.min(idx, arr.length)), 0, tab)
          return arr
        })()
    const nextTargetActive = dupe ? dupe.id : tab.id

    // Build next panes map
    const nextPanes: Record<string, Pane> = { ...state.panes }
    // Target always updates
    nextPanes[targetPaneId] = ({
      ...target,
      tabs: nextTargetTabs,
      activeTabId: nextTargetActive,
    })
    // Source: drop the tab. If empty afterwards and not the only pane, remove it.
    if (sourceRemaining.length === 0) {
      const totalPanes = Object.keys(state.panes).length
      if (totalPanes > 1) {
        // Remove source pane from layout + panes map.
        delete nextPanes[sourcePaneId]
        const nextLayout = state.rootLayout ? removePaneFromTree(state.rootLayout, sourcePaneId) : null
        set({
          panes: nextPanes,
          rootLayout: nextLayout,
          focusedPaneId: targetPaneId,
        })
        persistState({ panes: nextPanes, rootLayout: nextLayout, focusedPaneId: targetPaneId })
        return
      }
      // Only pane — keep it but re-seed with an empty tab.
      const emptyTab = makeItem(getPaneAppId(source, get().currentApp), null)
      nextPanes[sourcePaneId] = ({
        ...source,
        tabs: [emptyTab],
        activeTabId: emptyTab.id,
      })
    } else {
      // Move the source's active pointer if we pulled out the active tab.
      const sourceNextActive =
        source.activeTabId === tabId
          ? sourceRemaining[Math.min(
              source.tabs.findIndex((t) => t.id === tabId),
              sourceRemaining.length - 1,
            )].id
          : source.activeTabId
      nextPanes[sourcePaneId] = ({
        ...source,
        tabs: sourceRemaining,
        activeTabId: sourceNextActive,
      })
    }
    set({ panes: nextPanes, focusedPaneId: targetPaneId })
    persistState({ panes: nextPanes, focusedPaneId: targetPaneId })
  },

  splitPaneWithTab: (sourcePaneId, tabId, targetPaneId, direction, position) => {
    const state = get()
    const source = state.panes[sourcePaneId]
    if (!source || !state.rootLayout) return
    const tab = source.tabs.find((t) => t.id === tabId)
    if (!tab) return
    // Prevent dropping onto self's edge when source has only one tab — that's a no-op.
    if (sourcePaneId === targetPaneId && source.tabs.length === 1) return

    const newPaneId = genPaneId()
    const newPane: Pane = {
      id: newPaneId,
      tabs: [tab],
      activeTabId: tab.id,
    }

    // Step 1: remove the tab from source's tabs.
    const sourceRemaining = source.tabs.filter((t) => t.id !== tabId)
    const nextPanes: Record<string, Pane> = { ...state.panes, [newPaneId]: newPane }

    // Step 2: handle source (empty → remove; else keep).
    let workingLayout: PaneNode | null = state.rootLayout
    if (sourceRemaining.length === 0) {
      const totalPanes = Object.keys(state.panes).length
      if (totalPanes > 1) {
        delete nextPanes[sourcePaneId]
        workingLayout = removePaneFromTree(state.rootLayout, sourcePaneId)
      } else {
        // Only pane — keep it but re-seed empty.
        const emptyTab = makeItem(getPaneAppId(source, state.currentApp), null)
        nextPanes[sourcePaneId] = ({
          ...source,
          tabs: [emptyTab],
          activeTabId: emptyTab.id,
        })
      }
    } else {
      const sourceNextActive =
        source.activeTabId === tabId
          ? sourceRemaining[Math.min(
              source.tabs.findIndex((t) => t.id === tabId),
              sourceRemaining.length - 1,
            )].id
          : source.activeTabId
      nextPanes[sourcePaneId] = ({
        ...source,
        tabs: sourceRemaining,
        activeTabId: sourceNextActive,
      })
    }

    // Step 3: insert the new pane next to target in the (possibly pruned) layout.
    const nextLayout = workingLayout
      ? insertPaneIntoTree(workingLayout, targetPaneId, newPaneId, direction, position)
      : ({ type: 'pane', paneId: newPaneId } as PaneNode)

    set({ panes: nextPanes, rootLayout: nextLayout, focusedPaneId: newPaneId })
    persistState({ panes: nextPanes, rootLayout: nextLayout, focusedPaneId: newPaneId })
  },

  openFileInPane: ({ filePath, appId, targetPaneId, direction, position }) => {
    const state = get()
    // Dedupe: if already open in a pane, focus that pane + activate that tab.
    const existingId = state.findPaneByFile(filePath)
    if (existingId) {
      const existingPane = state.panes[existingId]
      const matchingTab = existingPane.tabs.find((t) => t.resource === filePath)
      if (matchingTab) get().setActiveTab(existingId, matchingTab.id)
      get().setFocusedPane(existingId)
      return
    }
    // Split off target, create a new pane pre-loaded with the file.
    const newPaneId = genPaneId()
    const firstTab = makeItem(appId, filePath)
    const newPane: Pane = {
      id: newPaneId,
      tabs: [firstTab],
      activeTabId: firstTab.id,
    }
    const nextPanes = { ...state.panes, [newPaneId]: newPane }
    const nextLayout = state.rootLayout
      ? insertPaneIntoTree(state.rootLayout, targetPaneId, newPaneId, direction, position)
      : ({ type: 'pane', paneId: newPaneId } as PaneNode)
    const updatedAppStates = {
      ...state.appStates,
      [appId]: { ...state.appStates[appId], activeFilePath: filePath },
    }
    set({
      panes: nextPanes,
      rootLayout: nextLayout,
      focusedPaneId: newPaneId,
      currentApp: appId,
      appStates: updatedAppStates,
    })
    persistState({
      panes: nextPanes,
      rootLayout: nextLayout,
      focusedPaneId: newPaneId,
      lastApp: appId,
      appStates: updatedAppStates,
    })
    get().trackRecentFile(filePath, appId)
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

// Dev-only: expose store for debug tooling. Gated on import.meta.env.DEV so
// the reference is tree-shaken out of production builds.
if (import.meta.env.DEV) {
  ;(window as unknown as { __store?: typeof useUIStore }).__store = useUIStore
}
