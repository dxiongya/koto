/**
 * Knowledge Graph — Temporal entity-relationship triples.
 * Stores facts about entities with validity windows.
 * Shares the same SQLite database as memory-store.ts.
 */
import crypto from 'crypto'
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
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
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'unknown',
      properties TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS triples (
      id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object_id TEXT NOT NULL,
      valid_from TEXT,
      valid_to TEXT,
      confidence REAL DEFAULT 1.0,
      source_memory_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_triples_subject ON triples(subject_id);
    CREATE INDEX IF NOT EXISTS idx_triples_object ON triples(object_id);
    CREATE INDEX IF NOT EXISTS idx_triples_predicate ON triples(predicate);
  `)
  return db
}

// ── Types ──

export interface Entity {
  id: string
  name: string
  type: string
  properties: Record<string, unknown>
  createdAt: number
}

export interface Triple {
  id: string
  subjectId: string
  predicate: string
  objectId: string
  validFrom: string | null
  validTo: string | null
  confidence: number
  sourceMemoryId: string | null
  createdAt: number
}

// ── Helpers ──

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '')
}

function ensureEntity(name: string, type = 'unknown'): string {
  const d = getDb()
  const id = slugify(name)
  const existing = d.prepare('SELECT id FROM entities WHERE id = ?').get(id)
  if (!existing) {
    d.prepare('INSERT INTO entities (id, name, type, created_at) VALUES (?, ?, ?, ?)').run(id, name, type, Date.now())
  }
  return id
}

// ── Entity Operations ──

export function getEntity(id: string): Entity | null {
  const row = getDb().prepare('SELECT * FROM entities WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    id: row.id as string, name: row.name as string, type: row.type as string,
    properties: JSON.parse((row.properties as string) || '{}'), createdAt: row.created_at as number,
  }
}

export function listEntities(): Entity[] {
  return (getDb().prepare('SELECT * FROM entities ORDER BY name').all() as Record<string, unknown>[]).map(r => ({
    id: r.id as string, name: r.name as string, type: r.type as string,
    properties: JSON.parse((r.properties as string) || '{}'), createdAt: r.created_at as number,
  }))
}

// ── Triple Operations ──

export function addTriple(
  subject: string, predicate: string, object: string,
  opts?: { validFrom?: string; sourceMemoryId?: string; confidence?: number },
): Triple {
  const d = getDb()
  const subjectId = ensureEntity(subject)
  const objectId = ensureEntity(object)
  const id = crypto.randomUUID()
  const now = Date.now()

  d.prepare(`INSERT INTO triples (id, subject_id, predicate, object_id, valid_from, confidence, source_memory_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, subjectId, predicate, objectId,
    opts?.validFrom || new Date().toISOString().slice(0, 10),
    opts?.confidence ?? 1.0, opts?.sourceMemoryId || null, now,
  )

  return {
    id, subjectId, predicate, objectId,
    validFrom: opts?.validFrom || new Date().toISOString().slice(0, 10),
    validTo: null, confidence: opts?.confidence ?? 1.0,
    sourceMemoryId: opts?.sourceMemoryId || null, createdAt: now,
  }
}

export function invalidateTriple(subject: string, predicate: string, object: string, ended?: string): boolean {
  const subjectId = slugify(subject)
  const objectId = slugify(object)
  const endDate = ended || new Date().toISOString().slice(0, 10)
  return getDb().prepare('UPDATE triples SET valid_to = ? WHERE subject_id = ? AND predicate = ? AND object_id = ? AND valid_to IS NULL')
    .run(endDate, subjectId, predicate, objectId).changes > 0
}

export function queryEntity(
  entity: string,
  opts?: { asOf?: string; direction?: 'outgoing' | 'incoming' | 'both' },
): { entity: Entity | null; outgoing: Triple[]; incoming: Triple[] } {
  const d = getDb()
  const entityId = slugify(entity)
  const ent = getEntity(entityId)
  const dir = opts?.direction || 'both'
  const asOf = opts?.asOf

  let outgoing: Triple[] = []
  let incoming: Triple[] = []

  if (dir === 'outgoing' || dir === 'both') {
    let sql = 'SELECT * FROM triples WHERE subject_id = ?'
    const params: unknown[] = [entityId]
    if (asOf) {
      sql += " AND (valid_from IS NULL OR valid_from <= ?) AND (valid_to IS NULL OR valid_to >= ?)"
      params.push(asOf, asOf)
    }
    outgoing = (d.prepare(sql).all(...params) as Record<string, unknown>[]).map(rowToTriple)
  }

  if (dir === 'incoming' || dir === 'both') {
    let sql = 'SELECT * FROM triples WHERE object_id = ?'
    const params: unknown[] = [entityId]
    if (asOf) {
      sql += " AND (valid_from IS NULL OR valid_from <= ?) AND (valid_to IS NULL OR valid_to >= ?)"
      params.push(asOf, asOf)
    }
    incoming = (d.prepare(sql).all(...params) as Record<string, unknown>[]).map(rowToTriple)
  }

  return { entity: ent, outgoing, incoming }
}

export function getKgStats(): { entities: number; triples: number; activeFacts: number; predicateTypes: string[] } {
  const d = getDb()
  const entities = (d.prepare('SELECT COUNT(*) as c FROM entities').get() as { c: number }).c
  const triples = (d.prepare('SELECT COUNT(*) as c FROM triples').get() as { c: number }).c
  const activeFacts = (d.prepare('SELECT COUNT(*) as c FROM triples WHERE valid_to IS NULL').get() as { c: number }).c
  const predicates = (d.prepare('SELECT DISTINCT predicate FROM triples').all() as { predicate: string }[]).map(r => r.predicate)
  return { entities, triples, activeFacts, predicateTypes: predicates }
}

function rowToTriple(row: Record<string, unknown>): Triple {
  return {
    id: row.id as string, subjectId: row.subject_id as string,
    predicate: row.predicate as string, objectId: row.object_id as string,
    validFrom: row.valid_from as string | null, validTo: row.valid_to as string | null,
    confidence: row.confidence as number, sourceMemoryId: row.source_memory_id as string | null,
    createdAt: row.created_at as number,
  }
}
