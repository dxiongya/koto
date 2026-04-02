/**
 * App Registry — manages all registered apps (built-in + third-party).
 */
import type { AppDefinition, AppManifest, LiteAppAPI } from '../../../shared/app-interface'

export interface RegisteredApp {
  definition: AppDefinition
  enabled: boolean
  order: number
}

export interface AppRegistry {
  register(definition: AppDefinition): void
  unregister(id: string): void
  get(id: string): RegisteredApp | undefined
  getAll(): RegisteredApp[]
  getEnabled(): RegisteredApp[]
  setEnabled(id: string, enabled: boolean): void
  setOrder(id: string, order: number): void
  reorder(ids: string[]): void
}

export function createAppRegistry(): AppRegistry {
  const apps = new Map<string, RegisteredApp>()
  let nextOrder = 0

  return {
    register(definition: AppDefinition): void {
      apps.set(definition.manifest.id, {
        definition,
        enabled: true,
        order: nextOrder++,
      })
    },

    unregister(id: string): void {
      const app = apps.get(id)
      if (app?.definition.onUnregister) app.definition.onUnregister()
      apps.delete(id)
    },

    get(id: string): RegisteredApp | undefined {
      return apps.get(id)
    },

    getAll(): RegisteredApp[] {
      return Array.from(apps.values()).sort((a, b) => a.order - b.order)
    },

    getEnabled(): RegisteredApp[] {
      return this.getAll().filter((a) => a.enabled)
    },

    setEnabled(id: string, enabled: boolean): void {
      const app = apps.get(id)
      if (app) app.enabled = enabled
    },

    setOrder(id: string, order: number): void {
      const app = apps.get(id)
      if (app) app.order = order
    },

    reorder(ids: string[]): void {
      ids.forEach((id, i) => {
        const app = apps.get(id)
        if (app) app.order = i
      })
    },
  }
}
