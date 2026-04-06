/**
 * App Bus — inter-app communication channel.
 * Apps provide capabilities, request from others, emit/listen events.
 * Tools registered via provideTool() are auto-exposed to MCP when enabled.
 */
import type { AppBus, BusToolDefinition } from '../../../shared/app-interface'

type Handler = (params?: unknown) => unknown | Promise<unknown>
type Listener = (data?: unknown) => void

export function createAppBus(): AppBus {
  const providers = new Map<string, Handler>()
  const tools = new Map<string, BusToolDefinition>()
  const listeners = new Map<string, Set<Listener>>()

  return {
    provide(capability: string, handler: Handler): void {
      providers.set(capability, handler)
    },

    provideTool(definition): void {
      const { name, handler, ...meta } = definition
      // Register as both a tool (with metadata) and a regular capability
      tools.set(name, { ...meta, name, handler })
      providers.set(name, handler)
    },

    unprovide(capability: string): void {
      providers.delete(capability)
      tools.delete(capability)
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

    getTools(): BusToolDefinition[] {
      return Array.from(tools.values())
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
