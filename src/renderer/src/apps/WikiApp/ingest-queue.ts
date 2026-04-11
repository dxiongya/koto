/**
 * Wiki Ingest Queue — pending items waiting to be turned into wiki pages.
 *
 * Queue state lives in renderer memory + mirrored to Zustand for UI.
 * Auto-ingest preference persists via config.wikiAutoIngest.
 */
import { create } from 'zustand'

export interface QueuedIngest {
  itemId: string
  itemType: string
  enqueuedAt: number
  status: 'pending' | 'running' | 'done' | 'error'
  error?: string
  /** Wiki pages written from this ingest (populated when status='done'). */
  filesWritten?: string[]
}

interface WikiIngestStore {
  queue: QueuedIngest[]
  autoIngest: boolean
  enqueue: (item: Omit<QueuedIngest, 'status'>) => void
  updateStatus: (itemId: string, patch: Partial<QueuedIngest>) => void
  remove: (itemId: string) => void
  clearDone: () => void
  setAutoIngest: (enabled: boolean) => void
  hydrate: (queue: QueuedIngest[], autoIngest: boolean) => void
}

export const useWikiIngestStore = create<WikiIngestStore>((set) => ({
  queue: [],
  autoIngest: true, // default ON per user request
  enqueue: (item) => set((s) => {
    if (s.queue.some((q) => q.itemId === item.itemId && q.status === 'pending')) return s
    return { queue: [...s.queue, { ...item, status: 'pending' }] }
  }),
  updateStatus: (itemId, patch) => set((s) => ({
    queue: s.queue.map((q) => (q.itemId === itemId ? { ...q, ...patch } : q)),
  })),
  remove: (itemId) => set((s) => ({ queue: s.queue.filter((q) => q.itemId !== itemId) })),
  clearDone: () => set((s) => ({ queue: s.queue.filter((q) => q.status !== 'done') })),
  setAutoIngest: (enabled) => set({ autoIngest: enabled }),
  hydrate: (queue, autoIngest) => set({ queue, autoIngest }),
}))

// ── External API (called from appDef.onRegister) ────────────────────

export function enqueueIngest(item: { itemId: string; itemType: string; enqueuedAt: number }): void {
  useWikiIngestStore.getState().enqueue(item)
}

export function getAutoIngest(): boolean {
  return useWikiIngestStore.getState().autoIngest
}

export function setAutoIngest(enabled: boolean): void {
  useWikiIngestStore.getState().setAutoIngest(enabled)
  // Persist to config
  window.api.state.update({ wikiAutoIngest: enabled }).catch(() => {})
}

/** Hydrate from persisted config on startup. */
export async function loadIngestQueue(): Promise<void> {
  try {
    const res = await window.api.state.get()
    if (res.ok && res.data) {
      const autoIngest = typeof res.data.wikiAutoIngest === 'boolean' ? res.data.wikiAutoIngest : true
      useWikiIngestStore.getState().hydrate([], autoIngest)
    }
  } catch { /* ignore */ }
}
