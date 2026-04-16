/**
 * Wiki Hybrid Search — BM25 + Semantic + Graph, fused with Reciprocal Rank Fusion.
 */
import { wikiFtsSearch, getWikiGraph, getWikiPageRow } from './wiki-store'
import { wikiSemanticSearch, type WikiSearchResult } from './wiki-embedding'

const RRF_K = 60

/**
 * Hybrid search: BM25 (FTS5) + Semantic (vector) + Graph (1-hop neighbors).
 * Results fused via Reciprocal Rank Fusion, with confidence/supersession downranking.
 */
export async function wikiHybridSearch(query: string, topK = 10): Promise<WikiSearchResult[]> {
  // 1. BM25 search
  const bm25Results = wikiFtsSearch(query, 20)
  const bm25Ranked: WikiSearchResult[] = bm25Results.map((row, i) => ({
    relPath: row.rel_path,
    title: row.title,
    type: row.type,
    content: row.content,
    score: 1 / (RRF_K + i + 1),
    confidence: row.confidence,
    supersededBy: row.superseded_by || null,
    source: 'bm25' as const,
  }))

  // 2. Semantic search
  let semanticRanked: WikiSearchResult[] = []
  try {
    const semanticResults = await wikiSemanticSearch(query, 20)
    semanticRanked = semanticResults.map((r, i) => ({
      ...r,
      score: 1 / (RRF_K + i + 1),
    }))
  } catch (e) {
    console.warn('[WikiSearch] Semantic search failed:', e)
  }

  // 3. Graph expansion — 1-hop neighbors of BM25 + semantic hits
  const hitPaths = new Set([
    ...bm25Ranked.slice(0, 5).map(r => r.relPath),
    ...semanticRanked.slice(0, 5).map(r => r.relPath),
  ])

  const graphRanked: WikiSearchResult[] = []
  if (hitPaths.size > 0) {
    try {
      const graph = getWikiGraph()
      const neighbors = new Map<string, number>() // relPath → hop count from hits

      for (const edge of graph.edges) {
        const sourceRel = edge.source.endsWith('.md') ? edge.source : edge.source + '.md'
        const targetRel = edge.target.endsWith('.md') ? edge.target : edge.target + '.md'

        if (hitPaths.has(sourceRel) && !hitPaths.has(targetRel)) {
          neighbors.set(targetRel, (neighbors.get(targetRel) || 0) + 1)
        }
        if (hitPaths.has(targetRel) && !hitPaths.has(sourceRel)) {
          neighbors.set(sourceRel, (neighbors.get(sourceRel) || 0) + 1)
        }
      }

      // Sort neighbors by connection count (more connections = more relevant)
      const sorted = [...neighbors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      for (const [relPath] of sorted) {
        const row = getWikiPageRow(relPath)
        if (!row) continue
        graphRanked.push({
          relPath,
          title: row.title,
          type: row.type,
          content: row.content,
          score: 1 / (RRF_K + graphRanked.length + 1),
          confidence: row.confidence,
          supersededBy: row.superseded_by || null,
          source: 'graph' as const,
        })
      }
    } catch (e) {
      console.warn('[WikiSearch] Graph expansion failed:', e)
    }
  }

  // 4. RRF fusion — merge scores by relPath
  const scoreMap = new Map<string, { result: WikiSearchResult; rrfScore: number }>()

  for (const list of [bm25Ranked, semanticRanked, graphRanked]) {
    for (const r of list) {
      const existing = scoreMap.get(r.relPath)
      if (existing) {
        existing.rrfScore += r.score
        // Keep the result with more content
        if (r.content.length > existing.result.content.length) {
          existing.result = { ...r, score: existing.rrfScore }
        }
      } else {
        scoreMap.set(r.relPath, { result: r, rrfScore: r.score })
      }
    }
  }

  // 5. Apply confidence/supersession downranking
  const fused = [...scoreMap.values()].map(({ result, rrfScore }) => {
    let finalScore = rrfScore
    if (result.supersededBy) finalScore *= 0.3
    if (result.confidence < 0.3) finalScore *= 0.5
    return { ...result, score: finalScore }
  })

  fused.sort((a, b) => b.score - a.score)
  return fused.slice(0, topK)
}
