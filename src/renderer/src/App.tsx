import { useEffect, useState, memo } from 'react'
import { useUIStore, genTerminalPersistKey } from './store/useUIStore'
import type { SplitNode } from './store/useUIStore'
import { MainLayout } from './layouts/MainLayout'
import { SettingsApp } from './apps/SettingsApp'
import { ContextMenuProvider } from './components/ContextMenu'
import { FileSwitcher } from './components/FileSwitcher'
import { ContextPanel } from './components/ContextPanel'
import { builtinThemes, applyTheme, applyFont } from './themes'
import type { FontId } from './themes'
import { getAppRegistry, getAppBus } from './core/AppContext'
import { AppAPIProvider } from './core/AppContext'
import { registerBuiltinApps } from './core/builtinApps'
import { TerminalApp } from './apps/TerminalApp'

export default function App() {
  const currentApp = useUIStore((s) => s.currentApp)
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
        if (c.ai) useUIStore.setState({ ai: { ...useUIStore.getState().ai, ...c.ai } })
        if (c.mcpServers) useUIStore.setState({ mcpServers: c.mcpServers })

        // terminal.app — recreate PTY sessions with saved cwd + buffer
        if (c.terminalSessions?.length > 0) {
          const defaultCwd = c.codeProjectPath || undefined
          type SavedSession = { persistKey?: string; title: string; cwd?: string }
          const savedWorkspaces = c.terminalWorkspaces as { id: string; path: string; name: string; groups: { id: string; layout: SplitNode }[]; activeGroupId: string | null }[] | undefined

          Promise.all(
            (c.terminalSessions as SavedSession[]).map(async (saved) => {
              const cwd = saved.cwd || defaultCwd
              const persistKey = saved.persistKey || genTerminalPersistKey()
              const res = await window.api.terminal.create(cwd)
              if (!res.ok) return null
              // Load raw replay buffer (saved as raw PTY output, not xterm serialization)
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

            // Build persistKey → new PTY id map for remapping layout trees
            const keyToId = new Map<string, string>()
            sessions.forEach((s) => keyToId.set(s.persistKey, s.id))

            // Remap terminal IDs in a SplitNode tree (old PTY id → new PTY id)
            // The layout stores PTY ids which change on restart. We match via persistKey.
            function remapLayout(node: SplitNode, oldIdToKey: Map<string, string>): SplitNode {
              if (node.type === 'terminal') {
                const key = oldIdToKey.get(node.terminalId)
                const newId = key ? keyToId.get(key) : undefined
                return newId ? { type: 'terminal', terminalId: newId } : node
              }
              return { ...node, children: node.children.map((ch) => remapLayout(ch, oldIdToKey)) }
            }

            let workspaces: typeof savedWorkspaces
            if (savedWorkspaces?.length) {
              // Build old-id → persistKey map from saved sessions (order-preserved)
              const savedSessions = c.terminalSessions as SavedSession[]
              const oldIdToKey = new Map<string, string>()

              // Collect old terminal IDs from saved layout trees
              const oldIds: string[] = []
              function collectIds(node: SplitNode) {
                if (node.type === 'terminal') oldIds.push(node.terminalId)
                else node.children.forEach(collectIds)
              }
              savedWorkspaces.forEach((ws) => ws.groups.forEach((g) => collectIds(g.layout)))

              // Map old IDs to persistKeys by position (sessions and layout share same order)
              oldIds.forEach((oldId, i) => {
                const key = savedSessions[i]?.persistKey
                if (key) oldIdToKey.set(oldId, key)
              })

              workspaces = savedWorkspaces.map((ws) => ({
                ...ws,
                groups: ws.groups.map((g) => ({
                  ...g,
                  layout: remapLayout(g.layout, oldIdToKey),
                })),
              }))
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
                const groups = wsSessions.map((s) => ({
                  id: `group-${s.id}-${Date.now()}`,
                  layout: { type: 'terminal' as const, terminalId: s.id },
                }))
                return { id: wsId, path: wsPath, name, groups, activeGroupId: groups[groups.length - 1].id }
              })
            }

            const savedActiveWsId = c.activeWorkspaceId as string | undefined

            useUIStore.setState({
              terminalSessions: sessions,
              activeTerminalId: sessions[sessions.length - 1].id,
              terminalWorkspaces: workspaces,
              activeWorkspaceId: savedActiveWsId && workspaces.some((ws) => ws.id === savedActiveWsId) ? savedActiveWsId : workspaces[workspaces.length - 1]?.id ?? null,
            })
          })
        }
      }

      // Register built-in apps
      return registerBuiltinApps(getAppRegistry())
    }).then(() => {
      // Set up Bus-to-main bridge — allows main process MCP server to call Bus tools
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

      setRestored(true)
    }).catch((err) => {
      console.error('Failed to restore state:', err)
      applyTheme(builtinThemes.dark)
      registerBuiltinApps(getAppRegistry()).then(() => setRestored(true))
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
      const visibleIds = new Set<string>()
      if (activeWs) {
        const collectIds = (node: SplitNode) => {
          if (node.type === 'terminal') visibleIds.add(node.terminalId)
          else node.children.forEach(collectIds)
        }
        activeWs.groups.forEach((g) => collectIds(g.layout))
      }

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
          id: ws.id, path: ws.path, name: ws.name, groups: ws.groups, activeGroupId: ws.activeGroupId,
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

      // Cmd+Shift+K — Context Panel (inject notes/collector into terminal)
      if (e.metaKey && e.key === 'k' && e.shiftKey) {
        e.preventDefault()
        store.setShowContextPanel(!store.showContextPanel)
        return
      }

      // Cmd+K / Cmd+P — Command Palette (file search)
      if (e.metaKey && (e.key === 'k' || e.key === 'p') && !e.shiftKey) {
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

      // Cmd+\ — Toggle sidebar
      if (e.metaKey && e.key === '\\') {
        e.preventDefault()
        store.toggleSidebar()
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

  const registry = getAppRegistry()
  const registeredApp = registry.get(currentApp)
  const ActiveApp = currentApp === 'settings.app' ? SettingsApp : registeredApp?.definition.component
  const isTerminalActive = currentApp === 'terminal.app'

  // Resolve the non-terminal app component
  const OtherApp = !isTerminalActive ? ActiveApp : null

  return (
    <>
      <MainLayout>
        {/* Terminal always mounted (hidden when inactive) to preserve xterm scrollback.
            Same pattern as VS Code — terminal instances survive app switches. */}
        <PersistentTerminal visible={isTerminalActive} />

        {/* Other apps mount/unmount normally */}
        {OtherApp ? (
          <AppAPIProvider appId={currentApp}>
            <OtherApp api={undefined as any} />
          </AppAPIProvider>
        ) : !isTerminalActive ? (
          <PlaceholderApp name={currentApp} />
        ) : null}
      </MainLayout>
      <ContextMenuProvider />
      <FileSwitcher />
      <ContextPanel />
    </>
  )
}

/** Terminal persists across app switches — xterm instances stay alive.
 *  Uses display:none instead of unmounting to preserve scrollback + PTY state. */
const PersistentTerminal = memo(function PersistentTerminal({ visible }: { visible: boolean }) {
  const hasTerminals = useUIStore((s) => s.terminalSessions.length > 0)
  // Don't mount at all until first terminal is created
  const [everMounted, setEverMounted] = useState(false)
  useEffect(() => {
    if (hasTerminals) setEverMounted(true)
  }, [hasTerminals])

  if (!everMounted) return null

  return (
    <div style={{ display: visible ? 'contents' : 'none' }}>
      <AppAPIProvider appId="terminal.app">
        <TerminalApp />
      </AppAPIProvider>
    </div>
  )
})

function PlaceholderApp({ name }: { name: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-tx-faint text-sm">
      {name} — coming soon
    </div>
  )
}
