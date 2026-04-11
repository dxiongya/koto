/**
 * Wiki App — LLM-maintained knowledge base over collector items.
 *
 * Role in the Koto ecosystem:
 *   - Collector holds raw sources (links, images, tweets, text)
 *   - Wiki reads those sources (via collector Bus tools) and maintains an
 *     interlinked markdown knowledge base at {liteHome}/wiki/
 *   - Triggered by `collector:item-enriched` events from Collector
 *   - Uses AI feature route `wiki` (user-configurable, typically a cheap model)
 *
 * This appDef subscribes to collector events and exposes Bus tools so other
 * apps (or external MCP clients) can query / manage the wiki.
 */
import type { AppDefinition } from '../../../../shared/app-interface'
import { WikiApp } from './index'
import { runIngest } from './ingest'
import { loadIngestQueue, enqueueIngest, setAutoIngest, getAutoIngest } from './ingest-queue'

export const wikiAppDefinition: AppDefinition = {
  manifest: {
    id: 'wiki.app',
    name: 'Wiki',
    icon: 'book-open',
    version: '1.0.0',
    description: 'LLM-maintained wiki — ingest from collector, organize, query, and visualize as a graph.',
    permissions: ['fs', 'state', 'ai'],
    builtin: true,
  },
  component: WikiApp,
  sidebar: {
    expandable: true,
  },
  onRegister: (api) => {
    const bus = api.bus

    // Initialize wiki directory lazily on first subscription
    let initialized = false
    const ensureInit = async (): Promise<void> => {
      if (initialized) return
      initialized = true
      try { await window.api.wiki.init() } catch { /* fs errors non-fatal */ }
    }

    // Restore queue + settings from disk
    loadIngestQueue().catch(() => {})

    // ── Subscribe to collector events ────────────────────────────────

    bus.on('collector:item-enriched', async (rawEvent: unknown) => {
      await ensureInit()
      const event = rawEvent as {
        itemId: string
        itemType: string
        hasMarkdown: boolean
        hasOcr: boolean
        hasDescription: boolean
      }
      if (!event?.itemId) return
      // Enqueue for ingest. If auto-ingest is on, runIngest fires in background.
      enqueueIngest({
        itemId: event.itemId,
        itemType: event.itemType,
        enqueuedAt: Date.now(),
      })
      if (getAutoIngest()) {
        // Fire-and-forget; ingest runs async and updates UI via store
        runIngest(event.itemId).catch((e) => {
          console.warn('[Wiki] auto ingest failed:', e)
        })
      }
    })

    bus.on('collector:item-deleted', async (rawEvent: unknown) => {
      const event = rawEvent as { itemId: string }
      if (!event?.itemId) return
      // When a collector item is deleted, its wiki source page becomes stale.
      // We don't auto-delete wiki content (could be referenced by entity pages)
      // but we log it so the user / lint can decide.
      try {
        await window.api.wiki.appendLog(
          `## [${new Date().toISOString().slice(0, 10)}] collector-deleted | item ${event.itemId} — wiki pages may be stale`,
        )
      } catch { /* non-critical */ }
    })

    // ── Bus tools: expose wiki operations to AI and other apps ───────

    bus.provideTool({
      name: 'wiki.status',
      appId: 'wiki.app',
      description: 'Get wiki overview: total pages, breakdown by type, location, last log entry.',
      parameters: {},
      handler: async () => {
        const res = await window.api.wiki.stats()
        return res.ok ? res.data : { error: res.error }
      },
    })

    bus.provideTool({
      name: 'wiki.listPages',
      appId: 'wiki.app',
      description: 'List every wiki page with its type, title, and relative path.',
      parameters: {},
      handler: async () => {
        const res = await window.api.wiki.listPages()
        return res.ok ? res.data : []
      },
    })

    bus.provideTool({
      name: 'wiki.read',
      appId: 'wiki.app',
      description: 'Read a wiki page by relative path (e.g. "entities/alice.md" or "index.md").',
      parameters: {
        path: { type: 'string', description: 'Path relative to wiki root', required: true },
      },
      handler: async (params) => {
        const res = await window.api.wiki.read(params.path as string)
        return res.ok ? { path: params.path, content: res.data } : { error: res.error }
      },
    })

    bus.provideTool({
      name: 'wiki.write',
      appId: 'wiki.app',
      description: 'Create or overwrite a wiki page. Must include YAML frontmatter per SCHEMA.md.',
      parameters: {
        path: { type: 'string', description: 'Path relative to wiki root', required: true },
        content: { type: 'string', description: 'Full markdown content including frontmatter', required: true },
      },
      handler: async (params) => {
        const res = await window.api.wiki.write(params.path as string, params.content as string)
        return res.ok ? { success: true } : { success: false, error: res.error }
      },
    })

    bus.provideTool({
      name: 'wiki.appendLog',
      appId: 'wiki.app',
      description: 'Append an entry to wiki/log.md. Format: "## [YYYY-MM-DD] action | subject" followed by bullet points.',
      parameters: {
        entry: { type: 'string', description: 'Log entry (will be appended as a new block)', required: true },
      },
      handler: async (params) => {
        const res = await window.api.wiki.appendLog(params.entry as string)
        return res.ok ? { success: true } : { success: false, error: res.error }
      },
    })

    bus.provideTool({
      name: 'wiki.ingestNow',
      appId: 'wiki.app',
      description: 'Manually trigger ingest of a collector item into the wiki. Returns list of wiki files written.',
      parameters: {
        collectorItemId: { type: 'string', description: 'Collector item ID to ingest', required: true },
      },
      handler: async (params) => {
        const result = await runIngest(params.collectorItemId as string)
        return result
      },
    })

    bus.provideTool({
      name: 'wiki.setAutoIngest',
      appId: 'wiki.app',
      description: 'Enable or disable automatic ingestion of new collector items.',
      parameters: {
        enabled: { type: 'boolean', description: 'Whether auto-ingest should run on each new enriched item', required: true },
      },
      handler: async (params) => {
        setAutoIngest(!!params.enabled)
        return { success: true, autoIngest: getAutoIngest() }
      },
    })
  },
}
