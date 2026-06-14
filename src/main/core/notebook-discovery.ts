/**
 * Web discovery — searches the web (via xapi.to's `web.search` capability)
 * and turns selected results into Koto Collector items that can then be
 * wired in as notebook sources. Content fetching for individual URLs still
 * goes through Jina Reader inside Collector, which is unauthed.
 *
 *   discoverWeb(query)    → up to N {title, url, snippet} candidates (xapi)
 *   importUrlToSession()  → Collector item registered as a source
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
import { loadConfig } from './lite-home'

export interface DiscoveryResult {
  title: string
  url: string
  snippet?: string
}

const XAPI_EXECUTE_URL = 'https://action.xapi.to/v1/actions/execute'

/** Issue a web search via xapi's `web.search` capability and return up to
 *  `limit` candidates. Requires `xapiApiKey` in LiteConfig — without it we
 *  return a clear error so the UI can point the user at Settings. */
export async function discoverWeb(query: string, limit = 10): Promise<{ ok: true; data: DiscoveryResult[] } | { ok: false; error: string }> {
  const q = query.trim()
  if (!q) return { ok: false, error: 'empty query' }

  const apiKey = loadConfig().xapiApiKey?.trim()
  if (!apiKey) {
    return { ok: false, error: 'xapi API key not configured. Open Settings → Integrations → xapi to add one.' }
  }

  try {
    const res = await fetch(XAPI_EXECUTE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        action_id: 'web.search',
        input: { q, num: limit, autocorrect: true },
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `xapi returned ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}` }
    }
    const json = (await res.json()) as {
      success?: boolean
      error?: string
      data?: {
        organic?: Array<{ title?: string; link?: string; snippet?: string; position?: number }>
        answerBox?: { title?: string; link?: string; snippet?: string }
      }
    }
    if (!json.success) {
      return { ok: false, error: json.error || 'xapi returned success=false' }
    }

    const out: DiscoveryResult[] = []
    // AnswerBox first (often the highest-quality hit) then organic results.
    const ab = json.data?.answerBox
    if (ab?.link) {
      out.push({ title: ab.title?.trim() || ab.link, url: ab.link, snippet: (ab.snippet || '').slice(0, 280) })
    }
    for (const item of json.data?.organic ?? []) {
      if (!item.link) continue
      if (out.find((o) => o.url === item.link)) continue
      out.push({
        title: item.title?.trim() || item.link,
        url: item.link,
        snippet: (item.snippet || '').slice(0, 280),
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
