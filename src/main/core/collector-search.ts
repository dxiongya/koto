/**
 * Collector Hybrid Search — RRF (Reciprocal Rank Fusion) of:
 *   1. Keyword search (FTS5 BM25 / LIKE for CJK)
 *   2. Semantic search (Gemini embedding cosine similarity)
 *
 * Both are run in parallel and their results are fused by rank position:
 *     score(item) = Σ 1 / (K + rank_in_source)
 *
 * K=60 is the canonical RRF constant (Cormack et al. 2009). Smaller = top
 * ranks get disproportionately more weight; larger = flatter distribution.
 *
 * If embeddings are unavailable (no API key, network error, etc.), falls
 * back to keyword-only search without failing.
 */
import { ftsSearch, getItemsByIds, type FtsSearchResult } from './collector-store'
import { semanticSearch } from './collector-embedding'
import type { CollectedItem } from '../../shared/types'

const RRF_K = 60

export interface HybridSearchResult {
  item: CollectedItem
  score: number
  sources: Array<'keyword' | 'semantic'>
}

/** Simple in-memory LRU for query embeddings (avoid re-embedding same query). */
const queryCache = new Map<string, { ts: number; results: unknown }>()
const QUERY_CACHE_TTL = 5 * 60_000 // 5 minutes
const QUERY_CACHE_MAX = 50

function cacheGet<T>(key: string): T | null {
  const entry = queryCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.ts > QUERY_CACHE_TTL) {
    queryCache.delete(key)
    return null
  }
  return entry.results as T
}

function cacheSet(key: string, results: unknown): void {
  if (queryCache.size >= QUERY_CACHE_MAX) {
    const oldest = queryCache.keys().next().value
    if (oldest) queryCache.delete(oldest)
  }
  queryCache.set(key, { ts: Date.now(), results })
}

/**
 * Hybrid search with Reciprocal Rank Fusion.
 *
 * @param query user query string
 * @param limit max results returned (default 20)
 */
export async function hybridCollectorSearch(query: string, limit = 20): Promise<HybridSearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  // Run both in parallel. Semantic search is allowed to fail silently (no API key).
  const [ftsResults, semanticResults] = await Promise.all([
    Promise.resolve().then(() => {
      const cached = cacheGet<FtsSearchResult[]>(`fts:${trimmed}`)
      if (cached) return cached
      const res = ftsSearch(trimmed, 30)
      cacheSet(`fts:${trimmed}`, res)
      return res
    }),
    semanticSearch(trimmed, 30).catch((e) => {
      console.warn('[Collector Search] semantic failed, keyword only:', e)
      return []
    }),
  ])

  console.log(`[Collector Search] "${trimmed}" → FTS: ${ftsResults.length}, semantic: ${semanticResults.length}`)

  // RRF fusion: aggregate scores by item id, track which sources contributed.
  const scores = new Map<string, { score: number; sources: Set<'keyword' | 'semantic'> }>()
  const itemCache = new Map<string, CollectedItem>()

  ftsResults.forEach((r, i) => {
    const id = r.item.id
    const entry = scores.get(id) || { score: 0, sources: new Set() }
    entry.score += 1 / (RRF_K + i)
    entry.sources.add('keyword')
    scores.set(id, entry)
    itemCache.set(id, r.item)
  })

  // Semantic results only give us IDs — collect missing items in one SQL roundtrip.
  const semanticIdsToFetch: string[] = []
  for (const r of semanticResults) {
    if (!itemCache.has(r.itemId)) semanticIdsToFetch.push(r.itemId)
  }
  if (semanticIdsToFetch.length > 0) {
    const fetched = getItemsByIds(semanticIdsToFetch)
    for (const item of fetched) itemCache.set(item.id, item)
  }

  semanticResults.forEach((r, i) => {
    if (!itemCache.has(r.itemId)) return // item was deleted or fetch failed
    const entry = scores.get(r.itemId) || { score: 0, sources: new Set() }
    entry.score += 1 / (RRF_K + i)
    entry.sources.add('semantic')
    scores.set(r.itemId, entry)
  })

  // Sort by fused score desc; items matched by BOTH sources naturally rank higher.
  return [...scores.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit)
    .map(([id, { score, sources }]) => ({
      item: itemCache.get(id)!,
      score,
      sources: [...sources],
    }))
    .filter((r) => r.item)
}
