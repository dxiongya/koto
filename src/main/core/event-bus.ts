/**
 * Main-process event bus — broadcasts app events to all renderer windows
 * via IPC. The renderer side (preload) bridges them into AppBus so any
 * app subscribed via `bus.on(eventName, ...)` receives them.
 *
 * Usage from main-process modules:
 *   import { emitAppEvent } from './event-bus'
 *   emitAppEvent({
 *     type: 'collector:item-enriched',
 *     itemId: 'abc',
 *     itemType: 'link',
 *     hasMarkdown: true,
 *     hasOcr: false,
 *     hasDescription: true,
 *   })
 */
import { BrowserWindow } from 'electron'
import { IpcChannels } from '../../shared/types'
import type { AppEvent } from '../../shared/events'

/** Broadcast an event to all renderer windows. */
export function emitAppEvent(event: AppEvent): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    if (win.isDestroyed()) continue
    try {
      win.webContents.send(IpcChannels.APP_EVENT, event)
    } catch (e) {
      console.warn('[EventBus] Failed to send event to window:', e)
    }
  }
}
