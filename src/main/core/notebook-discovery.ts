/**
 * Web discovery — searches the web and turns the results into Koto Collector
 * items that can then be wired in as notebook sources.
 *
 *   discoverWeb(query)    → up to N {title, url, snippet} candidates
 *   importUrlToSession()  → Collector item registered as a source
 *
 * Both paths go through Jina (s.jina.ai for search, r.jina.ai for content),
 * which matches Collector's existing fetcher and needs zero configuration.
 *
 * Each session lazily owns a Collector group named after the session — so
 * "delete session" also deletes its imported web sources by group, without
 * touching anything the user added by hand.
 */
import {
  addCollectorGroup,
  addCollectedItem,
  fetchAndSaveMarkdown,
  getCollectorGroups,
  findDuplicateByUrl,
} from './collector-store'
import { getSession, saveSession, registerSource } from './notebook-storage'
import { processSource } from './notebook-source-pipeline'

export interface DiscoveryResult {
  title: string
  url: string
  snippet?: string
}

const SEARCH_ENDPOINT = 'https://s.jina.ai/'

/** Issue a web search via Jina and return up to `limit` candidates. */
export async function discoverWeb(query: string, limit = 10): Promise<{ ok: true; data: DiscoveryResult[] } | { ok: false; error: string }> {
  const q = query.trim()
  if (!q) return { ok: false, error: 'empty query' }

  try {
    const res = await fetch(SEARCH_ENDPOINT, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Respond-With': 'no-content',
      },
      body: JSON.stringify({ q }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      return { ok: false, error: `Jina returned ${res.status}` }
    }
    const json = (await res.json()) as { data?: Array<{ title?: string; url?: string; description?: string; content?: string }> }
    const out: DiscoveryResult[] = []
    for (const item of json.data ?? []) {
      if (!item.url) continue
      out.push({
        title: item.title?.trim() || item.url,
        url: item.url,
        snippet: (item.description || item.content || '').slice(0, 280),
      })
      if (out.length >= limit) break
    }
    return { ok: true, data: out }
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e) }
  }
}

/** Lazily ensure the session has its own Collector group; returns the group name. */
function ensureSessionGroup(sessionId: string): string {
  const s = getSession(sessionId)
  if (!s) throw new Error(`session not found: ${sessionId}`)
  if (s.collectorGroup) {
    // Re-create group entry on disk if it was cleared elsewhere.
    const groups = getCollectorGroups()
    if (!groups.includes(s.collectorGroup)) {
      addCollectorGroup(s.collectorGroup)
    }
    return s.collectorGroup
  }
  // Group name = "<session name> · <short id>". Stays human-readable but
  // keeps uniqueness for sessions with the same name.
  const groupName = `${s.name} · ${s.id.slice(0, 6)}`
  addCollectorGroup(groupName)
  saveSession({ ...s, collectorGroup: groupName })
  return groupName
}

/** Import a URL: fetch markdown via Jina Reader, add to the session's
 *  Collector group, register as a notebook source, and kick off processing. */
export async function importUrlToSession(sessionId: string, url: string, title?: string): Promise<{ ok: true; data: { itemId: string; sourceKey: string } } | { ok: false; error: string }> {
  try {
    const groupName = ensureSessionGroup(sessionId)

    // Avoid duplicate adds for the same URL within the session.
    const existing = findDuplicateByUrl(url)
    if (existing && existing.group === groupName) {
      const meta = registerSource(sessionId, { kind: 'collector', itemId: existing.id }, title || existing.title || url, url)
      if (meta) void processSource(sessionId, meta.key)
      return meta ? { ok: true, data: { itemId: existing.id, sourceKey: meta.key } } : { ok: false, error: 'failed to register' }
    }

    const item = addCollectedItem({
      type: 'link',
      title: title || url,
      url,
      group: groupName,
      source: 'notebook-discovery',
    })

    // Fetch markdown in the background — we still want to register the
    // source immediately so the UI shows a "fetching" row. The pipeline
    // calls collector's markdown reader, which will pick up the file
    // once `fetchAndSaveMarkdown` writes it.
    void fetchAndSaveMarkdown(item.id, url).catch((e) => {
      console.error('[NotebookDiscovery] fetch failed:', url, e)
    })

    const meta = registerSource(sessionId, { kind: 'collector', itemId: item.id }, title || item.title || url, url)
    if (!meta) return { ok: false, error: 'failed to register source' }
    void processSource(sessionId, meta.key)

    return { ok: true, data: { itemId: item.id, sourceKey: meta.key } }
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e) }
  }
}
