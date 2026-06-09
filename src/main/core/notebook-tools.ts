/**
 * Notebook agent tools.
 *
 * These run inside pi-agent-core's tool loop. Each tool has direct access to
 * Koto's main-process stores (notebook-storage, etc.), so retrieval doesn't
 * round-trip through IPC.
 *
 * Citation contract: every tool that returns source text includes the
 * `[src:<sourceKey>#<passageId>]` marker either in the result text itself or
 * in `details.citations[]`, so the model can echo it back into its reply.
 */
import { Type } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import {
  getSession, readSourcePassages, readSourceEmbeddings, getPassage,
} from './notebook-storage'
import { GoogleGenAI } from '@google/genai'
import { loadConfig } from './lite-home'
import type { SourcePassage } from '../../shared/notebook'

const EMBED_MODEL = 'gemini-embedding-001'
const EMBED_DIM = 768

// ─── Retrieval primitives ──────────────────────────────────────────

function selectedSourceKeys(sessionId: string): string[] {
  const s = getSession(sessionId)
  if (!s) return []
  return Object.values(s.sources)
    .filter((m) => m.selected && m.status === 'ready')
    .map((m) => m.key)
}

function cosine(a: Float32Array, b: Float32Array, aOff: number, bOff: number, dim: number): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < dim; i++) {
    const x = a[aOff + i], y = b[bOff + i]
    dot += x * y; na += x * x; nb += y * y
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

async function embedQuery(query: string): Promise<Float32Array | null> {
  const cfg = loadConfig()
  if (!cfg.embeddingGeminiApiKey) return null
  try {
    const client = new GoogleGenAI({ apiKey: cfg.embeddingGeminiApiKey })
    const result = await client.models.embedContent({
      model: EMBED_MODEL,
      contents: query,
      config: { outputDimensionality: EMBED_DIM },
    })
    const v = result.embeddings?.[0]?.values
    if (!v) return null
    const out = new Float32Array(EMBED_DIM)
    for (let i = 0; i < EMBED_DIM && i < v.length; i++) out[i] = v[i]
    return out
  } catch {
    return null
  }
}

function keywordScore(query: string, text: string): number {
  const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length >= 2)
  if (tokens.length === 0) return 0
  const lower = text.toLowerCase()
  let hits = 0
  for (const t of tokens) if (lower.includes(t)) hits++
  return hits / tokens.length
}

// ─── Tool: list_sources ────────────────────────────────────────────

function makeListSources(sessionId: string): AgentTool {
  return {
    name: 'list_sources',
    label: 'List notebook sources',
    description: 'List the sources currently selected in this notebook with their summary, key topics, and current processing status. Use this to understand what you have available before deciding what to search.',
    parameters: Type.Object({}),
    execute: async () => {
      const s = getSession(sessionId)
      if (!s) {
        return { content: [{ type: 'text', text: 'No notebook session.' }], details: { count: 0 } }
      }
      const all = Object.values(s.sources)
      const selected = all.filter((m) => m.selected)
      if (selected.length === 0) {
        return {
          content: [{ type: 'text', text: `No sources are selected. ${all.length} sources exist but are unselected.` }],
          details: { count: 0 },
        }
      }
      const lines = selected.map((m) => {
        const tag = `[src:${m.key}]`
        const head = `${tag} ${m.title} — status: ${m.status}`
        const sum = m.summary ? `\n  summary: ${m.summary}` : ''
        const topics = m.topics?.length ? `\n  topics: ${m.topics.join(', ')}` : ''
        return head + sum + topics
      })
      return {
        content: [{ type: 'text', text: lines.join('\n\n') }],
        details: { count: selected.length, keys: selected.map((m) => m.key) },
      }
    },
  } as AgentTool
}

// ─── Tool: get_source_summary ──────────────────────────────────────

function makeGetSourceSummary(sessionId: string): AgentTool {
  return {
    name: 'get_source_summary',
    label: 'Get source summary',
    description: 'Read the auto-generated summary + topics + suggested questions for one source. Useful before searching to know what scope of questions makes sense.',
    parameters: Type.Object({
      source_key: Type.String({ description: 'Source key, e.g. n-abc12345 or c-itemId' }),
    }),
    execute: async (_id, raw) => {
      const params = raw as { source_key: string }
      const s = getSession(sessionId)
      const m = s?.sources[params.source_key]
      if (!m) return { content: [{ type: 'text', text: `Source not found: ${params.source_key}` }], details: {} }
      const parts: string[] = [`Title: ${m.title}`]
      if (m.summary) parts.push(`\nSummary:\n${m.summary}`)
      if (m.topics?.length) parts.push(`\nTopics: ${m.topics.join(', ')}`)
      if (m.suggestedQuestions?.length) parts.push(`\nSuggested questions:\n- ${m.suggestedQuestions.join('\n- ')}`)
      return { content: [{ type: 'text', text: parts.join('\n') }], details: { meta: m } }
    },
  } as AgentTool
}

// ─── Tool: search_in_sources ───────────────────────────────────────

interface ScoredPassage {
  sourceKey: string
  passage: SourcePassage
  score: number
}

function makeSearchInSources(sessionId: string): AgentTool {
  return {
    name: 'search_in_sources',
    label: 'Search across notebook sources',
    description: 'Find the most relevant passages across SELECTED sources for a query. Returns up to `top_k` passages with their `[src:key#passageId]` markers — use those markers verbatim in your citations.',
    parameters: Type.Object({
      query: Type.String({ description: 'What to search for. Use the user\'s language.' }),
      top_k: Type.Optional(Type.Integer({ description: 'How many passages to return (default 6, max 12).' })),
      source_keys: Type.Optional(Type.Array(Type.String(), { description: 'Restrict to specific source keys; default = all selected sources.' })),
    }),
    execute: async (_id, raw) => {
      const params = raw as { query: string; top_k?: number; source_keys?: string[] }
      const topK = Math.min(Math.max(params.top_k ?? 6, 1), 12)
      const keys = (params.source_keys?.length ? params.source_keys : selectedSourceKeys(sessionId))
      if (keys.length === 0) {
        return { content: [{ type: 'text', text: 'No sources are available for search.' }], details: { hits: [] } }
      }

      const queryVec = await embedQuery(params.query)
      const allHits: ScoredPassage[] = []

      for (const key of keys) {
        const passages = readSourcePassages(sessionId, key)
        if (passages.length === 0) continue

        let vecMatrix: Float32Array | null = null
        if (queryVec) vecMatrix = readSourceEmbeddings(sessionId, key, EMBED_DIM)

        for (let i = 0; i < passages.length; i++) {
          const kw = keywordScore(params.query, passages[i].text)
          let semantic = 0
          if (vecMatrix && queryVec) {
            semantic = cosine(queryVec, vecMatrix, 0, i * EMBED_DIM, EMBED_DIM)
          }
          // Blend: semantic 0.6 + keyword 0.4 — collapses cleanly to keyword
          // search when embeddings are unavailable.
          const score = vecMatrix ? semantic * 0.6 + kw * 0.4 : kw
          if (score > 0) allHits.push({ sourceKey: key, passage: passages[i], score })
        }
      }

      allHits.sort((a, b) => b.score - a.score)
      const top = allHits.slice(0, topK)

      if (top.length === 0) {
        return {
          content: [{ type: 'text', text: `No matches in ${keys.length} source(s).` }],
          details: { hits: [] },
        }
      }
      const lines = top.map((h) => {
        const tag = `[src:${h.sourceKey}#${h.passage.id}]`
        const snippet = h.passage.text.length > 800 ? h.passage.text.slice(0, 800) + '…' : h.passage.text
        return `${tag} (score=${h.score.toFixed(2)})\n${snippet}`
      })
      return {
        content: [{ type: 'text', text: lines.join('\n\n---\n\n') }],
        details: { hits: top.map((h) => ({ sourceKey: h.sourceKey, passageId: h.passage.id, score: h.score })) },
      }
    },
  } as AgentTool
}

// ─── Tool: get_passage ─────────────────────────────────────────────

function makeGetPassage(sessionId: string): AgentTool {
  return {
    name: 'get_passage',
    label: 'Get passage by id',
    description: 'Retrieve the exact text of one passage by its source key and passage id (e.g. p3). Use when you need to verify a quote or surrounding context.',
    parameters: Type.Object({
      source_key: Type.String(),
      passage_id: Type.String(),
    }),
    execute: async (_id, raw) => {
      const params = raw as { source_key: string; passage_id: string }
      const p = getPassage(sessionId, params.source_key, params.passage_id)
      if (!p) return { content: [{ type: 'text', text: `Passage not found: ${params.source_key}#${params.passage_id}` }], details: {} }
      const tag = `[src:${params.source_key}#${params.passage_id}]`
      return {
        content: [{ type: 'text', text: `${tag}\n${p.text}` }],
        details: { sourceKey: params.source_key, passageId: params.passage_id, start: p.start, end: p.end },
      }
    },
  } as AgentTool
}

// ─── Bundle ────────────────────────────────────────────────────────

export function buildNotebookTools(sessionId: string): AgentTool[] {
  return [
    makeListSources(sessionId),
    makeGetSourceSummary(sessionId),
    makeSearchInSources(sessionId),
    makeGetPassage(sessionId),
  ]
}
