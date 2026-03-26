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
import { readItemMarkdown, saveVector, getAllVectors, updateCollectedItem } from './collector-store'
import type { CollectedItem } from '../../shared/types'

const EMBEDDING_MODEL = 'gemini-embedding-2-preview'
const VECTOR_DIM = 768

/** Get a configured Gemini client using collector's dedicated API key */
function getClient(): GoogleGenAI | null {
  const config = loadConfig()
  const apiKey = config.embeddingGeminiApiKey
  if (!apiKey) return null
  return new GoogleGenAI({ apiKey })
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

/** Use Gemini Vision to describe an image and extract text (OCR) */
async function describeImage(client: GoogleGenAI, imagePath: string, mimeType: string): Promise<{ description: string; ocrText: string } | null> {
  try {
    const data = fs.readFileSync(imagePath).toString('base64')
    const result = await client.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType, data } },
          { text: 'Describe this image briefly (1-2 sentences). Then extract ALL visible text from the image. Return in this exact format:\nDESCRIPTION: <description>\nTEXT: <all visible text separated by spaces>' },
        ],
      }],
    })
    const text = result.text || ''
    const descMatch = text.match(/DESCRIPTION:\s*(.+)/i)
    const ocrMatch = text.match(/TEXT:\s*(.+)/is)
    return {
      description: descMatch?.[1]?.trim() || '',
      ocrText: ocrMatch?.[1]?.trim() || '',
    }
  } catch (e) {
    console.error('[OCR] Failed:', e)
    return null
  }
}

/** OCR + describe an image item and update its metadata */
export async function ocrAndDescribeItem(item: CollectedItem): Promise<boolean> {
  if (!item.assetPath) return false
  if (item.type !== 'image' && item.type !== 'screenshot') return false

  const client = getClient()
  if (!client) return false

  const fullPath = path.join(getLiteHome(), 'collected', item.assetPath)
  if (!fs.existsSync(fullPath)) return false

  const ext = path.extname(fullPath).toLowerCase()
  const mimeMap: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp',
  }
  const mime = mimeMap[ext]
  if (!mime) return false

  console.log(`[OCR] Processing: ${item.id} "${item.title.slice(0, 30)}"`)
  const result = await describeImage(client, fullPath, mime)
  if (!result) return false

  console.log(`[OCR] Description: ${result.description.slice(0, 60)}`)
  console.log(`[OCR] Text found: ${result.ocrText.slice(0, 80)}`)

  // Update item with OCR data — this also updates FTS5 index via trigger
  const meta = { ...(item.meta || {}), ocrText: result.ocrText, imageDescription: result.description }
  const note = [result.description, result.ocrText].filter(Boolean).join('\n')
  updateCollectedItem(item.id, { note, meta })

  return true
}

/** Build the best text representation for embedding */
function buildEmbeddingText(item: CollectedItem): string {
  const parts: string[] = []

  // Title always included
  if (item.title) parts.push(item.title)

  // Description / note (includes OCR text for images)
  if (item.note) parts.push(item.note)

  // OCR text from meta (also in note, but explicit for safety)
  if (item.meta?.ocrText) parts.push(String(item.meta.ocrText))
  if (item.meta?.imageDescription) parts.push(String(item.meta.imageDescription))

  // URL domain for context
  if (item.url) {
    try { parts.push(new URL(item.url).hostname) } catch {}
  }

  // Meta description (for links)
  if (item.meta?.description) parts.push(String(item.meta.description))

  // Try markdown content (richest source for links)
  const markdown = readItemMarkdown(item.id)
  if (markdown) parts.push(markdown.slice(0, 4000))

  return parts.join('\n\n')
}

/** Embed a single item. For images: OCR first, then embed the text. */
export async function embedItem(item: CollectedItem): Promise<number[] | null> {
  const client = getClient()
  if (!client) return null

  // For image items: run OCR first if not done yet, then embed the extracted text
  if (item.assetPath && (item.type === 'image' || item.type === 'screenshot')) {
    if (!item.meta?.ocrText) {
      // Run OCR — this updates the item in DB with description + extracted text
      await ocrAndDescribeItem(item)
      // Re-read the updated item to get OCR text
      const { listCollectedItems } = await import('./collector-store')
      const updated = listCollectedItems().find((i) => i.id === item.id)
      if (updated) item = updated
    }
  }

  // Now embed using text (which includes OCR text for images)
  const text = buildEmbeddingText(item)
  if (!text.trim()) return null
  return embedText(client, text)
}

/** Embed a single item and save to SQLite */
export async function embedAndSave(item: CollectedItem): Promise<boolean> {
  console.log(`[Embedding] Processing: ${item.type} "${item.title.slice(0, 40)}" (${item.id})`)
  const vector = await embedItem(item)
  if (!vector) {
    console.warn(`[Embedding] Failed for ${item.id} — no vector returned`)
    return false
  }
  console.log(`[Embedding] Success: ${item.id} → ${vector.length}-dim vector`)
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
  if (!client) { console.warn('[Search] No Gemini client — skipping semantic search'); return [] }

  const queryVector = await embedText(client, query)
  if (!queryVector) { console.warn('[Search] Failed to embed query'); return [] }

  const entries = getAllVectors()
  if (entries.length === 0) { console.warn('[Search] No vectors in DB'); return [] }
  console.log(`[Search] Comparing query against ${entries.length} vectors`)

  // Compute similarities
  const scored = entries.map((entry) => ({
    itemId: entry.itemId,
    score: cosineSimilarity(queryVector, entry.vector),
    source: 'semantic' as const,
  }))

  // Filter by minimum similarity threshold, then sort
  const MIN_SIMILARITY = 0.6
  const filtered = scored.filter((s) => s.score >= MIN_SIMILARITY)
  filtered.sort((a, b) => b.score - a.score)
  console.log(`[Search] ${filtered.length}/${scored.length} pass threshold ${MIN_SIMILARITY}. All scores: ${scored.map(s => (s.score * 100).toFixed(1) + '%').join(', ')}`)
  return filtered.slice(0, topK)
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
    if (matchCount > 0 && matchCount / terms.length >= 0.5) {
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

