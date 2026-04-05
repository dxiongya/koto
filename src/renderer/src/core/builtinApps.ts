/**
 * App Registration — registers built-in apps + discovers third-party apps.
 */
import type { AppDefinition, LiteAppAPI } from '../../../shared/app-interface'
import type { AppRegistry } from './AppRegistry'
import { getAppBus } from './AppContext'

// Built-in apps — lazy loaded
const BUILTIN_APPS: Record<string, () => Promise<{ definition: AppDefinition }>> = {
  'notes.app': () => import('../apps/NotesApp/appDef').then(m => ({ definition: m.notesAppDefinition })),
  'collector.app': () => import('../apps/CollectorApp/appDef').then(m => ({ definition: m.collectorAppDefinition })),
  'code.app': () => import('../apps/CodeApp/appDef').then(m => ({ definition: m.codeAppDefinition })),
  'terminal.app': () => import('../apps/TerminalApp/appDef').then(m => ({ definition: m.terminalAppDefinition })),
}

const DEFAULT_ENABLED = ['notes.app', 'collector.app']

export async function registerBuiltinApps(registry: AppRegistry): Promise<void> {
  // Load persisted enabled/order state
  let savedEnabledApps: string[] | undefined
  let savedAppOrder: string[] | undefined
  try {
    const configRes = await window.api.state.get()
    if (configRes.ok) {
      savedEnabledApps = configRes.data.enabledApps as string[] | undefined
      savedAppOrder = configRes.data.appOrder as string[] | undefined
    }
  } catch { /* ignore */ }

  const enabledSet = savedEnabledApps
    ? new Set(savedEnabledApps)
    : new Set(DEFAULT_ENABLED)

  // 1. Register built-in apps + call onRegister to set up Bus providers
  const bus = getAppBus()
  for (const [id, loader] of Object.entries(BUILTIN_APPS)) {
    try {
      const { definition } = await loader()
      registry.register(definition)
      if (!enabledSet.has(id)) registry.setEnabled(id, false)

      // Call onRegister with a minimal API so apps can register Bus capabilities
      if (definition.onRegister) {
        let liteHome = ''
        try { const r = await window.api.lite.getHome(); if (r.ok) liteHome = r.data } catch {}
        const api: LiteAppAPI = {
          id,
          dataDir: liteHome ? `${liteHome}/apps/${id}/data` : '',
          bus,
          fs: {
            readFile: async (p) => { const r = await window.api.fs.readFile(p); return r.ok ? r.data : '' },
            writeFile: async (p, c) => { await window.api.fs.writeFile(p, c) },
            readDir: async (p) => { const r = await window.api.fs.readDir(p); return r.ok ? r.data : [] },
          },
          state: { get: async () => null, set: async () => {} },
          theme: { current: 'dark', isDark: true },
          shell: { exec: async () => '' },
          commands: { register: () => () => {} },
        }
        definition.onRegister(api)
      }
    } catch (e) {
      console.warn(`[Apps] Failed to register built-in ${id}:`, e)
    }
  }

  // Restore order if saved
  if (savedAppOrder?.length) {
    registry.reorder(savedAppOrder)
  }

  // 2. Discover third-party apps from {liteHome}/apps/
  try {
    const res = await window.api.apps.discover()
    if (res.ok && res.data) {
      for (const manifest of res.data) {
        try {
          // Dynamic import via lite-app:// protocol
          const entry = manifest.entry || 'index.js'
          const moduleUrl = `lite-app://${manifest.id}/${entry}`
          const mod = await import(/* @vite-ignore */ moduleUrl)

          const definition: AppDefinition = {
            manifest: {
              id: manifest.id,
              name: manifest.name,
              icon: manifest.icon || 'box',
              version: manifest.version || '0.0.1',
              description: manifest.description || '',
              permissions: manifest.permissions || [],
              builtin: false,
            },
            component: mod.default?.component || mod.component || mod.default,
            sidebar: mod.default?.sidebar || mod.sidebar,
            onRegister: mod.default?.onRegister || mod.onRegister,
          }

          registry.register(definition)
          console.log(`[Apps] Loaded third-party: ${manifest.name} (${manifest.id})`)
        } catch (e) {
          console.warn(`[Apps] Failed to load ${manifest.id}:`, e)
        }
      }
    }
  } catch (e) {
    console.warn('[Apps] Failed to discover third-party apps:', e)
  }
}
