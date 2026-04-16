/**
 * Main-process event bus — broadcasts app events to all renderer windows
 * via IPC. The renderer side (preload) bridges them into AppBus so any
 * app subscribed via `bus.on(eventName, ...)` receives them.
 */
import { BrowserWindow } from 'electron'
import { IpcChannels } from '../../shared/types'
import type { AppEvent } from '../../shared/events'
import type { CollectedItem } from '../../shared/types'

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

/**
 * Type-aware readiness rules for a CollectedItem.
 *
 * An item is "ready" once every enrichment step its type requires has
 * completed. This is the SINGLE authoritative place for that decision —
 * do not duplicate these rules in consumers; they should listen for the
 * `collector:item-ready` event instead.
 */
export function isCollectorItemReady(item: CollectedItem): boolean {
  const meta = (item.meta || {}) as Record<string, unknown>
  switch (item.type) {
    case 'link':
    case 'tweet':
      // Ready once extracted markdown is available OR we've decided there
      // won't be any (meta.markdownFetched flag or meta.markdownSkipped).
      return !!meta.hasMarkdown || !!meta.markdownFetched
    case 'image':
    case 'screenshot':
      // Ready once OCR + visual description has run.
      return !!meta.ocrText || !!meta.imageDescription
    case 'video':
      // Video enrichment is not yet implemented — ready on add.
      return true
    case 'text':
      // Plain text is ready as soon as it has content.
      return !!(item.note && item.note.trim().length > 0)
    default:
      return true
  }
}

/**
 * Emit `collector:item-ready` — but only if the item's readiness rule passes.
 * Safe to call at any enrichment-completion point; if the item still has
 * pending work the call is a no-op.
 */
export function emitItemReadyIfReady(item: CollectedItem): void {
  if (!isCollectorItemReady(item)) {
    console.log(`[EventBus] item ${item.id} (${item.type}) not ready yet — skipping item-ready`)
    return
  }
  const meta = (item.meta || {}) as Record<string, unknown>
  console.log(`[EventBus] item ${item.id} (${item.type}) is ready — emitting collector:item-ready`)
  emitAppEvent({
    type: 'collector:item-ready',
    itemId: item.id,
    itemType: item.type,
    hasMarkdown: !!meta.hasMarkdown || !!meta.markdownFetched,
    hasOcr: !!meta.ocrText,
    hasDescription: !!meta.description || !!meta.imageDescription || !!(item.note && item.note.trim()),
  })
}
