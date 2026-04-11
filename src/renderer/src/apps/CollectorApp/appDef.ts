import type { AppDefinition } from '../../../../shared/app-interface'
import { CollectorApp } from './index'

export const collectorAppDefinition: AppDefinition = {
  manifest: {
    id: 'collector.app',
    name: 'Collector',
    icon: 'archive',
    version: '1.0.0',
    description: 'Collect links, images, tweets — search with AI',
    permissions: ['fs', 'state', 'network', 'ai'],
    builtin: true,
  },
  component: CollectorApp,
  sidebar: {
    expandable: true,
  },
  onRegister: (api) => {
    // ── Legacy capabilities ──
    api.bus.provide('resources.list', async (params: any) => {
      const res = await window.api.collector.list(params?.limit || 50, params?.offset || 0)
      return res.ok ? res.data : []
    })
    api.bus.provide('resources.add', async (params: any) => {
      const res = await window.api.collector.add(params)
      return res.ok ? res.data : null
    })

    // ── MCP-ready tools ──

    api.bus.provideTool({
      name: 'collector.search',
      appId: 'collector.app',
      description: 'Search collected resources (links, images, text, tweets) by keyword. Uses full-text and semantic search.',
      parameters: {
        query: { type: 'string', description: 'Search query', required: true },
      },
      handler: async (params) => {
        const query = params.query as string
        if (!query) return []
        const res = await window.api.collector.search(query)
        if (!res.ok) return []

        // Build a snippet centered around the first matching token.
        // Falls back to the note start if no token matches in the note.
        const tokens = query
          .toLowerCase()
          .split(/\s+/)
          .map((t) => t.replace(/[^\p{L}\p{N}]+/gu, ''))
          .filter((t) => t.length >= 2)

        const buildSnippet = (text: string): string => {
          if (!text) return ''
          const lower = text.toLowerCase()
          let firstIdx = -1
          for (const t of tokens) {
            const idx = lower.indexOf(t)
            if (idx !== -1 && (firstIdx === -1 || idx < firstIdx)) firstIdx = idx
          }
          if (firstIdx === -1) return text.slice(0, 200)
          // Context window: ~80 chars before, ~120 after
          const start = Math.max(0, firstIdx - 80)
          const end = Math.min(text.length, firstIdx + 120)
          const prefix = start > 0 ? '…' : ''
          const suffix = end < text.length ? '…' : ''
          return prefix + text.slice(start, end).trim() + suffix
        }

        return res.data.slice(0, 15).map((r: any, i: number) => {
          const item = r.item ?? r
          const title = item.title || item.url || item.note?.slice(0, 80) || 'Untitled'
          const note = (item.note || '').trim()
          return {
            id: item.id,
            title,
            subtitle: item.url || item.group || '',
            snippet: note && note !== title ? buildSnippet(note) : '',
            score: typeof r.score === 'number' ? r.score : 100 - i,
            source: 'collector.app',
            icon: item.type === 'link' ? 'link' : item.type === 'image' ? 'image' : 'archive',
            action: item.url
              ? { type: 'open-url', url: item.url }
              : { type: 'navigate', app: 'collector.app', state: { collectorActiveItemId: item.id } },
            // MCP-only fields (extra, ignored by palette):
            type: item.type,
            url: item.url,
            group: item.group,
          }
        })
      },
    })

    api.bus.provideTool({
      name: 'collector.list',
      appId: 'collector.app',
      description: 'List collected resources with pagination.',
      parameters: {
        limit: { type: 'number', description: 'Max items to return (default 20)' },
        offset: { type: 'number', description: 'Skip first N items (default 0)' },
        group: { type: 'string', description: 'Filter by group name (optional)' },
      },
      handler: async (params) => {
        const limit = (params.limit as number) || 20
        const offset = (params.offset as number) || 0
        const res = await window.api.collector.list(limit, offset)
        if (!res.ok) return []
        let items = res.data
        if (params.group) {
          items = items.filter((i: any) => i.group === params.group)
        }
        return items.map((i: any) => ({
          id: i.id, type: i.type, title: i.title, url: i.url, group: i.group,
          createdAt: i.createdAt,
        }))
      },
    })

    api.bus.provideTool({
      name: 'collector.getMarkdown',
      appId: 'collector.app',
      description: 'Get the extracted markdown content for a collected link.',
      parameters: {
        id: { type: 'string', description: 'Collector item ID', required: true },
      },
      handler: async (params) => {
        const id = params.id as string
        const res = await window.api.collector.getMarkdown(id)
        return { id, markdown: res.ok ? res.data : null }
      },
    })

    api.bus.provideTool({
      name: 'collector.add',
      appId: 'collector.app',
      description: 'Add a new resource to the collector (link, text, etc.).',
      parameters: {
        type: { type: 'string', description: 'Resource type', required: true, enum: ['link', 'text', 'image'] },
        title: { type: 'string', description: 'Title of the resource', required: true },
        url: { type: 'string', description: 'URL (for link type)' },
        note: { type: 'string', description: 'Note or text content' },
        group: { type: 'string', description: 'Group to add to (default: all)' },
      },
      handler: async (params) => {
        const res = await window.api.collector.add(params as any)
        return res.ok ? { id: res.data?.id, success: true } : { success: false, error: res.error }
      },
    })

    api.bus.provideTool({
      name: 'collector.groups',
      appId: 'collector.app',
      description: 'List all collector groups.',
      parameters: {},
      handler: async () => {
        const res = await window.api.collector.groups()
        return res.ok ? res.data : []
      },
    })

    api.bus.provideTool({
      name: 'collector.addGroup',
      appId: 'collector.app',
      description: 'Create a new collector group.',
      parameters: {
        name: { type: 'string', description: 'Group name', required: true },
      },
      handler: async (params) => {
        const res = await window.api.collector.addGroup(params.name as string)
        return res.ok ? { groups: res.data, success: true } : { success: false, error: res.error }
      },
    })

    api.bus.provideTool({
      name: 'collector.update',
      appId: 'collector.app',
      description: 'Update an existing collector item (partial update).',
      parameters: {
        id: { type: 'string', description: 'Item ID', required: true },
        title: { type: 'string', description: 'New title' },
        note: { type: 'string', description: 'New note' },
        group: { type: 'string', description: 'New group' },
        meta: { type: 'string', description: 'JSON string of metadata to merge' },
      },
      handler: async (params) => {
        const { id, meta: metaStr, ...patch } = params as any
        if (metaStr) {
          try { (patch as any).meta = JSON.parse(metaStr) } catch {}
        }
        const res = await window.api.collector.update(id, patch)
        return res.ok ? { success: true } : { success: false, error: res.error }
      },
    })

    api.bus.provideTool({
      name: 'collector.renameGroup',
      appId: 'collector.app',
      description: 'Rename a collector group.',
      parameters: {
        oldName: { type: 'string', description: 'Current group name', required: true },
        newName: { type: 'string', description: 'New group name', required: true },
      },
      handler: async (params) => {
        const res = await window.api.collector.renameGroup(params.oldName as string, params.newName as string)
        return res.ok ? { groups: res.data, success: true } : { success: false, error: res.error }
      },
    })

    api.bus.provideTool({
      name: 'collector.syncGroup',
      appId: 'collector.app',
      description: 'Trigger a sync for a collector group that has a sync script configured.',
      parameters: {
        group: { type: 'string', description: 'Group name to sync', required: true },
      },
      handler: async (params) => {
        const res = await window.api.collector.sync.runNow(params.group as string)
        return res.ok ? res.data : { error: res.error }
      },
    })
  },
}
