/**
 * App Registration — registers built-in apps + discovers third-party apps.
 */
import type { AppBus, AppDefinition, LiteAppAPI } from '../../../shared/app-interface'
import type { AppRegistry } from './AppRegistry'
import { getAppBus } from './AppContext'

// Built-in apps — lazy loaded
const BUILTIN_APPS: Record<string, () => Promise<{ definition: AppDefinition }>> = {
  'notes.app': () => import('../apps/NotesApp/appDef').then(m => ({ definition: m.notesAppDefinition })),
  'collector.app': () => import('../apps/CollectorApp/appDef').then(m => ({ definition: m.collectorAppDefinition })),
  'wiki.app': () => import('../apps/WikiApp/appDef').then(m => ({ definition: m.wikiAppDefinition })),
  'code.app': () => import('../apps/CodeApp/appDef').then(m => ({ definition: m.codeAppDefinition })),
  'terminal.app': () => import('../apps/TerminalApp/appDef').then(m => ({ definition: m.terminalAppDefinition })),
  'memory.app': () => import('../apps/MemoryApp/appDef').then(m => ({ definition: m.memoryAppDefinition })),
}

export const DEFAULT_ENABLED = ['notes.app', 'collector.app', 'wiki.app']

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

  // ── System-level Bus tools (not app-specific) ──
  registerSystemTools(bus)

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

/** Register system-level Bus tools (task scheduler) */
function registerSystemTools(bus: AppBus): void {
  bus.provideTool({
    name: 'task.list',
    appId: 'system',
    description: 'List all scheduled tasks. Can filter by appId.',
    parameters: {
      appId: { type: 'string', description: 'Filter by app ID (e.g. "notes.app", "collector.app")' },
    },
    handler: async (params) => {
      const res = await window.api.task.list(params.appId as string | undefined)
      return res.ok ? res.data : []
    },
  })

  bus.provideTool({
    name: 'task.create',
    appId: 'system',
    description: 'Create a new scheduled task. Types: ai-prompt, script, shell, mcp-tool.',
    parameters: {
      name: { type: 'string', description: 'Task name', required: true },
      type: { type: 'string', description: 'Task type', required: true, enum: ['ai-prompt', 'script', 'shell', 'mcp-tool'] },
      schedule: { type: 'string', description: 'Schedule: "manual", "hourly", "daily", "weekly", or "interval:N" (minutes)' },
      config: { type: 'string', description: 'JSON config string (type-specific). shell: {"command":"..."}, mcp-tool: {"toolName":"...","toolParams":{...}}', required: true },
      appId: { type: 'string', description: 'Associated app ID (optional)' },
    },
    handler: async (params) => {
      let config: Record<string, unknown> = {}
      try { config = JSON.parse(params.config as string) } catch { /* ignore */ }
      const res = await window.api.task.create({
        name: params.name as string,
        type: params.type as string,
        schedule: (params.schedule as string) || 'manual',
        config,
        appId: (params.appId as string) || null,
      })
      return res.ok ? res.data : { error: res.error }
    },
  })

  bus.provideTool({
    name: 'task.update',
    appId: 'system',
    description: 'Update a scheduled task (name, enabled, schedule, config).',
    parameters: {
      id: { type: 'string', description: 'Task ID', required: true },
      name: { type: 'string', description: 'New name' },
      enabled: { type: 'boolean', description: 'Enable/disable' },
      schedule: { type: 'string', description: 'New schedule' },
      config: { type: 'string', description: 'JSON config string to replace' },
    },
    handler: async (params) => {
      const patch: Record<string, unknown> = {}
      if (params.name !== undefined) patch.name = params.name
      if (params.enabled !== undefined) patch.enabled = params.enabled
      if (params.schedule !== undefined) patch.schedule = params.schedule
      if (params.config !== undefined) {
        try { patch.config = JSON.parse(params.config as string) } catch { /* ignore */ }
      }
      const res = await window.api.task.update(params.id as string, patch)
      return res.ok ? res.data : { error: res.error }
    },
  })

  bus.provideTool({
    name: 'task.delete',
    appId: 'system',
    description: 'Delete a scheduled task by ID.',
    parameters: {
      id: { type: 'string', description: 'Task ID', required: true },
    },
    handler: async (params) => {
      const res = await window.api.task.delete(params.id as string)
      return res.ok ? { success: true } : { error: res.error }
    },
  })

  bus.provideTool({
    name: 'task.trigger',
    appId: 'system',
    description: 'Manually trigger (run now) a scheduled task by ID.',
    parameters: {
      id: { type: 'string', description: 'Task ID', required: true },
    },
    handler: async (params) => {
      const res = await window.api.task.trigger(params.id as string)
      return res.ok ? res.data : { error: res.error }
    },
  })
}
