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

export interface BridgedTool {
  name: string
  description: string
  parameters: Record<string, { type: string; description: string; required?: boolean; enum?: string[] }>
  appId: string
}

/** Get all Bus tools from the renderer */
export function listBusTools(): Promise<BridgedTool[]> {
  return new Promise((resolve) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) { resolve([]); return }

    const handler = (_: unknown, tools: BridgedTool[]) => {
      win.webContents.ipc.removeHandler(IpcChannels.BUS_LIST_TOOLS + ':response')
      resolve(tools || [])
    }

    // Listen for response
    win.webContents.ipc.removeHandler(IpcChannels.BUS_LIST_TOOLS + ':response')
    win.webContents.on('ipc-message', function onMsg(_ev, channel, ...args) {
      if (channel === IpcChannels.BUS_LIST_TOOLS + ':response') {
        win.webContents.removeListener('ipc-message', onMsg)
        resolve((args[0] as BridgedTool[]) || [])
      }
    })

    // Request tools from renderer
    win.webContents.send(IpcChannels.BUS_LIST_TOOLS)

    // Timeout fallback
    setTimeout(() => resolve([]), 2000)
  })
}

/** Call a Bus tool in the renderer and get the result */
export function callBusTool(name: string, params: Record<string, unknown>): Promise<unknown> {
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
