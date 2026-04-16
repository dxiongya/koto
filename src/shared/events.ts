/**
 * App Events — cross-app notifications broadcast via AppBus.
 *
 * Events flow main → renderer → AppBus. Any app can subscribe via
 * `bus.on('collector:item-ready', handler)` in its `onRegister()`.
 *
 * Events are intentionally narrow. They carry IDs + type info, not full
 * payloads — subscribers fetch data via Bus tools (e.g. `collector.getMarkdown`)
 * to avoid coupling to internal schemas.
 */

// ── Collector events ─────────────────────────────────────────────────

export type CollectorItemAdded = {
  type: 'collector:item-added'
  itemId: string
  itemType: 'link' | 'image' | 'video' | 'tweet' | 'text' | 'screenshot'
  title: string
  group: string
}

/**
 * Fired when a collector item is "ready" — meaning all its background
 * enrichment (OCR for images, markdown fetch for links, etc.) has completed
 * and downstream consumers (wiki, search, AI) can safely use its content.
 *
 * Collector owns this state. A single `item-ready` event replaces the
 * previous split of "added" + "enriched" — subscribers that just want usable
 * content should listen here.
 */
export type CollectorItemReady = {
  type: 'collector:item-ready'
  itemId: string
  itemType: 'link' | 'image' | 'video' | 'tweet' | 'text' | 'screenshot'
  /** Whether markdown was fetched (for link/tweet types) */
  hasMarkdown: boolean
  /** Whether OCR text was extracted (for image/screenshot types) */
  hasOcr: boolean
  /** Whether a description (og:description, AI summary, user note) is present */
  hasDescription: boolean
}

export type CollectorItemUpdated = {
  type: 'collector:item-updated'
  itemId: string
  /** Which fields changed (title, note, group, meta) */
  fields: string[]
}

export type CollectorItemDeleted = {
  type: 'collector:item-deleted'
  itemId: string
}

export type CollectorEvent =
  | CollectorItemAdded
  | CollectorItemReady
  | CollectorItemUpdated
  | CollectorItemDeleted

// ── Union of all app events ──────────────────────────────────────────
//
// When adding a new app-to-app event, extend this union. The event name
// should be namespaced by app id (e.g. 'notes:file-saved') so there are no
// collisions and listeners can filter by prefix.

export type AppEvent = CollectorEvent
  // | NotesEvent
  // | MemoryEvent
  // | ...

/** Lowercase event name for type-safe `bus.on()` subscriptions. */
export type AppEventName = AppEvent['type']
