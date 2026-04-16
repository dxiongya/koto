/**
 * Wiki Embedding — semantic search over wiki pages.
 * Reuses Gemini Embedding 2 from collector-embedding.
 * Vectors stored in wiki.db via wiki-store.
 */
import { GoogleGenAI } from '@google/genai'
import { loadConfig } from './lite-home'
import {
  getWikiDb, listWikiPages, indexWikiPage,
  type WikiPageRow,
} from './wiki-store'

const EMBEDDING_MODEL = 'gemini-embedding-2-preview'
const VECTOR_DIM = 768
const MAX_EMBED_CHARS = 1500

function getClient(): GoogleGenAI | null {
  const config = loadConfig()
  const apiKey = config.embeddingGeminiApiKey
  if (!apiKey) return null
  return new GoogleGenAI({ apiKey })
}

async function embedText(client: GoogleGenAI, text: string): Promise<number[] | null> {
  try {
    const result = await client.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: text,
      config: { outputDimensionality: VECTOR_DIM },
    })
    return result.embeddings?.[0]?.values || null
  } catch (e) {
    console.error('[WikiEmbed] Failed:', e)
    return null
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

// ── Vector storage ──

function saveWikiVector(relPath: string, vector: number[]): void {
  const buf = Buffer.from(new Float64Array(vector).buffer)
  getWikiDb().prepare(`
    INSERT INTO wiki_vectors (rel_path, vector, embedded_at) VALUES (?, ?, ?)
    ON CONFLICT(rel_path) DO UPDATE SET vector = excluded.vector, embedded_at = excluded.embedded_at
  `).run(relPath, buf, Date.now())
}

function getAllWikiVectors(): Array<{ relPath: string; vector: number[] }> {
  const rows = getWikiDb().prepare('SELECT rel_path, vector FROM wiki_vectors').all() as Array<{ rel_path: string; vector: Buffer }>
  return rows.map(r => ({
    relPath: r.rel_path,
    vector: Array.from(new Float64Array(r.vector.buffer, r.vector.byteOffset, r.vector.byteLength / 8)),
  }))
}

// ── Public API ──

/** Build embedding text from a wiki page */
function buildEmbedText(page: WikiPageRow): string {
  const parts = [page.title]
  if (page.tags) parts.push(page.tags)
  if (page.type) parts.push(`[${page.type}]`)
  parts.push(page.content.slice(0, MAX_EMBED_CHARS))
  return parts.join('\n')
}

/** Embed a single wiki page */
export async function embedWikiPage(relPath: string): Promise<void> {
  const client = getClient()
  if (!client) return

  // Ensure page is indexed first
  indexWikiPage(relPath)

  const row = getWikiDb().prepare('SELECT * FROM wiki_pages WHERE rel_path = ?').get(relPath) as WikiPageRow | undefined
  if (!row) return

  const text = buildEmbedText(row)
  const vector = await embedText(client, text)
  if (vector) {
    saveWikiVector(relPath, vector)
    console.log(`[WikiEmbed] Embedded: ${relPath}`)
  }
}

/** Embed all wiki pages that don't have vectors yet */
export async function embedAllWikiPages(): Promise<void> {
  const client = getClient()
  if (!client) { console.warn('[WikiEmbed] No Gemini client'); return }

  const SYSTEM_FILES = new Set(['SCHEMA.md', 'index.md', 'log.md', 'overview.md', 'purpose.md'])
  const pages = listWikiPages().filter(p => !SYSTEM_FILES.has(p.relPath))

  const embedded = new Set(
    (getWikiDb().prepare('SELECT rel_path FROM wiki_vectors').all() as Array<{ rel_path: string }>)
      .map(r => r.rel_path)
  )

  let count = 0
  for (const p of pages) {
    if (embedded.has(p.relPath)) continue
    indexWikiPage(p.relPath)
    const row = getWikiDb().prepare('SELECT * FROM wiki_pages WHERE rel_path = ?').get(p.relPath) as WikiPageRow | undefined
    if (!row) continue

    const text = buildEmbedText(row)
    const vector = await embedText(client, text)
    if (vector) {
      saveWikiVector(p.relPath, vector)
      count++
      console.log(`[WikiEmbed] ${count}: ${p.relPath}`)
    }
  }
  console.log(`[WikiEmbed] Embedded ${count} new pages`)
}

export interface WikiSearchResult {
  relPath: string
  title: string
  type: string
  content: string
  score: number
  confidence: number
  supersededBy: string | null
  source: 'bm25' | 'semantic' | 'graph'
}

/** Semantic search over wiki pages */
export async function wikiSemanticSearch(query: string, topK = 10): Promise<WikiSearchResult[]> {
  const client = getClient()
  if (!client) return []

  const queryVector = await embedText(client, query)
  if (!queryVector) return []

  const entries = getAllWikiVectors()
  if (entries.length === 0) return []

  const scored = entries.map(e => ({
    relPath: e.relPath,
    score: cosineSimilarity(queryVector, e.vector),
  }))

  const MIN_SIMILARITY = 0.65
  const filtered = scored.filter(s => s.score >= MIN_SIMILARITY)
  filtered.sort((a, b) => b.score - a.score)

  const db = getWikiDb()
  return filtered.slice(0, topK).map(s => {
    const row = db.prepare('SELECT * FROM wiki_pages WHERE rel_path = ?').get(s.relPath) as WikiPageRow | undefined
    return {
      relPath: s.relPath,
      title: row?.title || s.relPath,
      type: row?.type || 'page',
      content: row?.content || '',
      score: s.score,
      confidence: row?.confidence ?? 0.5,
      supersededBy: row?.superseded_by || null,
      source: 'semantic' as const,
    }
  })
}
