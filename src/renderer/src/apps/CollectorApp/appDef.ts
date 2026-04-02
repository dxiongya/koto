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
  component: CollectorApp as React.FC<{ api: any }>,
  sidebar: {
    expandable: true,
  },
  onRegister: (api) => {
    api.bus.provide('search', async (params: any) => {
      const res = await window.api.collector.search(params?.query || '')
      return res.ok ? res.data : []
    })
    api.bus.provide('resources.list', async (params: any) => {
      const res = await window.api.collector.list(params?.limit || 50, params?.offset || 0)
      return res.ok ? res.data : []
    })
    api.bus.provide('resources.add', async (params: any) => {
      const res = await window.api.collector.add(params)
      return res.ok ? res.data : null
    })
  },
}
