/**
 * App Bus — inter-app communication channel.
 * Apps provide capabilities, request from others, emit/listen events.
 */
import type { AppBus } from '../../../shared/app-interface'

type Handler = (params?: unknown) => unknown | Promise<unknown>
type Listener = (data?: unknown) => void

export function createAppBus(): AppBus {
  const providers = new Map<string, Handler>()
  const listeners = new Map<string, Set<Listener>>()

  return {
    provide(capability: string, handler: Handler): void {
      providers.set(capability, handler)
    },

    unprovide(capability: string): void {
      providers.delete(capability)
    },

    async request<T = unknown>(capability: string, params?: unknown): Promise<T | null> {
      const handler = providers.get(capability)
      if (!handler) return null
      try {
        const result = await handler(params)
        return result as T
      } catch (e) {
        console.warn(`[Bus] capability "${capability}" failed:`, e)
        return null
      }
    },

    has(capability: string): boolean {
      return providers.has(capability)
    },

    emit(event: string, data?: unknown): void {
      const subs = listeners.get(event)
      if (!subs) return
      for (const cb of subs) {
        try { cb(data) } catch (e) { console.warn(`[Bus] event "${event}" listener error:`, e) }
      }
    },

    on(event: string, callback: Listener): () => void {
      let subs = listeners.get(event)
      if (!subs) { subs = new Set(); listeners.set(event, subs) }
      subs.add(callback)
      return () => { subs!.delete(callback) }
    },
  }
}
