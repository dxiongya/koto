/**
 * Memory Embedding Service
 * Reuses Gemini Embedding API from collector-embedding pattern.
 * Embeds memory content, enables semantic search.
 */
import { GoogleGenAI } from '@google/genai'
import { loadConfig } from './lite-home'
import { saveMemoryVector, getAllMemoryVectors, getMemory } from './memory-store'

const EMBEDDING_MODEL = 'gemini-embedding-2-preview'
const VECTOR_DIM = 768
const SIMILARITY_THRESHOLD = 0.65

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
    console.error('[Memory Embedding] Failed:', e)
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

/** Embed a single memory and store the vector */
export async function embedMemory(memoryId: string): Promise<boolean> {
  const client = getClient()
  if (!client) return false

  const memory = getMemory(memoryId)
  if (!memory) return false

  // Combine content + summary for richer embedding
  const text = memory.summary
    ? `${memory.summary}\n\n${memory.content}`
    : memory.content

  const vector = await embedText(client, text.slice(0, 2000))
  if (!vector) return false

  saveMemoryVector(memoryId, vector)
  return true
}

/** Semantic search across all memory vectors */
export async function semanticMemorySearch(
  query: string,
  topK = 10,
  wingFilter?: string,
  roomFilter?: string,
): Promise<{ memoryId: string; score: number }[]> {
  const client = getClient()
  if (!client) return []

  const queryVector = await embedText(client, query)
  if (!queryVector) return []

  const entries = getAllMemoryVectors()
  if (entries.length === 0) return []

  // Score all vectors
  const scored = entries.map((entry) => ({
    memoryId: entry.memoryId,
    score: cosineSimilarity(queryVector, entry.vector),
  }))

  // Filter by threshold
  let filtered = scored.filter((s) => s.score >= SIMILARITY_THRESHOLD)

  // Apply wing/room filters
  if (wingFilter || roomFilter) {
    filtered = filtered.filter((s) => {
      const mem = getMemory(s.memoryId)
      if (!mem) return false
      if (wingFilter && mem.wingId !== wingFilter) return false
      if (roomFilter && mem.roomId !== roomFilter) return false
      return true
    })
  }

  // Sort by score, return top-K
  return filtered.sort((a, b) => b.score - a.score).slice(0, topK)
}
