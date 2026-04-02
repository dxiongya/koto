/**
 * Built-in App Registration — registers notes.app and collector.app by default.
 * Other built-in apps (code, terminal, browser) are available but not enabled by default.
 */
import type { AppDefinition } from '../../../shared/app-interface'
import type { AppRegistry } from './AppRegistry'

// Lazy imports — apps loaded only when needed
const lazyApps: Record<string, () => Promise<{ definition: AppDefinition }>> = {
  'notes.app': () => import('../apps/NotesApp/appDef').then(m => ({ definition: m.notesAppDefinition })),
  'collector.app': () => import('../apps/CollectorApp/appDef').then(m => ({ definition: m.collectorAppDefinition })),
  'code.app': () => import('../apps/CodeApp/appDef').then(m => ({ definition: m.codeAppDefinition })),
  'terminal.app': () => import('../apps/TerminalApp/appDef').then(m => ({ definition: m.terminalAppDefinition })),
}

// Default enabled apps
const DEFAULT_ENABLED = ['notes.app', 'collector.app']

export async function registerBuiltinApps(registry: AppRegistry): Promise<void> {
  // Register all built-in apps
  for (const [id, loader] of Object.entries(lazyApps)) {
    try {
      const { definition } = await loader()
      registry.register(definition)
      // Disable non-default apps
      if (!DEFAULT_ENABLED.includes(id)) {
        registry.setEnabled(id, false)
      }
    } catch (e) {
      console.warn(`[Apps] Failed to register ${id}:`, e)
    }
  }
}
