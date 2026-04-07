/**
 * Memory Store — SQLite storage for AI memories.
 * Palace hierarchy: Wing → Room → Memory (Drawer)
 * Full-text search via FTS5.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import Database from 'better-sqlite3'
import { getLiteHome } from './lite-home'

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (db) return db

  const dir = path.join(getLiteHome(), 'memory')
  fs.mkdirSync(dir, { recursive: true })

  db = new Database(path.join(dir, 'memory.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS wings (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      wing_id TEXT NOT NULL REFERENCES wings(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rooms_wing ON rooms(wing_id);

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      wing_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      content TEXT NOT NULL,
      summary TEXT DEFAULT '',
      hall TEXT DEFAULT 'general',
      importance INTEGER DEFAULT 3,
      source TEXT DEFAULT 'mcp',
      meta TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memories_wing ON memories(wing_id);
    CREATE INDEX IF NOT EXISTS idx_memories_room ON memories(room_id);
    CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content, summary,
      content=memories, content_rowid=rowid
    );

    -- FTS sync triggers
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content, summary)
      VALUES (new.rowid, new.content, new.summary);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, summary)
      VALUES ('delete', old.rowid, old.content, old.summary);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, summary)
      VALUES ('delete', old.rowid, old.content, old.summary);
      INSERT INTO memories_fts(rowid, content, summary)
      VALUES (new.rowid, new.content, new.summary);
    END;

    -- Embedding vectors
    CREATE TABLE IF NOT EXISTS memory_vectors (
      memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
      vector BLOB NOT NULL,
      embedded_at INTEGER NOT NULL
    );

    -- Identity (Layer 0)
    CREATE TABLE IF NOT EXISTS identity (
      key TEXT PRIMARY KEY DEFAULT 'default',
      content TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );
  `)

  return db
}

// ── Types ──

export interface Memory {
  id: string
  wingId: string
  roomId: string
  content: string
  summary: string
  hall: string
  importance: number
  source: string
  meta: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface Wing {
  id: string
  name: string
  description: string
  createdAt: number
}

export interface Room {
  id: string
  wingId: string
  name: string
  description: string
  createdAt: number
}

// ── Helpers ──

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '')
}

function genId(): string {
  return crypto.randomUUID()
}

function rowToMemory(row: Record<string, unknown>): Memory {
  return {
    id: row.id as string,
    wingId: row.wing_id as string,
    roomId: row.room_id as string,
    content: row.content as string,
    summary: (row.summary as string) || '',
    hall: (row.hall as string) || 'general',
    importance: (row.importance as number) || 3,
    source: (row.source as string) || 'mcp',
    meta: JSON.parse((row.meta as string) || '{}'),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

// ── Wings ──

export function ensureWing(id: string, name?: string): Wing {
  const d = getDb()
  const existing = d.prepare('SELECT * FROM wings WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (existing) return { id: existing.id as string, name: existing.name as string, description: existing.description as string || '', createdAt: existing.created_at as number }

  const now = Date.now()
  d.prepare('INSERT INTO wings (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, name || id, now, now)
  return { id, name: name || id, description: '', createdAt: now }
}

export function listWings(): (Wing & { memoryCount: number })[] {
  const rows = getDb().prepare(`
    SELECT w.*, COUNT(m.id) as memory_count
    FROM wings w LEFT JOIN memories m ON m.wing_id = w.id
    GROUP BY w.id ORDER BY w.name
  `).all() as Record<string, unknown>[]
  return rows.map(r => ({
    id: r.id as string, name: r.name as string, description: (r.description as string) || '',
    createdAt: r.created_at as number, memoryCount: (r.memory_count as number) || 0,
  }))
}

// ── Rooms ──

export function ensureRoom(id: string, wingId: string, name?: string): Room {
  const d = getDb()
  ensureWing(wingId)
  const existing = d.prepare('SELECT * FROM rooms WHERE id = ? AND wing_id = ?').get(id, wingId) as Record<string, unknown> | undefined
  if (existing) return { id: existing.id as string, wingId: existing.wing_id as string, name: existing.name as string, description: '', createdAt: existing.created_at as number }

  const now = Date.now()
  d.prepare('INSERT OR IGNORE INTO rooms (id, wing_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, wingId, name || id, now, now)
  return { id, wingId, name: name || id, description: '', createdAt: now }
}

export function listRooms(wingId: string): (Room & { memoryCount: number })[] {
  const rows = getDb().prepare(`
    SELECT r.*, COUNT(m.id) as memory_count
    FROM rooms r LEFT JOIN memories m ON m.room_id = r.id AND m.wing_id = r.wing_id
    WHERE r.wing_id = ?
    GROUP BY r.id ORDER BY r.name
  `).all(wingId) as Record<string, unknown>[]
  return rows.map(r => ({
    id: r.id as string, wingId: r.wing_id as string, name: r.name as string,
    description: '', createdAt: r.created_at as number, memoryCount: (r.memory_count as number) || 0,
  }))
}

// ── Memories ──

export function storeMemory(wingId: string, roomId: string, content: string, opts?: {
  hall?: string; importance?: number; summary?: string; source?: string; meta?: Record<string, unknown>
}): Memory {
  const d = getDb()
  const wingSlug = slugify(wingId)
  const roomSlug = slugify(roomId)
  ensureWing(wingSlug, wingId)
  ensureRoom(roomSlug, wingSlug, roomId)

  const id = genId()
  const now = Date.now()
  d.prepare(`INSERT INTO memories (id, wing_id, room_id, content, summary, hall, importance, source, meta, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, wingSlug, roomSlug, content,
    opts?.summary || '', opts?.hall || 'general', opts?.importance || 3,
    opts?.source || 'mcp', JSON.stringify(opts?.meta || {}), now, now,
  )
  return { id, wingId: wingSlug, roomId: roomSlug, content, summary: opts?.summary || '',
    hall: opts?.hall || 'general', importance: opts?.importance || 3, source: opts?.source || 'mcp',
    meta: opts?.meta || {}, createdAt: now, updatedAt: now }
}

export function getMemory(id: string): Memory | null {
  const row = getDb().prepare('SELECT * FROM memories WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? rowToMemory(row) : null
}

export function listMemories(wingId?: string, roomId?: string, limit = 50, offset = 0): Memory[] {
  let sql = 'SELECT * FROM memories'
  const params: unknown[] = []
  const conditions: string[] = []
  if (wingId) { conditions.push('wing_id = ?'); params.push(wingId) }
  if (roomId) { conditions.push('room_id = ?'); params.push(roomId) }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ')
  sql += ' ORDER BY importance DESC, created_at DESC LIMIT ? OFFSET ?'
  params.push(limit, offset)
  return (getDb().prepare(sql).all(...params) as Record<string, unknown>[]).map(rowToMemory)
}

export function deleteMemory(id: string): boolean {
  return getDb().prepare('DELETE FROM memories WHERE id = ?').run(id).changes > 0
}

export function countMemories(wingId?: string): number {
  if (wingId) {
    return (getDb().prepare('SELECT COUNT(*) as c FROM memories WHERE wing_id = ?').get(wingId) as { c: number }).c
  }
  return (getDb().prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number }).c
}

// ── FTS Search ──

export function searchMemories(query: string, wingId?: string, roomId?: string, limit = 10): (Memory & { score: number })[] {
  if (!query) return []
  const d = getDb()

  // FTS5 search
  let sql = `SELECT m.*, rank as fts_rank FROM memories_fts fts
    JOIN memories m ON m.rowid = fts.rowid
    WHERE memories_fts MATCH ?`
  const params: unknown[] = [query]
  if (wingId) { sql += ' AND m.wing_id = ?'; params.push(wingId) }
  if (roomId) { sql += ' AND m.room_id = ?'; params.push(roomId) }
  sql += ' ORDER BY rank LIMIT ?'
  params.push(limit)

  try {
    const rows = d.prepare(sql).all(...params) as (Record<string, unknown> & { fts_rank: number })[]
    return rows.map(r => ({ ...rowToMemory(r), score: Math.abs(r.fts_rank) }))
  } catch {
    // FTS query syntax error — fallback to LIKE
    const likeSql = `SELECT * FROM memories WHERE content LIKE ?
      ${wingId ? 'AND wing_id = ?' : ''} ${roomId ? 'AND room_id = ?' : ''}
      ORDER BY importance DESC LIMIT ?`
    const likeParams: unknown[] = [`%${query}%`]
    if (wingId) likeParams.push(wingId)
    if (roomId) likeParams.push(roomId)
    likeParams.push(limit)
    return (d.prepare(likeSql).all(...likeParams) as Record<string, unknown>[]).map(r => ({ ...rowToMemory(r), score: 1 }))
  }
}

// ── Taxonomy ──

export function getTaxonomy(): { wings: { id: string; name: string; rooms: { id: string; name: string; count: number }[]; count: number }[] } {
  const wings = listWings()
  return {
    wings: wings.map(w => {
      const rooms = listRooms(w.id)
      return {
        id: w.id, name: w.name, count: w.memoryCount,
        rooms: rooms.map(r => ({ id: r.id, name: r.name, count: r.memoryCount })),
      }
    }),
  }
}

// ── Identity (Layer 0) ──

export function getIdentity(): string {
  const row = getDb().prepare("SELECT content FROM identity WHERE key = 'default'").get() as { content: string } | undefined
  return row?.content || ''
}

export function setIdentity(content: string): void {
  const d = getDb()
  const now = Date.now()
  d.prepare("INSERT OR REPLACE INTO identity (key, content, updated_at) VALUES ('default', ?, ?)").run(content, now)
}

// ── Layer 1: Essential Story ──

export function getEssentialMemories(limit = 20): Memory[] {
  return (getDb().prepare('SELECT * FROM memories WHERE importance >= 4 ORDER BY importance DESC, created_at DESC LIMIT ?')
    .all(limit) as Record<string, unknown>[]).map(rowToMemory)
}

// ── Status ──

export function getMemoryStatus(): {
  totalMemories: number; totalWings: number; totalRooms: number;
  topWings: { id: string; name: string; count: number }[]
} {
  const d = getDb()
  const totalMemories = (d.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number }).c
  const totalWings = (d.prepare('SELECT COUNT(*) as c FROM wings').get() as { c: number }).c
  const totalRooms = (d.prepare('SELECT COUNT(*) as c FROM rooms').get() as { c: number }).c
  const topWings = listWings().sort((a, b) => b.memoryCount - a.memoryCount).slice(0, 5)
    .map(w => ({ id: w.id, name: w.name, count: w.memoryCount }))
  return { totalMemories, totalWings, totalRooms, topWings }
}

// ── Vectors ──

export function saveMemoryVector(memoryId: string, vector: Float64Array | number[]): void {
  const buf = Buffer.from(new Float64Array(vector).buffer)
  getDb().prepare('INSERT OR REPLACE INTO memory_vectors (memory_id, vector, embedded_at) VALUES (?, ?, ?)')
    .run(memoryId, buf, Date.now())
}

export function getMemoryVector(memoryId: string): number[] | null {
  const row = getDb().prepare('SELECT vector FROM memory_vectors WHERE memory_id = ?').get(memoryId) as { vector: Buffer } | undefined
  if (!row) return null
  return Array.from(new Float64Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 8))
}

export function getAllMemoryVectors(): { memoryId: string; vector: number[] }[] {
  const rows = getDb().prepare('SELECT memory_id, vector FROM memory_vectors').all() as { memory_id: string; vector: Buffer }[]
  return rows.map(r => ({
    memoryId: r.memory_id,
    vector: Array.from(new Float64Array(r.vector.buffer, r.vector.byteOffset, r.vector.byteLength / 8)),
  }))
}
