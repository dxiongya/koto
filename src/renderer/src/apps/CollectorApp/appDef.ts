import type { AppDefinition, AppSearchResult } from '../../../../shared/app-interface'
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
    // Legacy capabilities
    api.bus.provide('resources.list', async (params: any) => {
      const res = await window.api.collector.list(params?.limit || 50, params?.offset || 0)
      return res.ok ? res.data : []
    })
    api.bus.provide('resources.add', async (params: any) => {
      const res = await window.api.collector.add(params)
      return res.ok ? res.data : null
    })

    // Standard search — returns AppSearchResult[]
    api.bus.provide('collector.search', async (params: any) => {
      const query = params?.query
      if (!query) return []
      const res = await window.api.collector.search(query)
      if (!res.ok) return []
      return res.data.slice(0, 15).map((r: any, i: number): AppSearchResult => {
        const item = r.item ?? r
        const domain = item.url ? (() => { try { return new URL(item.url).hostname.replace('www.', '') } catch { return '' } })() : ''
        return {
          id: `collector-${item.id}-${i}`,
          title: item.title || item.url || 'Untitled',
          subtitle: domain || item.group || item.type,
          snippet: (item.meta?.ocrText as string)?.slice(0, 80) || (item.meta?.description as string)?.slice(0, 80),
          score: r.score != null ? Math.round(r.score * 100) : Math.max(10, 70 - i * 3),
          source: 'collector.app',
          icon: item.type === 'link' ? 'link' : item.type === 'image' ? 'image' : item.type === 'tweet' ? 'twitter' : 'archive',
          action: item.url
            ? { type: 'open-url', url: item.url }
            : { type: 'navigate', app: 'collector.app' },
        }
      })
    })
  },
}
