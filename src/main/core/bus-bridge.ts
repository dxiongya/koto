/**
 * Bus Bridge — Main process access to renderer-side Bus tools.
 *
 * The Bus lives in the renderer. This bridge uses IPC to:
 * 1. List available Bus tools (name, description, parameters)
 * 2. Call a specific tool and get the result
 *
 * Used by the AI tools system and the MCP server to expose
 * app-provided capabilities to AI.
 */
import { BrowserWindow } from 'electron'
import { IpcChannels } from '../../shared/types'
import { loadConfig } from './lite-home'

export interface BridgedTool {
  name: string
  description: string
  parameters: Record<string, { type: string; description: string; required?: boolean; enum?: string[] }>
  appId: string
}

// Default enabled set mirrors `DEFAULT_ENABLED` in `builtinApps.ts`. Used when
// no explicit enabledApps list exists in config (fresh install).
const DEFAULT_ENABLED_APPS = new Set(['notes.app', 'collector.app'])

/**
 * Build the filter predicate for a BridgedTool based on current config:
 *   - system / no-appId tools → always allowed
 *   - tools from enabled apps → allowed
 *   - tools from disabled apps → rejected
 *   - individual tools the user disabled in Settings → rejected
 */
function buildToolFilter(): (t: BridgedTool) => boolean {
  let enabled = DEFAULT_ENABLED_APPS
  let disabledTools = new Set<string>()
  try {
    const cfg = loadConfig()
    if (cfg.enabledApps?.length) enabled = new Set(cfg.enabledApps)
    if (cfg.disabledBusTools?.length) disabledTools = new Set(cfg.disabledBusTools)
  } catch { /* fall back to defaults */ }

  return (t: BridgedTool) => {
    if (disabledTools.has(t.name)) return false
    if (!t.appId || t.appId === 'system') return true
    return enabled.has(t.appId)
  }
}

/** Get all Bus tools from the renderer (filtered to enabled apps + non-disabled tools) */
export function listBusTools(): Promise<BridgedTool[]> {
  return new Promise((resolve) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) { resolve([]); return }

    const filter = buildToolFilter()
    const applyFilter = (tools: BridgedTool[]): BridgedTool[] => (tools || []).filter(filter)

    // Listen for response
    win.webContents.ipc.removeHandler(IpcChannels.BUS_LIST_TOOLS + ':response')
    win.webContents.on('ipc-message', function onMsg(_ev, channel, ...args) {
      if (channel === IpcChannels.BUS_LIST_TOOLS + ':response') {
        win.webContents.removeListener('ipc-message', onMsg)
        resolve(applyFilter(args[0] as BridgedTool[]))
      }
    })

    // Request tools from renderer
    win.webContents.send(IpcChannels.BUS_LIST_TOOLS)

    // Timeout fallback
    setTimeout(() => resolve([]), 2000)
  })
}

/** Call a Bus tool in the renderer and get the result */
export async function callBusTool(name: string, params: Record<string, unknown>): Promise<unknown> {
  // Guard: reject calls to tools from disabled apps or individually disabled tools.
  // This mirrors the filtering in listBusTools() so external MCP clients can't
  // invoke tools they shouldn't see.
  const allTools = await rawListBusTools()
  const filter = buildToolFilter()
  const target = allTools.find((t) => t.name === name)
  if (target && !filter(target)) {
    throw new Error(`Tool "${name}" is not available (its app is disabled or the tool is turned off)`)
  }

  return new Promise((resolve, reject) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) { reject(new Error('No window')); return }

    const requestId = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

    const onMsg = (_ev: unknown, channel: string, ...args: unknown[]) => {
      if (channel === IpcChannels.BUS_CALL_TOOL + ':response' && args[0] === requestId) {
        win.webContents.removeListener('ipc-message', onMsg as any)
        const result = args[1] as { ok: boolean; data?: unknown; error?: string }
        if (result.ok) resolve(result.data)
        else reject(new Error(result.error || 'Bus tool call failed'))
      }
    }

    win.webContents.on('ipc-message', onMsg as any)
    win.webContents.send(IpcChannels.BUS_CALL_TOOL, name, params, requestId)

    // Timeout
    setTimeout(() => {
      win.webContents.removeListener('ipc-message', onMsg as any)
      reject(new Error(`Bus tool "${name}" timed out`))
    }, 10000)
  })
}

/** Internal: get the unfiltered tool list (used by callBusTool's guard). */
function rawListBusTools(): Promise<BridgedTool[]> {
  return new Promise((resolve) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) { resolve([]); return }

    win.webContents.ipc.removeHandler(IpcChannels.BUS_LIST_TOOLS + ':response')
    win.webContents.on('ipc-message', function onMsg(_ev, channel, ...args) {
      if (channel === IpcChannels.BUS_LIST_TOOLS + ':response') {
        win.webContents.removeListener('ipc-message', onMsg)
        resolve((args[0] as BridgedTool[]) || [])
      }
    })

    win.webContents.send(IpcChannels.BUS_LIST_TOOLS)
    setTimeout(() => resolve([]), 2000)
  })
}
