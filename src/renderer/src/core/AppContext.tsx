/**
 * App Context — provides LiteAppAPI + Registry to all components.
 */
import { createContext, useContext, useMemo, useRef } from 'react'
import type { LiteAppAPI, AppBus } from '../../../shared/app-interface'
import type { AppRegistry } from './AppRegistry'
import { createAppBus } from './AppBus'
import { createAppRegistry } from './AppRegistry'
import { useUIStore } from '../store/useUIStore'
import { builtinThemes } from '../themes'

// ── Singleton instances ──

let _bus: AppBus | null = null
let _registry: AppRegistry | null = null
let _eventBridgeInstalled = false

export function getAppBus(): AppBus {
  if (!_bus) _bus = createAppBus()
  // Install the main → renderer event bridge exactly once. IPC events from
  // the main process (via window.api.events.onAppEvent) are re-emitted onto
  // the AppBus so any app subscribed via `bus.on(eventName, ...)` receives
  // them alongside renderer-local events.
  if (!_eventBridgeInstalled && typeof window !== 'undefined' && window.api?.events?.onAppEvent) {
    _eventBridgeInstalled = true
    window.api.events.onAppEvent((event) => {
      if (event && typeof event.type === 'string') {
        _bus!.emit(event.type, event)
      }
    })
  }
  return _bus
}

export function getAppRegistry(): AppRegistry {
  if (!_registry) _registry = createAppRegistry()
  return _registry
}

// ── Context ──

const AppAPIContext = createContext<LiteAppAPI | null>(null)
const RegistryContext = createContext<AppRegistry>(getAppRegistry())

export function useAppAPI(): LiteAppAPI {
  const ctx = useContext(AppAPIContext)
  if (!ctx) throw new Error('useAppAPI must be inside AppAPIProvider')
  return ctx
}

export function useAppRegistry(): AppRegistry {
  return useContext(RegistryContext)
}

// ── Provider ──

export const AppAPIProvider: React.FC<{
  appId: string
  children: React.ReactNode
}> = ({ appId, children }) => {
  const liteHome = useUIStore((s) => s.liteHome)
  const themeId = useUIStore((s) => s.theme)
  const theme = builtinThemes[themeId]
  const bus = getAppBus()

  const api = useMemo<LiteAppAPI>(() => ({
    id: appId,
    dataDir: liteHome ? `${liteHome}/apps/${appId}/data` : '',

    bus,

    fs: {
      async readFile(path: string) {
        const res = await window.api.fs.readFile(path)
        return res.ok ? res.data : ''
      },
      async writeFile(path: string, content: string) {
        await window.api.fs.writeFile(path, content)
      },
      async readDir(path: string) {
        const res = await window.api.fs.readDir(path)
        return res.ok ? res.data : []
      },
      async delete(path: string) {
        await window.api.fs.delete(path)
      },
    },

    state: {
      async get<T>(key: string): Promise<T | undefined> {
        const res = await window.api.state.get()
        if (!res.ok) return undefined
        const appStates = (res.data as Record<string, unknown>)?.[`app:${appId}`] as Record<string, unknown> | undefined
        return appStates?.[key] as T | undefined
      },
      async set<T>(key: string, value: T): Promise<void> {
        await window.api.state.update({ [`app:${appId}`]: { [key]: value } })
      },
    },

    theme: {
      id: themeId,
      isDark: theme?.isDark ?? true,
      tokens: theme?.colors ? Object.fromEntries(Object.entries(theme.colors)) : {},
    },

    shell: {
      openExternal(url: string) {
        window.api.shell.openExternal(url)
      },
      showToast(_message: string, _type?: string) {
        // TODO: integrate with global toast system
      },
    },

    commands: {
      register(_id: string, _label: string, _action: () => void) {
        // TODO: integrate with CommandPalette
      },
      unregister(_id: string) {
        // TODO
      },
    },
  }), [appId, liteHome, themeId, theme, bus])

  return (
    <AppAPIContext.Provider value={api}>
      {children}
    </AppAPIContext.Provider>
  )
}
