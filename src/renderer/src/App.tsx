import { useEffect, useState } from 'react'
import {
  useUIStore,
  genTerminalPersistKey,
  collectPaneIds,
  makeItem,
  getActiveItem,
} from './store/useUIStore'
import type { SplitNode, Pane, Item } from './store/useUIStore'
import { MainLayout } from './layouts/MainLayout'
import { PaneTree } from './layouts/PaneTree'
import { ClassicAppHost } from './layouts/ClassicAppHost'
import { SettingsApp } from './apps/SettingsApp'
import { ContextMenuProvider } from './components/ContextMenu'
import { FileSwitcher } from './components/FileSwitcher'
import { ContextPanel } from './components/ContextPanel'
import { WelcomeDialog } from './components/WelcomeDialog'
import { AppToast } from './components/AppToast'
import { builtinThemes, applyTheme, applyFont } from './themes'
import type { FontId } from './themes'
import { getAppRegistry, getAppBus } from './core/AppContext'
import { registerBuiltinApps } from './core/builtinApps'

/**
 * Walk a saved rootLayout and verify every referenced paneId exists in the panes map.
 * Used to guard against corrupted persisted state across schema changes.
 */
function isValidLayout(node: unknown, panes: Record<string, unknown>): boolean {
  if (!node || typeof node !== 'object') return false
  const n = node as { type?: string; paneId?: string; children?: unknown[] }
  if (n.type === 'pane') return !!(n.paneId && panes[n.paneId])
  if (n.type === 'split') return Array.isArray(n.children) && n.children.every((c) => isValidLayout(c, panes))
  return false
}

export default function App() {
  const currentApp = useUIStore((s) => s.currentApp)
  const contentLayoutMode = useUIStore((s) => s.contentLayoutMode)
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
        if (c.lastApp) store.setCurrentApp(c.lastApp)
        if (c.appStates) useUIStore.setState({ appStates: { ...store.appStates, ...c.appStates } })
        if (c.sidebarOpen !== undefined) useUIStore.setState({ sidebarOpen: c.sidebarOpen })
        if (c.notesExpandedGroups) useUIStore.setState({ notesExpandedGroups: c.notesExpandedGroups })
        if (c.notesSortBy) useUIStore.setState({ notesSortBy: c.notesSortBy })
        if (c.codeProjectPath) useUIStore.setState({ codeProjectPath: c.codeProjectPath })
        if (c.recentProjects) useUIStore.setState({ recentProjects: c.recentProjects })
        if (c.recentFiles) useUIStore.setState({ recentFiles: c.recentFiles })
        if (c.ai) {
          // Migrate old featureRouting (plain providerId strings → {providerId, model?} objects)
          const migratedAi = { ...c.ai }
          if (migratedAi.featureRouting) {
            const fr = migratedAi.featureRouting as Record<string, unknown>
            const migrate = (v: unknown): { providerId: string; model?: string } | null => {
              if (!v) return null
              if (typeof v === 'string') return { providerId: v }
              if (typeof v === 'object' && v !== null && 'providerId' in (v as any)) return v as any
              return null
            }
            migratedAi.featureRouting = {
              completion: migrate(fr.completion),
              chat: migrate(fr.chat),
            } as any
          }
          useUIStore.setState({ ai: { ...useUIStore.getState().ai, ...migratedAi } })
        }
        if (c.mcpServers) useUIStore.setState({ mcpServers: c.mcpServers })
        if (c.hasSeenWelcome !== undefined) useUIStore.setState({ hasSeenWelcome: c.hasSeenWelcome })
        if (c.markdownTheme) useUIStore.setState({ markdownTheme: c.markdownTheme })
        const savedMode = (c as Record<string, unknown>).contentLayoutMode
        if (savedMode === 'tabs' || savedMode === 'single') {
          useUIStore.setState({ contentLayoutMode: savedMode })
        }

        // Restore multi-pane layout (if present). Validate tree/panes consistency;
        // if saved state is corrupted we fall through and initializePanesIfEmpty
        // will regenerate a fresh single-pane from currentApp.
        // Legacy shape: pre-Phase 1 panes carried { appId, activeFilePath } mirror
        // fields that have since been replaced by tabs[]. Accept either.
        type LegacyPane = Partial<Pane> & {
          id: string
          appId?: string
          activeFilePath?: string | null
        }
        const savedPanes = (c as Record<string, unknown>).panes as
          | Record<string, LegacyPane>
          | undefined
        const savedRootLayout = (c as Record<string, unknown>).rootLayout as unknown
        const savedFocusedPaneId = (c as Record<string, unknown>).focusedPaneId as string | undefined
        if (savedPanes && savedRootLayout && isValidLayout(savedRootLayout, savedPanes)) {
          const migrated: Record<string, Pane> = {}
          for (const id in savedPanes) {
            const p = savedPanes[id]
            const hasTabs = Array.isArray(p.tabs) && p.tabs.length > 0
            if (hasTabs) {
              migrated[id] = {
                id: p.id,
                tabs: p.tabs as Item[],
                activeTabId: p.activeTabId ?? (p.tabs as Item[])[0]?.id ?? null,
              }
            } else if (p.appId) {
              const firstTab = makeItem(p.appId as never, p.activeFilePath ?? null)
              migrated[id] = {
                id: p.id,
                tabs: [firstTab],
                activeTabId: firstTab.id,
              }
            }
          }
          const validFocus = savedFocusedPaneId && migrated[savedFocusedPaneId]
            ? savedFocusedPaneId
            : Object.keys(migrated)[0] ?? null
          useUIStore.setState({
            panes: migrated,
            rootLayout: savedRootLayout as never,
            focusedPaneId: validFocus,
          })
        }

        // terminal.app — recreate PTY sessions with saved cwd + buffer.
        // Legacy schema: workspace.groups[].layout: SplitNode (PTY ids embedded).
        // New schema:    workspace.sessionIds[] (flat).
        if (c.terminalSessions?.length > 0) {
          const defaultCwd = c.codeProjectPath || undefined
          // `id` is persisted alongside persistKey for same-session restart
          // (see saveConfig in App.tsx) — we use it to rebuild oldIdToKey so
          // that pane tabs' `resource: <oldSessionId>` keeps pointing at a
          // live PTY after relaunch, instead of dropping into the "No terminal
          // session" placeholder.
          type SavedSession = { id?: string; persistKey?: string; title: string; cwd?: string }
          type LegacyWs = {
            id: string; path: string; name: string
            groups?: { id: string; layout: SplitNode }[]
            sessionIds?: string[]
            activeGroupId?: string | null
          }
          const savedWorkspaces = c.terminalWorkspaces as LegacyWs[] | undefined

          Promise.all(
            (c.terminalSessions as SavedSession[]).map(async (saved) => {
              const cwd = saved.cwd || defaultCwd
              const persistKey = saved.persistKey || genTerminalPersistKey()
              const res = await window.api.terminal.create(cwd)
              if (!res.ok) return null
              let replayBuffer: string | undefined
              const bufferRes = await window.api.terminal.loadBuffer(persistKey)
              if (bufferRes.ok && bufferRes.data) replayBuffer = bufferRes.data
              return { id: res.data, persistKey, title: saved.title, cwd, _replayBuffer: replayBuffer }
            }),
          ).then((results) => {
            const sessions = results.filter(Boolean) as {
              id: string; persistKey: string; title: string; cwd?: string; _replayBuffer?: string
            }[]
            if (sessions.length === 0) return

            const keyToId = new Map<string, string>()
            sessions.forEach((s) => keyToId.set(s.persistKey, s.id))
            const savedSessions = c.terminalSessions as SavedSession[]
            const oldIdToKey = new Map<string, string>()
            // New-format: we save each session's PTY id alongside its
            // persistKey. After relaunch the PTY id changes, but we can still
            // look up the persistKey from the old id.
            savedSessions.forEach((s) => {
              if (s.id && s.persistKey) oldIdToKey.set(s.id, s.persistKey)
            })
            // Legacy layout trees (workspace.groups[].layout) only contained
            // terminal IDs; map them by position into the saved session list
            // so their persistKey can still be recovered.
            const legacyOldIds: string[] = []
            function collectFromLegacy(node: SplitNode) {
              if (node.type === 'terminal') legacyOldIds.push(node.terminalId)
              else node.children.forEach(collectFromLegacy)
            }
            savedWorkspaces?.forEach((ws) => ws.groups?.forEach((g) => collectFromLegacy(g.layout)))
            legacyOldIds.forEach((oldId, i) => {
              const key = savedSessions[i]?.persistKey
              if (key && !oldIdToKey.has(oldId)) oldIdToKey.set(oldId, key)
            })
            const remapOldId = (oldId: string): string | undefined => {
              // Accept both bare ids and `terminal://<id>` forms, since some
              // callers store resources with the scheme prefix.
              const bare = oldId.startsWith('terminal://') ? oldId.slice('terminal://'.length) : oldId
              const key = oldIdToKey.get(bare)
              return key ? keyToId.get(key) : undefined
            }
            function flattenLegacyGroups(groups: { layout: SplitNode }[]): string[] {
              const ids: string[] = []
              const walk = (n: SplitNode) => {
                if (n.type === 'terminal') {
                  const newId = remapOldId(n.terminalId)
                  if (newId) ids.push(newId)
                } else n.children.forEach(walk)
              }
              groups.forEach((g) => walk(g.layout))
              return ids
            }

            // Walk a persisted classic SplitNode tree and remap old session
            // ids to new ones. Leaves that can't be resolved (session gone)
            // are pruned; if that collapses the whole tree, returns null.
            function remapClassicLayout(node: SplitNode): SplitNode | null {
              if (node.type === 'terminal') {
                const newId = remapOldId(node.terminalId)
                return newId ? { type: 'terminal', terminalId: newId } : null
              }
              const mapped = node.children
                .map(remapClassicLayout)
                .filter(Boolean) as SplitNode[]
              if (mapped.length === 0) return null
              if (mapped.length === 1) return mapped[0]
              const sizesOk = node.sizes?.length === mapped.length ? node.sizes : undefined
              return { type: 'split', direction: node.direction, children: mapped, sizes: sizesOk }
            }

            type SavedWsPlus = LegacyWs & { classicLayout?: SplitNode | null }
            let workspaces: {
              id: string; path: string; name: string
              sessionIds: string[]; classicLayout?: SplitNode | null
            }[]
            if (savedWorkspaces?.length) {
              workspaces = (savedWorkspaces as SavedWsPlus[]).map((ws) => {
                const classicLayout = ws.classicLayout
                  ? remapClassicLayout(ws.classicLayout)
                  : undefined
                if (Array.isArray(ws.sessionIds)) {
                  // New-schema save — IDs are PTY ids from previous session;
                  // remap via persistKey only if they match old ids.
                  const mapped = ws.sessionIds
                    .map((id) => remapOldId(id) ?? (sessions.some((s) => s.id === id) ? id : null))
                    .filter(Boolean) as string[]
                  return {
                    id: ws.id, path: ws.path, name: ws.name,
                    sessionIds: mapped,
                    ...(classicLayout !== undefined ? { classicLayout } : {}),
                  }
                }
                return {
                  id: ws.id,
                  path: ws.path,
                  name: ws.name,
                  sessionIds: flattenLegacyGroups(ws.groups ?? []),
                  ...(classicLayout !== undefined ? { classicLayout } : {}),
                }
              })
            } else {
              // No saved workspaces — group by cwd
              const wsMap = new Map<string, typeof sessions>()
              for (const s of sessions) {
                const key = s.cwd || 'default'
                const list = wsMap.get(key) || []
                list.push(s)
                wsMap.set(key, list)
              }
              workspaces = Array.from(wsMap.entries()).map(([wsPath, wsSessions]) => {
                const name = wsPath.split('/').filter(Boolean).pop() || wsPath
                const wsId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
                return { id: wsId, path: wsPath, name, sessionIds: wsSessions.map((s) => s.id) }
              })
            }

            const savedActiveWsId = c.activeWorkspaceId as string | undefined

            // Remap stale terminal session ids in pane tabs so restored tabs
            // reconnect to their freshly-created PTY instead of showing a
            // "No terminal session" ghost. Tabs whose old id can't be
            // resolved to a live session (PTY create failed, or the saved
            // id is from an entirely orphaned save) are dropped — the user
            // can always re-open the session from the sidebar.
            const currentPanes = useUIStore.getState().panes
            let panesChanged = false
            const remappedPanes: typeof currentPanes = {}
            const sessionIdSet = new Set(sessions.map((s) => s.id))
            for (const pid in currentPanes) {
              const p = currentPanes[pid]
              let thisPaneChanged = false
              const nextTabs = p.tabs.flatMap((t) => {
                if (t.appId !== 'terminal.app' || !t.resource) return [t]
                // 1) Already points at a live session (e.g. tab was created
                //    within this session). Keep as-is.
                if (sessionIdSet.has(t.resource)) return [t]
                // 2) Old PTY id → persistKey → new PTY id.
                const newId = remapOldId(t.resource)
                if (newId && sessionIdSet.has(newId)) {
                  thisPaneChanged = true
                  const sess = sessions.find((s) => s.id === newId)
                  return [{ ...t, resource: newId, label: sess?.title ?? t.label }]
                }
                // 3) Nothing resolves — drop the ghost tab.
                thisPaneChanged = true
                return []
              })
              if (thisPaneChanged) {
                panesChanged = true
                const nextActive =
                  nextTabs.some((t) => t.id === p.activeTabId)
                    ? p.activeTabId
                    : nextTabs[0]?.id ?? null
                remappedPanes[pid] = { ...p, tabs: nextTabs, activeTabId: nextActive }
              } else {
                remappedPanes[pid] = p
              }
            }

            useUIStore.setState({
              terminalSessions: sessions,
              activeTerminalId: sessions[sessions.length - 1].id,
              terminalWorkspaces: workspaces,
              activeWorkspaceId: savedActiveWsId && workspaces.some((ws) => ws.id === savedActiveWsId) ? savedActiveWsId : workspaces[workspaces.length - 1]?.id ?? null,
              ...(panesChanged ? { panes: remappedPanes } : {}),
            })
          })
        }
      }

      // Register built-in apps
      return registerBuiltinApps(getAppRegistry())
    }).then(() => {
      const registry = getAppRegistry()
      const store = useUIStore.getState()
      const firstEnabled = registry.getEnabled()[0]?.definition.manifest.id
      const isKnown = (id: string): boolean => id === 'settings.app' || !!registry.get(id)

      // If currentApp is no longer registered (e.g., app removed), fall back.
      if (!isKnown(store.currentApp) && firstEnabled) {
        store.setCurrentApp(firstEnabled as never)
      }

      // Detect corrupted layout: bad pane (unregistered / settings) → full reset.
      // Multiple terminal panes → migrate extras to notes.app (terminal lacks
      // per-pane state, so duplicates show identical content).
      if (Object.keys(store.panes).length > 0) {
        const paneApp = (p: Pane): string =>
          (p.tabs.find((t) => t.id === p.activeTabId) ?? p.tabs[0])?.appId ?? 'notes.app'
        const hasBadPane = Object.values(store.panes).some(
          (p) => !isKnown(paneApp(p)) || paneApp(p) === 'settings.app',
        )
        if (hasBadPane) {
          useUIStore.setState({ panes: {}, rootLayout: null, focusedPaneId: null })
          window.api.state.update({ panes: {}, rootLayout: null, focusedPaneId: null })
        } else {
          // Keep the first terminal pane, convert extras to notes.app.
          let terminalSeen = false
          let changed = false
          const migrated: typeof store.panes = {}
          for (const id in store.panes) {
            const p = store.panes[id]
            if (paneApp(p) === 'terminal.app') {
              if (terminalSeen) {
                const freshTab = makeItem('notes.app' as never, null)
                migrated[id] = { ...p, tabs: [freshTab], activeTabId: freshTab.id }
                changed = true
              } else {
                terminalSeen = true
                migrated[id] = p
              }
            } else {
              migrated[id] = p
            }
          }
          if (changed) {
            useUIStore.setState({ panes: migrated })
            window.api.state.update({ panes: migrated })
          }
        }
      }

      // Initialize single-pane layout from currentApp (after apps registered)
      useUIStore.getState().initializePanesIfEmpty()
    }).then(() => {
      // Set up Bus-to-main bridge — allows main process to call Bus tools
      const bus = getAppBus()
      window.api.bus.onListTools(() => {
        return bus.getTools().map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
          appId: t.appId,
        }))
      })
      window.api.bus.onCallTool(async (name, params) => {
        return bus.request(name, params)
      })

      // Notify main process that Bus tools are ready
      window.api.bus.notifyToolsReady()

      setRestored(true)
    }).catch((err) => {
      console.error('Failed to restore state:', err)
      applyTheme(builtinThemes.dark)
      registerBuiltinApps(getAppRegistry()).then(() => {
        useUIStore.getState().initializePanesIfEmpty()
        setRestored(true)
      })
    })
  }, [])

  // Periodically refresh terminal cwds (only active workspace terminals, not all)
  useEffect(() => {
    const interval = setInterval(async () => {
      const state = useUIStore.getState()
      const { terminalSessions, terminalWorkspaces, activeWorkspaceId } = state
      if (terminalSessions.length === 0) return

      // Only poll CWD for terminals in the active workspace (performance)
      const activeWs = terminalWorkspaces.find((ws) => ws.id === activeWorkspaceId)
      const visibleIds = new Set<string>(activeWs?.sessionIds ?? [])

      let changed = false
      const updated = await Promise.all(
        terminalSessions.map(async (s) => {
          if (!visibleIds.has(s.id)) return s // skip non-visible terminals
          try {
            const res = await window.api.terminal.getCwd(s.id)
            if (res.ok && res.data && res.data !== s.cwd) {
              changed = true
              return { ...s, cwd: res.data }
            }
          } catch {}
          return s
        }),
      )
      if (changed) useUIStore.setState({ terminalSessions: updated })
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  // Save terminal state — sessions, workspaces, layout + raw replay buffers.
  // Raw PTY output (not xterm serialization) adapts to new column width on replay.
  useEffect(() => {
    async function saveReplayBuffers(): Promise<void> {
      const { terminalSessions } = useUIStore.getState()
      if (terminalSessions.length === 0) return
      for (const s of terminalSessions) {
        try {
          const res = await window.api.terminal.getReplayBuffer(s.id)
          // Only save if buffer has meaningful content (>1KB).
          // Prevents a freshly-created PTY (just a prompt) from
          // overwriting a previously saved buffer with real content.
          if (res.ok && res.data && res.data.length > 1024) {
            window.api.terminal.saveBuffer(s.persistKey, res.data)
          }
        } catch { /* ignore */ }
      }
    }

    function saveConfig(sync: boolean): void {
      const { terminalSessions, terminalWorkspaces, activeWorkspaceId, activeTerminalId, currentApp } = useUIStore.getState()
      const config: Record<string, unknown> = {
        lastApp: currentApp,
        terminalSessions: terminalSessions.map((t) => ({ id: t.id, persistKey: t.persistKey, title: t.title, cwd: t.cwd })),
        terminalWorkspaces: terminalWorkspaces.map((ws) => ({
          id: ws.id, path: ws.path, name: ws.name, sessionIds: ws.sessionIds,
          ...(ws.classicLayout !== undefined ? { classicLayout: ws.classicLayout } : {}),
        })),
        activeWorkspaceId,
        activeTerminalId,
      }
      if (sync) {
        window.api.terminal.saveAllSync([], config)
      } else {
        window.api.state.update(config)
      }
    }

    // Periodic auto-save: replay buffers (async) + config
    const autoSaveInterval = setInterval(() => {
      saveReplayBuffers()
      saveConfig(false)
    }, 30_000)

    // Save replay buffers once on first mount
    saveReplayBuffers()

    // Sync config save on window close (replay buffers already saved periodically)
    const handleBeforeUnload = (): void => saveConfig(true)
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      clearInterval(autoSaveInterval)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])

  // ── Global keyboard shortcuts (renderer-side) ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const store = useUIStore.getState()

      // Cmd+Shift+K — Context Panel: copy a resource path or inject it
      // straight into the focused terminal (notes/collector/files).
      if (e.metaKey && e.key === 'k' && e.shiftKey) {
        e.preventDefault()
        store.setShowContextPanel(!store.showContextPanel)
        return
      }

      // Cmd+P — Command Palette (file/app/action search). Cmd+K used to
      // duplicate this; removed so it can be reclaimed (and so the binding
      // table doesn't list two keys for the same action).
      if (e.metaKey && e.key === 'p' && !e.shiftKey) {
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

      // Cmd+B — Toggle sidebar (VS Code convention)
      if (e.metaKey && e.key === 'b' && !e.shiftKey) {
        e.preventDefault()
        store.toggleSidebar()
        return
      }

      // Cmd+\ — Split focused pane right
      // Cmd+Shift+\ — Split focused pane down
      if (e.metaKey && e.key === '\\') {
        e.preventDefault()
        const focusId = store.focusedPaneId
        if (!focusId) return
        const focused = store.panes[focusId]
        if (!focused) return
        const activeItem = getActiveItem(focused)
        if (!activeItem) return
        const direction = e.shiftKey ? 'vertical' : 'horizontal'
        store.splitPane(focusId, activeItem.appId, direction, 'after', activeItem.resource)
        return
      }

      // Cmd+W — Close the active tab of the focused pane.
      // closeTab handles the cascade: last tab + multi-pane → remove pane.
      if (e.metaKey && e.key === 'w' && !e.shiftKey) {
        const focusId = store.focusedPaneId
        if (!focusId) return
        const pane = store.panes[focusId]
        if (!pane) return
        // Don't swallow ⌘W on the last tab of the only pane — let the OS close the window.
        const paneCount = Object.keys(store.panes).length
        if (paneCount <= 1 && pane.tabs.length <= 1) return
        const activeTabId = pane.activeTabId
        if (!activeTabId) return
        e.preventDefault()
        store.closeTab(focusId, activeTabId)
        return
      }

      // Cmd+1..9 — Focus nth pane (by layout-tree traversal order)
      if (e.metaKey && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        if (!store.rootLayout) return
const ids = collectPaneIds(store.rootLayout)
        const idx = parseInt(e.key, 10) - 1
        if (idx >= ids.length) return
        e.preventDefault()
        store.setFocusedPane(ids[idx])
        return
      }

      // Cmd+Alt+Left/Right — Cycle focused pane (prev / next in traversal order)
      if (e.metaKey && e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        if (!store.rootLayout) return
const ids = collectPaneIds(store.rootLayout)
        if (ids.length < 2) return
        const curIdx = ids.indexOf(store.focusedPaneId ?? '')
        const nextIdx = e.key === 'ArrowLeft'
          ? (curIdx <= 0 ? ids.length - 1 : curIdx - 1)
          : (curIdx >= ids.length - 1 ? 0 : curIdx + 1)
        e.preventDefault()
        store.setFocusedPane(ids[nextIdx])
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

  // ── Global file drop (.md anywhere in the window → import + open) ──
  // Local handlers in the Notes sidebar / editor get first dibs by virtue of
  // bubbling order: React's synthetic events run before this window-level
  // bubble listener, so anything they preventDefault'd we leave alone. What
  // falls through is the "drop anywhere outside an existing target" case —
  // we copy the file under `{liteHome}/notes/` and open it.
  useEffect(() => {
    // Chromium hides `dataTransfer.files` during dragenter/dragover for
    // security — only `types` is populated. Filename extensions also aren't
    // exposed until `drop`, so during dragover we can only know there ARE
    // files coming, not whether they're .md. We accept ALL file drops at the
    // window level, then filter at drop time. (Without this, Electron's
    // default `file://` navigation kicks in and unloads the app.)
    const isFilesDrag = (dt: DataTransfer | null): boolean => {
      if (!dt) return false
      for (let i = 0; i < dt.types.length; i++) {
        if (dt.types[i] === 'Files') return true
      }
      return false
    }

    const pickAvailable = (name: string, used: Set<string>): string => {
      if (!used.has(name)) return name
      const m = name.match(/\.(md|markdown|txt)$/i)
      const ext = m ? m[0] : ''
      const stem = ext ? name.slice(0, -ext.length) : name
      for (let i = 2; i < 10_000; i++) {
        const c = `${stem} (${i})${ext}`
        if (!used.has(c)) return c
      }
      return `${stem}-${Date.now()}${ext}`
    }

    const onDragOver = (e: DragEvent): void => {
      if (!isFilesDrag(e.dataTransfer)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }

    const onDrop = async (e: DragEvent): Promise<void> => {
      if (!e.dataTransfer || e.dataTransfer.files.length === 0) return
      const mdFiles = Array.from(e.dataTransfer.files).filter((f) => f.name.toLowerCase().endsWith('.md'))
      if (mdFiles.length === 0) return

      // ALWAYS preventDefault so Electron doesn't navigate to file://.
      e.preventDefault()

      // If the cursor was over a Sidebar drop zone, let Sidebar's React
      // handler do the import — it knows the targeted group. We marked
      // those zones with `data-notebook-drop-zone` precisely so this check
      // is reliable (event-ordering / defaultPrevented races are flaky).
      const target = e.target as Element | null
      if (target?.closest?.('[data-notebook-drop-zone]')) return

      const store = useUIStore.getState()
      const liteHome = store.liteHome
      if (!liteHome) return
      const notesDir = `${liteHome}/notes`

      const dirRes = await window.api.fs.readDir(notesDir)
      const used = new Set(dirRes.ok ? dirRes.data.map((n) => n.name) : [])

      let lastPath: string | null = null
      for (const f of mdFiles) {
        const targetName = pickAvailable(f.name, used)
        const target = `${notesDir}/${targetName}`
        const content = await f.text()
        const createRes = await window.api.fs.createFile(target)
        if (!createRes.ok) continue
        await window.api.fs.writeFile(target, content)
        used.add(targetName)
        lastPath = target
      }

      if (lastPath) {
        store.setCurrentApp('notes.app')
        store.setActiveFilePath(lastPath)
      }
    }

    // Both registered at CAPTURE phase — we always fire before children, so
    // Electron's default `file://` navigation is suppressed for every file
    // drag (any cursor location). Routing between global vs. Sidebar import
    // is done by `data-notebook-drop-zone` lookup inside `onDrop`, which is
    // robust to event-ordering quirks.
    window.addEventListener('dragover', onDragOver, true)
    window.addEventListener('drop', onDrop, true)
    return () => {
      window.removeEventListener('dragover', onDragOver, true)
      window.removeEventListener('drop', onDrop, true)
    }
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

  return (
    <>
      <MainLayout>
        {currentApp === 'settings.app'
          ? <SettingsApp />
          : contentLayoutMode === 'single'
            ? <ClassicAppHost />
            : <PaneTree />}
      </MainLayout>
      <ContextMenuProvider />
      <FileSwitcher />
      <ContextPanel />
      <WelcomeDialog />
      <AppToast />
    </>
  )
}
