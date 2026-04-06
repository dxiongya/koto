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
        return res.data.slice(0, 15).map((r: any) => {
          const item = r.item ?? r
          return {
            id: item.id,
            type: item.type,
            title: item.title || item.url || 'Untitled',
            url: item.url,
            group: item.group,
            score: r.score,
            source: r.source,
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
  },
}
