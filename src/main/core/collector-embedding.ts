/**
 * Collector Embedding Service
 * Uses Gemini Embedding 2 for multimodal semantic search.
 * Vectors stored in SQLite via collector-store.
 */
import fs from 'fs'
import path from 'path'
import { GoogleGenAI } from '@google/genai'
import { getLiteHome } from './lite-home'
import { loadConfig } from './lite-home'
import { readItemMarkdown, saveVector, getAllVectors } from './collector-store'
import type { CollectedItem } from '../../shared/types'

const EMBEDDING_MODEL = 'gemini-embedding-exp-03-07'
const VECTOR_DIM = 768

/** Get a configured Gemini client, or null if no API key */
function getClient(): GoogleGenAI | null {
  const config = loadConfig()
  // Look for a Google provider with API key
  const googleProvider = config.ai?.providers?.find(
    (p) => p.type === 'google' && p.apiKey && p.enabled
  )
  if (!googleProvider?.apiKey) return null
  return new GoogleGenAI({ apiKey: googleProvider.apiKey })
}

/** Embed text content via Gemini */
async function embedText(client: GoogleGenAI, text: string): Promise<number[] | null> {
  try {
    const result = await client.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: text,
      config: { outputDimensionality: VECTOR_DIM },
    })
    return result.embeddings?.[0]?.values || null
  } catch (e) {
    console.error('[Embedding] Failed:', e)
    return null
  }
}

/** Embed an image file via Gemini (multimodal) */
async function embedImage(client: GoogleGenAI, imagePath: string, mimeType: string): Promise<number[] | null> {
  try {
    const data = fs.readFileSync(imagePath).toString('base64')
    const result = await client.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: {
        parts: [{ inlineData: { mimeType, data } }],
      },
      config: { outputDimensionality: VECTOR_DIM },
    })
    return result.embeddings?.[0]?.values || null
  } catch (e) {
    console.error('[Embedding] Image embed failed:', e)
    return null
  }
}

/** Build the best text representation for embedding */
function buildEmbeddingText(item: CollectedItem): string {
  const parts: string[] = []

  // Title always included
  if (item.title) parts.push(item.title)

  // Description / note
  if (item.note) parts.push(item.note)

  // URL domain for context
  if (item.url) {
    try {
      parts.push(new URL(item.url).hostname)
    } catch {}
  }

  // Try markdown content (richest source)
  const markdown = readItemMarkdown(item.id)
  if (markdown) {
    // Use first 4000 chars of markdown (stay within token limits)
    parts.push(markdown.slice(0, 4000))
  }

  return parts.join('\n\n')
}

/** Embed a single item — decides text vs image based on type + available data */
export async function embedItem(item: CollectedItem): Promise<number[] | null> {
  const client = getClient()
  if (!client) return null

  // For items with local image assets, use multimodal embedding
  if (item.assetPath && (item.type === 'image' || item.type === 'screenshot')) {
    const fullPath = path.join(getLiteHome(), 'collected', item.assetPath)
    if (fs.existsSync(fullPath)) {
      const ext = path.extname(fullPath).toLowerCase()
      const mimeMap: Record<string, string> = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp',
      }
      const mime = mimeMap[ext]
      if (mime) return embedImage(client, fullPath, mime)
    }
  }

  // Text-based embedding for everything else
  const text = buildEmbeddingText(item)
  if (!text.trim()) return null
  return embedText(client, text)
}

/** Embed a single item and save to SQLite */
export async function embedAndSave(item: CollectedItem): Promise<boolean> {
  const vector = await embedItem(item)
  if (!vector) return false
  saveVector(item.id, vector)
  return true
}

/** Embed all items that don't have vectors yet */
export async function embedAllPending(items: CollectedItem[]): Promise<{ embedded: number; failed: number }> {
  const existingVecs = getAllVectors()
  const existingIds = new Set(existingVecs.map((e) => e.itemId))
  const pending = items.filter((item) => !existingIds.has(item.id))

  let embedded = 0
  let failed = 0

  for (const item of pending) {
    const ok = await embedAndSave(item)
    if (ok) embedded++
    else failed++
    // Rate limiting: small delay between requests
    if (pending.length > 5) await new Promise((r) => setTimeout(r, 200))
  }

  return { embedded, failed }
}

/** Cosine similarity between two vectors */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export interface SearchResult {
  itemId: string
  score: number
  source: 'semantic' | 'keyword'
}

/** Semantic search: embed query, find top-K similar items */
export async function semanticSearch(query: string, topK = 20): Promise<SearchResult[]> {
  const client = getClient()
  if (!client) return []

  const queryVector = await embedText(client, query)
  if (!queryVector) return []

  const entries = getAllVectors()
  if (entries.length === 0) return []

  // Compute similarities
  const scored = entries.map((entry) => ({
    itemId: entry.itemId,
    score: cosineSimilarity(queryVector, entry.vector),
    source: 'semantic' as const,
  }))

  // Sort by score descending, return top-K
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}

/** Simple keyword search (title, note, url, meta) */
export function keywordSearch(query: string, items: CollectedItem[], topK = 20): SearchResult[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []

  const scored: SearchResult[] = []

  for (const item of items) {
    const text = [
      item.title,
      item.note,
      item.url || '',
      String(item.meta?.description || ''),
      String(item.meta?.domain || ''),
    ].join(' ').toLowerCase()

    let matchCount = 0
    for (const term of terms) {
      if (text.includes(term)) matchCount++
    }
    if (matchCount > 0) {
      scored.push({
        itemId: item.id,
        score: matchCount / terms.length,
        source: 'keyword',
      })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}

/** Hybrid search: combine semantic + keyword with Reciprocal Rank Fusion */
export async function hybridSearch(query: string, items: CollectedItem[], topK = 20): Promise<SearchResult[]> {
  const k = 60 // RRF constant

  // Run both searches in parallel
  const [semanticResults, keywordResults] = await Promise.all([
    semanticSearch(query, topK * 2),
    Promise.resolve(keywordSearch(query, items, topK * 2)),
  ])

  // RRF scoring
  const rrfScores = new Map<string, number>()

  for (let i = 0; i < semanticResults.length; i++) {
    const id = semanticResults[i].itemId
    rrfScores.set(id, (rrfScores.get(id) || 0) + 1 / (k + i + 1))
  }

  for (let i = 0; i < keywordResults.length; i++) {
    const id = keywordResults[i].itemId
    rrfScores.set(id, (rrfScores.get(id) || 0) + 1 / (k + i + 1))
  }

  // Sort by RRF score
  const results: SearchResult[] = Array.from(rrfScores.entries())
    .map(([itemId, score]) => ({ itemId, score, source: 'semantic' as const }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)

  return results
}

