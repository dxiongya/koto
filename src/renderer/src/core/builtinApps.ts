/**
 * App Registration — registers built-in apps + discovers third-party apps.
 */
import type { AppDefinition } from '../../../shared/app-interface'
import type { AppRegistry } from './AppRegistry'

// Built-in apps — lazy loaded
const BUILTIN_APPS: Record<string, () => Promise<{ definition: AppDefinition }>> = {
  'notes.app': () => import('../apps/NotesApp/appDef').then(m => ({ definition: m.notesAppDefinition })),
  'collector.app': () => import('../apps/CollectorApp/appDef').then(m => ({ definition: m.collectorAppDefinition })),
  'code.app': () => import('../apps/CodeApp/appDef').then(m => ({ definition: m.codeAppDefinition })),
  'terminal.app': () => import('../apps/TerminalApp/appDef').then(m => ({ definition: m.terminalAppDefinition })),
}

const DEFAULT_ENABLED = ['notes.app', 'collector.app']

export async function registerBuiltinApps(registry: AppRegistry): Promise<void> {
  // 1. Register built-in apps
  for (const [id, loader] of Object.entries(BUILTIN_APPS)) {
    try {
      const { definition } = await loader()
      registry.register(definition)
      if (!DEFAULT_ENABLED.includes(id)) registry.setEnabled(id, false)
    } catch (e) {
      console.warn(`[Apps] Failed to register built-in ${id}:`, e)
    }
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
