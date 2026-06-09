/**
 * Notebook storage — flat filesystem layout under `{liteHome}/notebooks/`.
 *
 * Storage choice rationale:
 *   - sessions are few and small → JSON-per-file beats a DB for inspectability
 *   - per-source artifacts (raw.md, passages.json, embeddings.bin) are best as
 *     files because (a) raw.md is human-readable and (b) embeddings.bin is a
 *     dense float32 buffer that we mmap-read at search time
 *   - chat history is append-only → JSONL beats rewriting an array on every turn
 *
 * Everything goes through the helpers in this file. Callers never touch paths.
 */
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { getLiteHome } from './lite-home'
import type {
  Session,
  SessionSummary,
  SourceMeta,
  SourcePassage,
  SourceRef,
} from '../../shared/notebook'
import { sourceRefKey } from '../../shared/notebook'

// ─── Path helpers ───────────────────────────────────────────────────

function notebooksRoot(): string {
  const dir = path.join(getLiteHome(), 'notebooks')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function sessionDir(id: string): string {
  return path.join(notebooksRoot(), id)
}

function sessionFile(id: string): string {
  return path.join(sessionDir(id), 'session.json')
}

function sourcesDir(sessionId: string): string {
  return path.join(sessionDir(sessionId), 'sources')
}

function sourceDir(sessionId: string, key: string): string {
  return path.join(sourcesDir(sessionId), key)
}

function sourceMetaFile(sessionId: string, key: string): string {
  return path.join(sourceDir(sessionId, key), 'meta.json')
}

function sourceRawFile(sessionId: string, key: string): string {
  return path.join(sourceDir(sessionId, key), 'raw.md')
}

function sourcePassagesFile(sessionId: string, key: string): string {
  return path.join(sourceDir(sessionId, key), 'passages.json')
}

function sourceEmbeddingsFile(sessionId: string, key: string): string {
  return path.join(sourceDir(sessionId, key), 'embeddings.bin')
}

function chatPath(sessionId: string): string {
  return path.join(sessionDir(sessionId), 'chat.jsonl')
}

// ─── Session CRUD ───────────────────────────────────────────────────

export function listSessions(): SessionSummary[] {
  const root = notebooksRoot()
  if (!fs.existsSync(root)) return []
  const out: SessionSummary[] = []
  for (const name of fs.readdirSync(root)) {
    const file = path.join(root, name, 'session.json')
    if (!fs.existsSync(file)) continue
    try {
      const s = JSON.parse(fs.readFileSync(file, 'utf-8')) as Session
      const sources = Object.values(s.sources)
      out.push({
        id: s.id,
        name: s.name,
        sourceCount: sources.length,
        readyCount: sources.filter((x) => x.status === 'ready').length,
        updatedAt: s.updatedAt,
      })
    } catch {
      // Skip corrupt session files — don't block list rendering.
    }
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt)
  return out
}

export function getSession(id: string): Session | null {
  try {
    const raw = fs.readFileSync(sessionFile(id), 'utf-8')
    return JSON.parse(raw) as Session
  } catch {
    return null
  }
}

export function createSession(name: string): Session {
  const id = randomUUID()
  const now = Date.now()
  const s: Session = {
    id,
    name: name.trim() || 'Untitled notebook',
    sources: {},
    products: [],
    createdAt: now,
    updatedAt: now,
  }
  fs.mkdirSync(sessionDir(id), { recursive: true })
  fs.mkdirSync(sourcesDir(id), { recursive: true })
  fs.writeFileSync(sessionFile(id), JSON.stringify(s, null, 2), 'utf-8')
  return s
}

/** Whole-document save. Caller-side mutation pattern: `s = getSession(id);
 *  mutate s; saveSession(s);` */
export function saveSession(s: Session): Session {
  const merged: Session = { ...s, updatedAt: Date.now() }
  fs.writeFileSync(sessionFile(merged.id), JSON.stringify(merged, null, 2), 'utf-8')
  return merged
}

export function deleteSession(id: string): boolean {
  try {
    fs.rmSync(sessionDir(id), { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

// ─── Source CRUD ────────────────────────────────────────────────────

/** Register a source on a session — initializes meta + creates per-source dir.
 *  Returns the freshly-created meta (status='pending'). Caller is responsible
 *  for running the processing pipeline next. */
export function registerSource(sessionId: string, ref: SourceRef, title: string, subtitle?: string): SourceMeta | null {
  const s = getSession(sessionId)
  if (!s) return null
  const key = sourceRefKey(ref)
  fs.mkdirSync(sourceDir(sessionId, key), { recursive: true })

  const existing = s.sources[key]
  const meta: SourceMeta = {
    key,
    ref,
    title,
    subtitle,
    status: 'pending',
    addedAt: existing?.addedAt ?? Date.now(),
    selected: existing?.selected ?? true,
  }
  s.sources[key] = meta
  saveSession(s)
  fs.writeFileSync(sourceMetaFile(sessionId, key), JSON.stringify(meta, null, 2), 'utf-8')
  return meta
}

export function updateSourceMeta(sessionId: string, key: string, patch: Partial<SourceMeta>): SourceMeta | null {
  const s = getSession(sessionId)
  if (!s) return null
  const cur = s.sources[key]
  if (!cur) return null
  const next: SourceMeta = { ...cur, ...patch, key, ref: cur.ref }
  s.sources[key] = next
  saveSession(s)
  fs.writeFileSync(sourceMetaFile(sessionId, key), JSON.stringify(next, null, 2), 'utf-8')
  return next
}

export function removeSource(sessionId: string, key: string): boolean {
  const s = getSession(sessionId)
  if (!s || !s.sources[key]) return false
  delete s.sources[key]
  saveSession(s)
  try { fs.rmSync(sourceDir(sessionId, key), { recursive: true, force: true }) } catch {/* ignore */}
  return true
}

// ─── Per-source artifact I/O ────────────────────────────────────────

export function writeSourceRaw(sessionId: string, key: string, content: string): void {
  fs.mkdirSync(sourceDir(sessionId, key), { recursive: true })
  fs.writeFileSync(sourceRawFile(sessionId, key), content, 'utf-8')
}

export function readSourceRaw(sessionId: string, key: string): string | null {
  try { return fs.readFileSync(sourceRawFile(sessionId, key), 'utf-8') } catch { return null }
}

export function writeSourcePassages(sessionId: string, key: string, passages: SourcePassage[]): void {
  fs.writeFileSync(sourcePassagesFile(sessionId, key), JSON.stringify(passages), 'utf-8')
}

export function readSourcePassages(sessionId: string, key: string): SourcePassage[] {
  try {
    return JSON.parse(fs.readFileSync(sourcePassagesFile(sessionId, key), 'utf-8')) as SourcePassage[]
  } catch {
    return []
  }
}

export function getPassage(sessionId: string, key: string, passageId: string): SourcePassage | null {
  return readSourcePassages(sessionId, key).find((p) => p.id === passageId) ?? null
}

/** Write a [n × dim] float32 embedding matrix laid out row-major.
 *  Convention: caller maintains matching `passages[i]` ↔ row i. */
export function writeSourceEmbeddings(sessionId: string, key: string, matrix: Float32Array, dim: number): void {
  // Sanity: row count must divide evenly.
  if (matrix.length % dim !== 0) throw new Error(`embedding length ${matrix.length} not divisible by dim ${dim}`)
  fs.writeFileSync(sourceEmbeddingsFile(sessionId, key), Buffer.from(matrix.buffer, matrix.byteOffset, matrix.byteLength))
}

/** Read the embedding matrix. `dim` is required so corrupted files can be
 *  rejected (length must be a multiple of dim*4 bytes). */
export function readSourceEmbeddings(sessionId: string, key: string, dim: number): Float32Array | null {
  try {
    const buf = fs.readFileSync(sourceEmbeddingsFile(sessionId, key))
    if (buf.byteLength % (dim * 4) !== 0) return null
    return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  } catch {
    return null
  }
}

// ─── Chat log (append-only JSONL) ───────────────────────────────────

/** Append a chat event line. `event` is an opaque object — we don't strongly
 *  type it here because pi-agent-core's AgentMessage union is broad. The
 *  agent layer is responsible for shape. */
export function appendChatEvent(sessionId: string, event: unknown): void {
  const line = JSON.stringify(event) + '\n'
  fs.appendFileSync(chatPath(sessionId), line, 'utf-8')
}

export function readChatLog(sessionId: string): unknown[] {
  try {
    const raw = fs.readFileSync(chatPath(sessionId), 'utf-8')
    return raw.split('\n').filter(Boolean).map((line) => {
      try { return JSON.parse(line) } catch { return null }
    }).filter((x): x is unknown => x !== null)
  } catch {
    return []
  }
}

/** Reset chat (used by 'reset notebook conversation' action). */
export function truncateChatLog(sessionId: string): void {
  try { fs.writeFileSync(chatPath(sessionId), '', 'utf-8') } catch {/* ignore */}
}
