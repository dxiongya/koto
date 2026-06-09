/**
 * Source processing pipeline.
 *
 * `processSource()` walks each source through the following stages, persisting
 * artifacts to disk and emitting status events along the way. Renderer
 * subscribes via IPC and updates the source row in real time.
 *
 *   pending → fetching → chunking → summarizing → embedding → ready
 *
 * Each stage is best-effort. If a stage fails (e.g. Gemini key not configured
 * → embedding unavailable), the source still ends up at `ready` with whatever
 * artifacts could be produced — the agent's retrieval tools just fall back to
 * keyword search instead of vector search.
 */
import fs from 'fs'
import path from 'path'
import { EventEmitter } from 'events'
import { GoogleGenAI } from '@google/genai'
import { aiChat } from './ai-service'
import { loadConfig } from './lite-home'
import {
  getSession, updateSourceMeta, writeSourceRaw, writeSourcePassages,
  writeSourceEmbeddings,
} from './notebook-storage'
import { maybeGenerateBriefing } from './notebook-briefing'
import type { SourceRef, SourceMeta, SourcePassage, SourceStatus } from '../../shared/notebook'

// ─── Event bus for status updates ───────────────────────────────────

export interface SourceEvent {
  type: 'source_status'
  sessionId: string
  sourceKey: string
  meta: SourceMeta
}

const bus = new EventEmitter()
bus.setMaxListeners(0)

export function onSourceEvent(listener: (e: SourceEvent) => void): () => void {
  bus.on('source', listener)
  return () => bus.off('source', listener)
}

function emit(sessionId: string, meta: SourceMeta): void {
  bus.emit('source', { type: 'source_status', sessionId, sourceKey: meta.key, meta })
}

// ─── Materializer: SourceRef → raw text ─────────────────────────────

async function materializeRef(ref: SourceRef): Promise<{ text: string; title?: string; subtitle?: string }> {
  switch (ref.kind) {
    case 'inline':
      return { text: ref.content }

    case 'note': {
      const text = fs.readFileSync(ref.path, 'utf-8')
      const name = path.basename(ref.path).replace(/\.md$/i, '')
      return { text, title: name, subtitle: ref.path }
    }

    case 'collector': {
      // Reuse Collector's existing markdown reader. Falls back to whatever
      // text-equivalent content (e.g. OCR result, title) the item has.
      const { listCollectedItems, readItemMarkdown } = await import('./collector-store')
      const item = listCollectedItems().find((i) => i.id === ref.itemId)
      if (!item) throw new Error(`collector item not found: ${ref.itemId}`)
      const md = readItemMarkdown(item.id)
      const fallback = item.title + (item.url ? `\n\n${item.url}` : '')
        + ((item.meta as { ocrText?: string } | undefined)?.ocrText ? `\n\n${(item.meta as { ocrText?: string }).ocrText}` : '')
      return { text: md ?? fallback, title: item.title || 'Untitled', subtitle: item.url ?? undefined }
    }

    case 'wiki': {
      const { readWikiFile } = await import('./wiki-store')
      const text = readWikiFile(ref.relPath) ?? ''
      return { text, title: path.basename(ref.relPath, '.md'), subtitle: ref.relPath }
    }

    case 'memory': {
      const { getMemory } = await import('./memory-store')
      const m = getMemory(ref.entityId)
      if (!m) throw new Error(`memory entity not found: ${ref.entityId}`)
      return { text: m.content, title: `${m.wingId} · ${m.roomId}`, subtitle: m.id }
    }
  }
}

// ─── Chunking ───────────────────────────────────────────────────────

/** Approximate token count from char length (≈ 4 chars/token). */
const TARGET_CHUNK_CHARS = 2400  // ~600 tokens
const MIN_CHUNK_CHARS = 600

/** Paragraph-based chunker. Splits on blank lines, then greedily packs
 *  paragraphs up to `TARGET_CHUNK_CHARS`. Records true char offsets so the
 *  citation popover can highlight the exact span in raw.md. */
function chunkText(raw: string): SourcePassage[] {
  const passages: SourcePassage[] = []
  const blankLine = /\n\s*\n/g

  // Walk paragraphs by index so we keep start/end offsets accurate.
  const boundaries: number[] = [0]
  let m: RegExpExecArray | null
  while ((m = blankLine.exec(raw)) !== null) {
    boundaries.push(m.index + m[0].length)
  }
  boundaries.push(raw.length)

  let bufStart = boundaries[0]
  let bufEnd = boundaries[0]
  let pi = 0
  for (let i = 0; i + 1 < boundaries.length; i++) {
    const segStart = boundaries[i]
    const segEnd = boundaries[i + 1]
    const segLen = segEnd - segStart

    if (bufEnd === bufStart) {
      // Empty buffer — accept whatever's there
      bufStart = segStart
      bufEnd = segEnd
      continue
    }

    if (bufEnd - bufStart + segLen <= TARGET_CHUNK_CHARS) {
      bufEnd = segEnd
    } else {
      // Flush current buffer if it's big enough; otherwise extend it and flush.
      if (bufEnd - bufStart < MIN_CHUNK_CHARS) {
        bufEnd = segEnd
      }
      passages.push({
        id: `p${pi++}`,
        text: raw.slice(bufStart, bufEnd).trim(),
        start: bufStart,
        end: bufEnd,
      })
      bufStart = segStart
      bufEnd = segEnd
    }
  }
  if (bufEnd > bufStart) {
    passages.push({
      id: `p${pi++}`,
      text: raw.slice(bufStart, bufEnd).trim(),
      start: bufStart,
      end: bufEnd,
    })
  }
  return passages.filter((p) => p.text.length > 0)
}

// ─── Summary / topics / suggested questions via LLM ─────────────────

interface Summarization {
  summary: string
  topics: string[]
  suggestedQuestions: string[]
}

async function summarizeSource(raw: string, title: string): Promise<Summarization | null> {
  // Pick the first enabled provider. Notebook agent honors the user's
  // featureRouting.chat once we plumb that through, but for a first-pass
  // ingest the cheapest enabled provider is fine.
  const cfg = loadConfig()
  const provider = cfg.ai?.providers?.find((p) => p.enabled)
  if (!provider) return null

  const head = raw.slice(0, 12000)  // first ~3k tokens of the source
  const system = `You are a research assistant. Read the source text and produce a strict-JSON object with these keys (and ONLY these keys):
- "summary": one paragraph (3-5 sentences), in the same language as the source
- "topics": array of 5-8 short topic phrases (≤ 6 words each)
- "suggestedQuestions": array of 3-5 questions a reader might ask about THIS source specifically

Do NOT invent content. Do NOT include any text outside the JSON.`
  const user = `Source title: ${title}\n\nSource text:\n\n${head}`

  try {
    const result = await aiChat(provider.id, [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], 0.2, 1200, false)
    if (!result.ok) return null
    const text = result.data.content.trim()
    // Tolerate ```json fences or stray prose around the JSON.
    const jsonStart = text.indexOf('{')
    const jsonEnd = text.lastIndexOf('}')
    if (jsonStart < 0 || jsonEnd < 0) return null
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as Partial<Summarization>
    if (!parsed.summary) return null
    return {
      summary: String(parsed.summary).trim(),
      topics: Array.isArray(parsed.topics) ? parsed.topics.slice(0, 8).map(String) : [],
      suggestedQuestions: Array.isArray(parsed.suggestedQuestions) ? parsed.suggestedQuestions.slice(0, 5).map(String) : [],
    }
  } catch (e) {
    console.warn('[NotebookPipeline] summarize failed:', e)
    return null
  }
}

// ─── Embedding ──────────────────────────────────────────────────────

const EMBED_MODEL = 'gemini-embedding-001'
const EMBED_DIM = 768

function getEmbedClient(): GoogleGenAI | null {
  const cfg = loadConfig()
  if (!cfg.embeddingGeminiApiKey) return null
  return new GoogleGenAI({ apiKey: cfg.embeddingGeminiApiKey })
}

async function embedPassages(client: GoogleGenAI, passages: SourcePassage[]): Promise<Float32Array | null> {
  try {
    const out = new Float32Array(passages.length * EMBED_DIM)
    for (let i = 0; i < passages.length; i++) {
      const result = await client.models.embedContent({
        model: EMBED_MODEL,
        contents: passages[i].text.slice(0, 8000),
        config: { outputDimensionality: EMBED_DIM },
      })
      const v = result.embeddings?.[0]?.values
      if (!v) continue
      for (let j = 0; j < EMBED_DIM && j < v.length; j++) {
        out[i * EMBED_DIM + j] = v[j]
      }
    }
    return out
  } catch (e) {
    console.warn('[NotebookPipeline] embedding failed:', e)
    return null
  }
}

// ─── Top-level pipeline ─────────────────────────────────────────────

/** Run the full pipeline on a registered source. Idempotent — safe to call
 *  again for re-processing. Each stage updates meta + emits an event. */
export async function processSource(sessionId: string, sourceKey: string): Promise<void> {
  const session = getSession(sessionId)
  if (!session) throw new Error('session not found')
  const meta0 = session.sources[sourceKey]
  if (!meta0) throw new Error('source not registered')
  const ref = meta0.ref

  const setStatus = (status: SourceStatus, patch?: Partial<SourceMeta>): SourceMeta => {
    const m = updateSourceMeta(sessionId, sourceKey, { status, ...patch })!
    emit(sessionId, m)
    return m
  }

  try {
    setStatus('fetching')
    const { text, title, subtitle } = await materializeRef(ref)
    if (!text || !text.trim()) throw new Error('source produced no text')

    writeSourceRaw(sessionId, sourceKey, text)
    setStatus('chunking', {
      title: meta0.title || title || 'Untitled',
      subtitle: meta0.subtitle || subtitle,
      rawBytes: Buffer.byteLength(text, 'utf-8'),
    })

    const passages = chunkText(text)
    writeSourcePassages(sessionId, sourceKey, passages)
    setStatus('summarizing', { passageCount: passages.length })

    const sum = await summarizeSource(text, meta0.title || title || 'Untitled')
    setStatus('embedding', sum ? {
      summary: sum.summary,
      topics: sum.topics,
      suggestedQuestions: sum.suggestedQuestions,
    } : {})

    const client = getEmbedClient()
    let embeddedDim = 0
    if (client && passages.length > 0) {
      const matrix = await embedPassages(client, passages)
      if (matrix) {
        writeSourceEmbeddings(sessionId, sourceKey, matrix, EMBED_DIM)
        embeddedDim = EMBED_DIM
      }
    }

    setStatus('ready', { embeddingDim: embeddedDim, processedAt: Date.now() })

    // First source to reach ready → kick off Notebook Guide briefing.
    // `maybeGenerateBriefing` is idempotent so calling on every ready
    // transition is safe; it bails early if briefing already exists.
    void maybeGenerateBriefing(sessionId)
  } catch (e) {
    console.error('[NotebookPipeline] failed for', sessionId, sourceKey, e)
    updateSourceMeta(sessionId, sourceKey, {
      status: 'error',
      error: String(e instanceof Error ? e.message : e),
    })
    const after = getSession(sessionId)
    if (after) emit(sessionId, after.sources[sourceKey])
  }
}
