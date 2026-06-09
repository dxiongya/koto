/**
 * Notebook V2 — data model for the agent (NotebookLM-style) mode.
 *
 * Storage lives at `{liteHome}/notebooks/<sessionId>/`:
 *
 *     session.json           — top-level Session record
 *     chat.jsonl             — append-only log of AgentMessages (see notebook-chat-log)
 *     sources/<srcKey>/      — one folder per source, contains processing artifacts:
 *         meta.json          — { kind, ref, title, summary, topics, suggested, status }
 *         raw.md             — extracted text (post-OCR / post-transcript)
 *         passages.json      — chunked passages with offsets
 *         embeddings.bin     — float32 [n × dim] passage embeddings
 *     products/              — agent-generated artifacts (reports etc.)
 *
 * Sessions are **light** — they only reference content. Source content
 * physically lives either in Collector (for web-discovered items) or at
 * its original Koto resource location (Notes / Wiki / Memory). The
 * per-source folder under `sources/` holds *derived* artifacts only:
 * extracted text + chunks + embeddings + LLM-generated metadata.
 */

// ─────────────────────────────────────────────────────────────────────
// Source references — polymorphic pointers to any text-bearing resource
// ─────────────────────────────────────────────────────────────────────

export type SourceRef =
  /** Any item in Koto's Collector (link, screenshot+OCR, tweet, video meta, …). */
  | { kind: 'collector'; itemId: string }
  /** A .md file in Notes. */
  | { kind: 'note'; path: string }
  /** A page in the Wiki. */
  | { kind: 'wiki'; relPath: string }
  /** A Memory entity. */
  | { kind: 'memory'; entityId: string }
  /** Pasted text — no persistent home outside the notebook. */
  | { kind: 'inline'; content: string }

/** Stable string key derived from a SourceRef, used as folder name + citation id. */
export function sourceRefKey(ref: SourceRef): string {
  switch (ref.kind) {
    case 'collector': return `c-${ref.itemId}`
    case 'note':      return `n-${hashShort(ref.path)}`
    case 'wiki':      return `w-${hashShort(ref.relPath)}`
    case 'memory':    return `m-${ref.entityId}`
    case 'inline':    return `i-${hashShort(ref.content.slice(0, 200))}`
  }
}

/** Fast non-crypto hash → short hex string. Stable across process restarts. */
function hashShort(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

// ─────────────────────────────────────────────────────────────────────
// Per-source processing artifacts
// ─────────────────────────────────────────────────────────────────────

export type SourceStatus =
  | 'pending'     // queued, no text yet
  | 'fetching'    // pulling raw content from origin
  | 'chunking'    // text split + passages persisted
  | 'embedding'   // vector index being built
  | 'summarizing' // LLM generating summary + topics + suggested questions
  | 'ready'       // all artifacts on disk
  | 'error'

export interface SourcePassage {
  /** Stable id within source (p0, p1, …). Used in citations. */
  id: string
  text: string
  /** Character offsets within raw.md, for highlight-on-click. */
  start: number
  end: number
}

export interface SourceMeta {
  /** sourceRefKey(ref). */
  key: string
  ref: SourceRef
  /** Display title shown in the sources column. */
  title: string
  /** Short subtitle (URL, file path, etc.). */
  subtitle?: string
  status: SourceStatus
  /** Last-stage error message when status === 'error'. */
  error?: string
  /** Auto-generated 1-paragraph summary (LLM). */
  summary?: string
  /** 5-8 short topic phrases. */
  topics?: string[]
  /** 3-5 suggested questions specific to this source. */
  suggestedQuestions?: string[]
  /** Number of passages in passages.json. */
  passageCount?: number
  /** Embedding dimension in embeddings.bin (0 if not built). */
  embeddingDim?: number
  /** When the most recent processing finished. */
  processedAt?: number
  /** Bytes of raw.md (for UI display). */
  rawBytes?: number
  addedAt: number
  /** Selected = participates in the next chat / studio turn. */
  selected: boolean
}

// ─────────────────────────────────────────────────────────────────────
// Session
// ─────────────────────────────────────────────────────────────────────

export interface NotebookProduct {
  id: string
  /** 'report' for now; extend as Studio outputs grow. */
  type: 'report' | 'mindmap' | 'quiz' | 'flashcards' | 'slide-deck'
  /** Pointer to where the product lives. For 'report': path to a .md in Notes. */
  targetPath: string
  label: string
  createdAt: number
}

export interface Session {
  id: string
  name: string
  /** Free-form Custom Goals / Persona — applied to system prompt + Studio.
   *  Up to ~10k chars; we trust the user not to abuse this. */
  customGoals?: string
  /** Collector group name owned by this session (for web-discovered sources).
   *  Created lazily on first Discover/Import. */
  collectorGroup?: string
  /** Source metas indexed by sourceRefKey — single source of truth for the UI. */
  sources: Record<string, SourceMeta>
  /** Generated outputs the session has produced. */
  products: NotebookProduct[]
  createdAt: number
  updatedAt: number
}

export interface SessionSummary {
  id: string
  name: string
  sourceCount: number
  readyCount: number
  updatedAt: number
}
