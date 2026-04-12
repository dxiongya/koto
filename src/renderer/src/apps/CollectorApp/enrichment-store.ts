/**
 * Collector Enrichment Store — tracks background processing status
 * (OCR, markdown fetch, embedding) so the UI can show a loading indicator.
 */
import { create } from 'zustand'

export type EnrichmentStep = 'markdown' | 'ocr' | 'embedding'
export type EnrichmentStatus = 'processing' | 'done' | 'error'

export interface EnrichmentTask {
  itemId: string
  title: string
  step: EnrichmentStep
  status: EnrichmentStatus
  error?: string
  startedAt: number
}

interface EnrichmentStore {
  tasks: Map<string, EnrichmentTask>
  /** Start tracking an enrichment task. */
  start: (itemId: string, title: string, step: EnrichmentStep) => void
  /** Mark a task as done. Auto-removes after a short delay. */
  finish: (itemId: string) => void
  /** Mark a task as failed. */
  fail: (itemId: string, error: string) => void
  /** Get count of actively processing tasks. */
  activeCount: () => number
}

export const useEnrichmentStore = create<EnrichmentStore>((set, get) => ({
  tasks: new Map(),

  start: (itemId, title, step) => set((s) => {
    const next = new Map(s.tasks)
    next.set(itemId, { itemId, title, step, status: 'processing', startedAt: Date.now() })
    return { tasks: next }
  }),

  finish: (itemId) => {
    set((s) => {
      const next = new Map(s.tasks)
      const existing = next.get(itemId)
      if (existing) next.set(itemId, { ...existing, status: 'done' })
      return { tasks: next }
    })
    // Auto-remove after 3s so the indicator fades out naturally
    setTimeout(() => {
      set((s) => {
        const next = new Map(s.tasks)
        const t = next.get(itemId)
        if (t?.status === 'done') next.delete(itemId)
        return { tasks: next }
      })
    }, 3000)
  },

  fail: (itemId, error) => set((s) => {
    const next = new Map(s.tasks)
    const existing = next.get(itemId)
    if (existing) next.set(itemId, { ...existing, status: 'error', error })
    return { tasks: next }
  }),

  activeCount: () => {
    let count = 0
    for (const t of get().tasks.values()) {
      if (t.status === 'processing') count++
    }
    return count
  },
}))

/**
 * Wrap a collector enrichment call with store tracking.
 * Returns the promise result so callers can still chain.
 *
 * Handles both thrown errors AND IPC-style `{ ok: false, error }` returns —
 * the latter resolves successfully but still indicates failure.
 */
export async function trackEnrichment<T>(
  itemId: string,
  title: string,
  step: EnrichmentStep,
  fn: () => Promise<T>,
): Promise<T> {
  const store = useEnrichmentStore.getState()
  store.start(itemId, title, step)
  console.log(`[Enrichment] start: ${step} for "${title}" (${itemId})`)
  try {
    const result = await fn()
    // Check for IPC-style failure: { ok: false, error: '...' }
    if (result && typeof result === 'object' && 'ok' in result && !(result as Record<string, unknown>).ok) {
      const errMsg = String((result as Record<string, unknown>).error || 'Unknown error')
      console.warn(`[Enrichment] failed: ${step} for "${title}" — ${errMsg}`)
      store.fail(itemId, errMsg)
    } else {
      console.log(`[Enrichment] done: ${step} for "${title}"`)
      store.finish(itemId)
    }
    return result
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e)
    console.warn(`[Enrichment] error: ${step} for "${title}" — ${errMsg}`)
    store.fail(itemId, errMsg)
    throw e
  }
}
