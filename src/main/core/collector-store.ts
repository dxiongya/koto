/**
 * Collector Store — SQLite-backed with FTS5 full-text search.
 * Migrates from JSON on first run.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import Database from 'better-sqlite3'
import { getLiteHome } from './lite-home'
import type { CollectedItem, CollectorAddInput } from '../../shared/types'

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (db) return db

  const dir = path.join(getLiteHome(), 'collected')
  fs.mkdirSync(dir, { recursive: true })

  db = new Database(path.join(dir, 'collector.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      url TEXT,
      asset_path TEXT,
      thumbnail_path TEXT,
      "group" TEXT NOT NULL DEFAULT 'all',
      source TEXT NOT NULL DEFAULT '',
      meta TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS groups (
      name TEXT PRIMARY KEY
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
      title, note, url, meta,
      content=items, content_rowid=rowid
    );

    -- Triggers to keep FTS in sync
    CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
      INSERT INTO items_fts(rowid, title, note, url, meta) VALUES (new.rowid, new.title, new.note, new.url, new.meta);
    END;
    CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
      INSERT INTO items_fts(items_fts, rowid, title, note, url, meta) VALUES ('delete', old.rowid, old.title, old.note, old.url, old.meta);
    END;
    CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
      INSERT INTO items_fts(items_fts, rowid, title, note, url, meta) VALUES ('delete', old.rowid, old.title, old.note, old.url, old.meta);
      INSERT INTO items_fts(rowid, title, note, url, meta) VALUES (new.rowid, new.title, new.note, new.url, new.meta);
    END;

    -- Vectors table for embedding search
    CREATE TABLE IF NOT EXISTS vectors (
      item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
      vector BLOB NOT NULL,
      embedded_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_items_url ON items(url);
    CREATE INDEX IF NOT EXISTS idx_items_group ON items("group");

    -- Group sync automation configs
    CREATE TABLE IF NOT EXISTS group_sync_configs (
      group_name TEXT PRIMARY KEY,
      adapter TEXT NOT NULL DEFAULT 'custom',
      script_path TEXT,
      schedule TEXT NOT NULL DEFAULT 'manual',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_sync_at INTEGER,
      last_sync_status TEXT,
      last_sync_error TEXT,
      last_sync_items_added INTEGER DEFAULT 0,
      sync_count INTEGER DEFAULT 0,
      adapter_config TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)

  // Migrate from JSON if exists
  migrateFromJson(db)

  // Backfill content hashes for existing asset items
  backfillContentHashes(db)

  // Backfill searchable note column (merge meta description/ocrText into note)
  backfillSearchableNote(db)

  return db
}

/**
 * One-time: merge meta.description / meta.imageDescription / meta.ocrText
 * into the `note` column so FTS5/LIKE search can find them via the high-weight
 * `note` column instead of the low-weight raw `meta` JSON blob.
 *
 * Uses PRAGMA user_version to run only once. Bump version when schema/backfill
 * logic changes so migrations re-run as needed.
 */
const SEARCH_INDEX_VERSION = 1
function backfillSearchableNote(database: Database.Database): void {
  const row = database.prepare('PRAGMA user_version').get() as { user_version: number }
  if (row.user_version >= SEARCH_INDEX_VERSION) return

  const items = database.prepare('SELECT id, note, meta FROM items').all() as Array<{
    id: string; note: string; meta: string
  }>
  if (items.length === 0) {
    database.pragma(`user_version = ${SEARCH_INDEX_VERSION}`)
    return
  }

  const update = database.prepare('UPDATE items SET note = ? WHERE id = ?')
  let updated = 0

  database.transaction(() => {
    for (const item of items) {
      let meta: Record<string, unknown> = {}
      try { meta = JSON.parse(item.meta || '{}') } catch { /* ignore */ }

      // Collect all searchable text (dedupe)
      const parts: string[] = []
      const seen = new Set<string>()
      const push = (s: unknown): void => {
        if (typeof s !== 'string') return
        const trimmed = s.trim()
        if (!trimmed || seen.has(trimmed)) return
        seen.add(trimmed)
        parts.push(trimmed)
      }
      push(item.note)
      push(meta.description)
      push(meta.imageDescription)  // from AI description
      push(meta.ocrText)

      const newNote = parts.join('\n')
      if (newNote !== item.note) {
        update.run(newNote, item.id)
        updated++
      }
    }
  })()

  database.pragma(`user_version = ${SEARCH_INDEX_VERSION}`)
  if (updated > 0) console.log(`[Collector] Backfilled searchable note for ${updated} items`)
}

/** One-time: add contentHash to items that have assets but no hash */
function backfillContentHashes(database: Database.Database): void {
  const rows = database.prepare(
    "SELECT id, asset_path, meta FROM items WHERE asset_path IS NOT NULL AND json_extract(meta, '$.contentHash') IS NULL"
  ).all() as { id: string; asset_path: string; meta: string }[]

  if (rows.length === 0) return

  const update = database.prepare("UPDATE items SET meta = ? WHERE id = ?")
  let count = 0
  for (const row of rows) {
    const fullPath = path.join(getLiteHome(), 'collected', row.asset_path)
    if (!fs.existsSync(fullPath)) continue
    try {
      const data = fs.readFileSync(fullPath)
      const hash = crypto.createHash('sha256').update(data).digest('hex').slice(0, 16)
      const meta = JSON.parse(row.meta || '{}')
      meta.contentHash = hash
      update.run(JSON.stringify(meta), row.id)
      count++
    } catch { /* skip */ }
  }
  if (count > 0) console.log(`[Collector] Backfilled content hash for ${count} items`)
}

/** One-time migration from items.json + groups.json → SQLite */
function migrateFromJson(database: Database.Database): void {
  const jsonPath = path.join(getLiteHome(), 'collected', 'items.json')
  if (!fs.existsSync(jsonPath)) return

  try {
    const items: CollectedItem[] = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
    if (items.length === 0) { fs.unlinkSync(jsonPath); return }

    // Check if already migrated
    const count = database.prepare('SELECT COUNT(*) as c FROM items').get() as { c: number }
    if (count.c > 0) { fs.unlinkSync(jsonPath); return }

    const insert = database.prepare(`
      INSERT OR IGNORE INTO items (id, type, title, note, url, asset_path, thumbnail_path, "group", source, meta, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const tx = database.transaction(() => {
      for (const item of items) {
        insert.run(
          item.id, item.type, item.title, item.note || '',
          item.url || null, item.assetPath || null, item.thumbnailPath || null,
          item.group || 'all', item.source || '', JSON.stringify(item.meta || {}),
          item.createdAt, item.updatedAt
        )
      }
    })
    tx()

    // Migrate groups
    const groupsPath = path.join(getLiteHome(), 'collected', 'groups.json')
    if (fs.existsSync(groupsPath)) {
      try {
        const groups: string[] = JSON.parse(fs.readFileSync(groupsPath, 'utf-8'))
        const insertGroup = database.prepare('INSERT OR IGNORE INTO groups (name) VALUES (?)')
        for (const g of groups) insertGroup.run(g)
        fs.renameSync(groupsPath, groupsPath + '.migrated')
      } catch {}
    }

    // Rename old file
    fs.renameSync(jsonPath, jsonPath + '.migrated')
    console.log(`[Collector] Migrated ${items.length} items from JSON to SQLite`)
  } catch (e) {
    console.error('[Collector] Migration failed:', e)
  }
}

function rowToItem(row: Record<string, unknown>): CollectedItem {
  return {
    id: row.id as string,
    type: row.type as CollectedItem['type'],
    title: row.title as string,
    note: row.note as string,
    url: row.url as string | undefined,
    assetPath: row.asset_path as string | undefined,
    thumbnailPath: row.thumbnail_path as string | undefined,
    group: row.group as string,
    source: row.source as string,
    meta: JSON.parse((row.meta as string) || '{}'),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

function generateId(): string {
  return crypto.randomBytes(8).toString('hex')
}

// ── CRUD ──

export function listCollectedItems(limit = 0, offset = 0, group?: string): CollectedItem[] {
  if (group && group !== 'all') {
    const sql = limit > 0
      ? 'SELECT * FROM items WHERE "group" = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      : 'SELECT * FROM items WHERE "group" = ? ORDER BY created_at DESC'
    const rows = limit > 0
      ? getDb().prepare(sql).all(group, limit, offset)
      : getDb().prepare(sql).all(group)
    return (rows as Record<string, unknown>[]).map(rowToItem)
  }
  const sql = limit > 0
    ? 'SELECT * FROM items ORDER BY created_at DESC LIMIT ? OFFSET ?'
    : 'SELECT * FROM items ORDER BY created_at DESC'
  const rows = limit > 0
    ? getDb().prepare(sql).all(limit, offset)
    : getDb().prepare(sql).all()
  return (rows as Record<string, unknown>[]).map(rowToItem)
}

export function countCollectedItems(group?: string): number {
  if (group && group !== 'all') {
    return (getDb().prepare('SELECT COUNT(*) as c FROM items WHERE "group" = ?').get(group) as { c: number }).c
  }
  return (getDb().prepare('SELECT COUNT(*) as c FROM items').get() as { c: number }).c
}

/** Check if a URL is already collected */
export function findDuplicateByUrl(url: string): CollectedItem | null {
  const row = getDb().prepare('SELECT * FROM items WHERE url = ? LIMIT 1').get(url) as Record<string, unknown> | undefined
  return row ? rowToItem(row) : null
}

/** Check if an image with the same content hash exists */
export function findDuplicateByHash(hash: string): CollectedItem | null {
  const row = getDb().prepare("SELECT * FROM items WHERE json_extract(meta, '$.contentHash') = ? LIMIT 1").get(hash) as Record<string, unknown> | undefined
  return row ? rowToItem(row) : null
}

/** Compute content hash for binary data */
export function computeContentHash(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16)
}

/**
 * Build the effective searchable note content by merging:
 *   - the original note (if any)
 *   - meta.description (for images and links — often the most useful text)
 *   - meta.ocrText (extracted OCR for images)
 * Duplicates are avoided so the same text isn't repeated.
 * This ensures FTS5/LIKE index finds matches in all these fields via the
 * high-weight `note` column instead of the low-weight raw `meta` JSON blob.
 */
function buildSearchableNote(note: string, meta: Record<string, unknown>): string {
  const parts: string[] = []
  const seen = new Set<string>()
  const push = (s: unknown): void => {
    if (typeof s !== 'string') return
    const trimmed = s.trim()
    if (!trimmed || seen.has(trimmed)) return
    seen.add(trimmed)
    parts.push(trimmed)
  }
  push(note)
  push(meta.description)
  push(meta.ocrText)
  return parts.join('\n')
}

export function addCollectedItem(input: CollectorAddInput): CollectedItem {
  const dir = path.join(getLiteHome(), 'collected')
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true })

  const id = generateId()
  const now = Date.now()

  const meta = { ...(input.meta || {}) }

  let assetPath: string | undefined
  if (input.assetData && input.assetMimeType) {
    // Store content hash for duplicate detection
    meta.contentHash = computeContentHash(Buffer.from(input.assetData))
    const ext = mimeToExt(input.assetMimeType)
    const filename = `${id}.${ext}`
    fs.writeFileSync(path.join(dir, 'assets', filename), Buffer.from(input.assetData))
    assetPath = `assets/${filename}`
  }

  const effectiveNote = buildSearchableNote(input.note || '', meta)

  getDb().prepare(`
    INSERT INTO items (id, type, title, note, url, asset_path, "group", source, meta, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.type, input.title, effectiveNote,
    input.url || null, assetPath || null,
    input.group || 'all', input.source || 'paste',
    JSON.stringify(meta), now, now
  )

  return {
    id, type: input.type, title: input.title, note: effectiveNote,
    url: input.url, assetPath, thumbnailPath: undefined,
    group: input.group || 'all', source: input.source || 'paste',
    meta, createdAt: now, updatedAt: now,
  }
}

export function updateCollectedItem(id: string, patch: Partial<CollectedItem>): CollectedItem | null {
  const db = getDb()
  const existing = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!existing) return null

  const updates: string[] = []
  const values: unknown[] = []

  // Determine effective final note/meta after patch so we can re-sync
  // the searchable note column when meta.description/ocrText change.
  let nextMeta: Record<string, unknown> = {}
  if (patch.meta !== undefined) {
    nextMeta = patch.meta
  } else {
    try { nextMeta = JSON.parse((existing.meta as string) || '{}') } catch { /* ignore */ }
  }
  const baseNote = patch.note !== undefined ? patch.note : (existing.note as string) || ''
  const effectiveNote = (patch.note !== undefined || patch.meta !== undefined)
    ? buildSearchableNote(baseNote, nextMeta)
    : undefined

  if (patch.title !== undefined) { updates.push('title = ?'); values.push(patch.title) }
  if (effectiveNote !== undefined) { updates.push('note = ?'); values.push(effectiveNote) }
  if (patch.url !== undefined) { updates.push('url = ?'); values.push(patch.url) }
  if (patch.group !== undefined) { updates.push('"group" = ?'); values.push(patch.group) }
  if (patch.meta !== undefined) { updates.push('meta = ?'); values.push(JSON.stringify(patch.meta)) }

  if (updates.length === 0) return rowToItem(existing)

  updates.push('updated_at = ?')
  values.push(Date.now())
  values.push(id)

  db.prepare(`UPDATE items SET ${updates.join(', ')} WHERE id = ?`).run(...values)
  const updated = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as Record<string, unknown>
  return rowToItem(updated)
}

/** Find and remove duplicate items in a group (or all). Keeps the oldest, deletes newer duplicates. */
export function deduplicateItems(group?: string): { removed: number; kept: number } {
  const db = getDb()

  // Find duplicates by URL (most common)
  const sql = group && group !== 'all'
    ? `SELECT url, COUNT(*) as cnt, GROUP_CONCAT(id) as ids, MIN(created_at) as oldest
       FROM items WHERE url IS NOT NULL AND url != '' AND "group" = ?
       GROUP BY url HAVING cnt > 1`
    : `SELECT url, COUNT(*) as cnt, GROUP_CONCAT(id) as ids, MIN(created_at) as oldest
       FROM items WHERE url IS NOT NULL AND url != ''
       GROUP BY url HAVING cnt > 1`

  const rows = group && group !== 'all'
    ? db.prepare(sql).all(group) as { url: string; cnt: number; ids: string; oldest: number }[]
    : db.prepare(sql).all() as { url: string; cnt: number; ids: string; oldest: number }[]

  let removed = 0

  for (const row of rows) {
    const allIds = row.ids.split(',')
    // Find the oldest item to keep
    const keepRow = db.prepare('SELECT id FROM items WHERE url = ? ORDER BY created_at ASC LIMIT 1').get(row.url) as { id: string }
    const keepId = keepRow.id

    // Delete all others
    for (const id of allIds) {
      if (id !== keepId) {
        // Delete asset + markdown files
        const item = db.prepare('SELECT asset_path FROM items WHERE id = ?').get(id) as { asset_path: string | null } | undefined
        if (item?.asset_path) {
          try { fs.unlinkSync(path.join(getLiteHome(), 'collected', item.asset_path)) } catch {}
        }
        try { fs.unlinkSync(path.join(getLiteHome(), 'collected', 'markdown', `${id}.md`)) } catch {}

        db.prepare('DELETE FROM items WHERE id = ?').run(id)
        try { db.prepare('DELETE FROM vectors WHERE item_id = ?').run(id) } catch {}
        removed++
      }
    }
  }

  // Also deduplicate by title (for items without URL, like text clips)
  const titleSql = group && group !== 'all'
    ? `SELECT title, COUNT(*) as cnt, GROUP_CONCAT(id) as ids
       FROM items WHERE (url IS NULL OR url = '') AND "group" = ?
       GROUP BY title HAVING cnt > 1`
    : `SELECT title, COUNT(*) as cnt, GROUP_CONCAT(id) as ids
       FROM items WHERE (url IS NULL OR url = '')
       GROUP BY title HAVING cnt > 1`

  const titleRows = group && group !== 'all'
    ? db.prepare(titleSql).all(group) as { title: string; cnt: number; ids: string }[]
    : db.prepare(titleSql).all() as { title: string; cnt: number; ids: string }[]

  for (const row of titleRows) {
    const allIds = row.ids.split(',')
    const keepId = allIds[0] // keep first
    for (const id of allIds.slice(1)) {
      db.prepare('DELETE FROM items WHERE id = ?').run(id)
      removed++
    }
  }

  const total = group && group !== 'all'
    ? (db.prepare('SELECT COUNT(*) as c FROM items WHERE "group" = ?').get(group) as { c: number }).c
    : (db.prepare('SELECT COUNT(*) as c FROM items').get() as { c: number }).c

  return { removed, kept: total }
}

export function deleteCollectedItem(id: string): boolean {
  const db = getDb()
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!item) return false

  // Delete asset file
  if (item.asset_path) {
    const fullPath = path.join(getLiteHome(), 'collected', item.asset_path as string)
    try { fs.unlinkSync(fullPath) } catch {}
  }
  // Delete markdown
  try { fs.unlinkSync(path.join(getLiteHome(), 'collected', 'markdown', `${id}.md`)) } catch {}

  db.prepare('DELETE FROM items WHERE id = ?').run(id)
  return true
}

// ── Groups ──

export function getCollectorGroups(): string[] {
  const rows = getDb().prepare('SELECT name FROM groups ORDER BY name').all() as { name: string }[]
  return rows.map((r) => r.name)
}

export function addCollectorGroup(name: string): string[] {
  getDb().prepare('INSERT OR IGNORE INTO groups (name) VALUES (?)').run(name)
  return getCollectorGroups()
}

export function renameCollectorGroup(oldName: string, newName: string): string[] {
  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare('UPDATE groups SET name = ? WHERE name = ?').run(newName, oldName)
    db.prepare('UPDATE items SET "group" = ? WHERE "group" = ?').run(newName, oldName)
  })
  tx()
  return getCollectorGroups()
}

export function deleteCollectorGroup(name: string): string[] {
  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM groups WHERE name = ?').run(name)
    db.prepare('UPDATE items SET "group" = \'all\' WHERE "group" = ?').run(name)
  })
  tx()
  return getCollectorGroups()
}

// ── FTS5 Search ──

export interface FtsSearchResult {
  item: CollectedItem
  rank: number
}

/** True if the string contains CJK (Chinese/Japanese/Korean) characters */
function hasCjk(s: string): boolean {
  return /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(s)
}

/**
 * LIKE-based substring search with tiered ranking.
 *
 * We use MAX (not SUM) of per-column scores so items don't get inflated
 * just because the same content was duplicated across multiple columns
 * (e.g. tweets where title contains the full body, making note+title both hit).
 *
 * Tiers (higher = better, descending priority):
 *   - title starts with query → 1000 (strongest "this IS about X" signal)
 *   - title contains query    → 500
 *   - note contains query     → 200
 *   - url contains query      → 50
 *   - meta contains query     → 10
 * Tie-breaker: created_at DESC (newer first).
 */
function likeSearch(db: Database.Database, query: string, limit: number): FtsSearchResult[] {
  const likeQuery = `%${query}%`
  const prefixQuery = `${query}%`
  const rows = db.prepare(`
    SELECT *,
      MAX(
        CASE WHEN title LIKE ? THEN 1000 ELSE 0 END,
        CASE WHEN title LIKE ? THEN 500  ELSE 0 END,
        CASE WHEN note  LIKE ? THEN 200  ELSE 0 END,
        CASE WHEN url   LIKE ? THEN 50   ELSE 0 END,
        CASE WHEN meta  LIKE ? THEN 10   ELSE 0 END
      ) AS match_score
    FROM items
    WHERE title LIKE ? OR note LIKE ? OR url LIKE ? OR meta LIKE ?
    ORDER BY match_score DESC, created_at DESC
    LIMIT ?
  `).all(
    prefixQuery, likeQuery, likeQuery, likeQuery, likeQuery, // score tiers
    likeQuery, likeQuery, likeQuery, likeQuery,              // WHERE
    limit,
  ) as (Record<string, unknown> & { match_score: number })[]

  return rows.map((row) => ({
    item: rowToItem(row),
    // Negate so caller can sort ascending (smaller = better, matching FTS5 rank convention)
    rank: -row.match_score,
  }))
}

/** Fetch multiple items by ID in a single query. Preserves input order when possible. */
export function getItemsByIds(ids: string[]): CollectedItem[] {
  if (ids.length === 0) return []
  const db = getDb()
  const placeholders = ids.map(() => '?').join(',')
  const rows = db.prepare(`SELECT * FROM items WHERE id IN (${placeholders})`).all(...ids) as Record<string, unknown>[]
  const map = new Map(rows.map((r) => [r.id as string, rowToItem(r)]))
  // Preserve input order
  return ids.map((id) => map.get(id)).filter((i): i is CollectedItem => !!i)
}

export function ftsSearch(query: string, limit = 30): FtsSearchResult[] {
  const db = getDb()
  const safeQuery = query.replace(/['"]/g, ' ').trim()
  if (!safeQuery) return []

  // CJK characters: FTS5 default tokenizer treats contiguous CJK as one token,
  // so partial matches fail. Use LIKE substring search instead.
  if (hasCjk(safeQuery)) {
    return likeSearch(db, safeQuery, limit)
  }

  try {
    // Use OR between terms (not implicit AND) so items matching SOME terms
    // still surface. BM25 naturally ranks items matching MORE terms higher,
    // so we get AND-like behavior at the top without AND's strict filtering.
    // "musk*" also matches "musky" via prefix.
    const terms = safeQuery.split(/\s+/).filter((t) => t.length > 0).map((t) => `${t}*`)
    if (terms.length === 0) return []
    const ftsQuery = terms.join(' OR ')

    // BM25 column weights: title(10) > note(5) > url(2) > meta(1).
    // Smaller bm25 = more relevant (SQLite FTS5 convention).
    const rows = db.prepare(`
      SELECT items.*, bm25(items_fts, 10.0, 5.0, 2.0, 1.0) AS match_rank
      FROM items_fts
      JOIN items ON items.rowid = items_fts.rowid
      WHERE items_fts MATCH ?
      ORDER BY match_rank
      LIMIT ?
    `).all(ftsQuery, limit) as (Record<string, unknown> & { match_rank: number })[]

    if (rows.length > 0) {
      return rows.map((row) => ({
        item: rowToItem(row),
        rank: row.match_rank,
      }))
    }
    // Zero FTS hits → try LIKE as fallback
    return likeSearch(db, safeQuery, limit)
  } catch {
    // FTS query syntax error → LIKE fallback
    return likeSearch(db, safeQuery, limit)
  }
}

// ── Vectors ──

export function saveVector(itemId: string, vector: Float64Array | number[]): void {
  const buf = Buffer.from(new Float64Array(vector).buffer)
  getDb().prepare(`
    INSERT OR REPLACE INTO vectors (item_id, vector, embedded_at) VALUES (?, ?, ?)
  `).run(itemId, buf, Date.now())
}

export function getVector(itemId: string): number[] | null {
  const row = getDb().prepare('SELECT vector FROM vectors WHERE item_id = ?').get(itemId) as { vector: Buffer } | undefined
  if (!row) return null
  return Array.from(new Float64Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 8))
}

export function getAllVectors(): { itemId: string; vector: number[] }[] {
  const rows = getDb().prepare('SELECT item_id, vector FROM vectors').all() as { item_id: string; vector: Buffer }[]
  return rows.map((row) => ({
    itemId: row.item_id,
    vector: Array.from(new Float64Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 8)),
  }))
}

export function getEmbeddedItemIds(): Set<string> {
  const rows = getDb().prepare('SELECT item_id FROM vectors').all() as { item_id: string }[]
  return new Set(rows.map(r => r.item_id))
}

export function removeVector(itemId: string): void {
  getDb().prepare('DELETE FROM vectors WHERE item_id = ?').run(itemId)
}

export function getEmbeddingStats(): { total: number; embedded: number } {
  const db = getDb()
  const total = (db.prepare('SELECT COUNT(*) as c FROM items').get() as { c: number }).c
  const embedded = (db.prepare('SELECT COUNT(*) as c FROM vectors').get() as { c: number }).c
  return { total, embedded }
}

// ── Markdown ──

function markdownDir(): string {
  return path.join(getLiteHome(), 'collected', 'markdown')
}

export async function fetchAndSaveMarkdown(itemId: string, url: string): Promise<string | null> {
  const dir = markdownDir()
  fs.mkdirSync(dir, { recursive: true })

  let markdown: string | null = null

  // 1) Cloudflare Markdown for Agents
  try {
    const cfRes = await fetch(url, {
      headers: {
        'Accept': 'text/markdown, text/html;q=0.9',
        'User-Agent': 'Mozilla/5.0 (compatible; LiteCollector/1.0)',
      },
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    })
    if (cfRes.ok) {
      const contentType = cfRes.headers.get('content-type') || ''
      const body = await cfRes.text()
      if (contentType.includes('text/markdown') && body.length > 50) {
        markdown = body
      }
    }
  } catch {}

  // 2) Fallback: Jina Reader
  if (!markdown) {
    try {
      const jinaRes = await fetch(`https://r.jina.ai/${url}`, {
        headers: { 'Accept': 'text/markdown' },
        signal: AbortSignal.timeout(15000),
      })
      if (jinaRes.ok) {
        const body = await jinaRes.text()
        if (body.length > 50) markdown = body
      }
    } catch {}
  }

  if (!markdown) return null

  const filePath = path.join(dir, `${itemId}.md`)
  fs.writeFileSync(filePath, markdown, 'utf-8')

  // Update item meta
  try {
    getDb().prepare(`
      UPDATE items SET meta = json_set(meta, '$.hasMarkdown', json('true'), '$.markdownLength', ?), updated_at = ?
      WHERE id = ?
    `).run(markdown.length, Date.now(), itemId)
  } catch {
    // json_set might not be available, fallback
    const item = getDb().prepare('SELECT meta FROM items WHERE id = ?').get(itemId) as { meta: string } | undefined
    if (item) {
      const meta = JSON.parse(item.meta)
      meta.hasMarkdown = true
      meta.markdownLength = markdown.length
      getDb().prepare('UPDATE items SET meta = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(meta), Date.now(), itemId)
    }
  }

  return filePath
}

export function readItemMarkdown(itemId: string): string | null {
  try {
    return fs.readFileSync(path.join(markdownDir(), `${itemId}.md`), 'utf-8')
  } catch {
    return null
  }
}

function mimeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
    'image/webp': 'webp', 'image/svg+xml': 'svg',
    'video/mp4': 'mp4', 'video/quicktime': 'mov',
    'application/pdf': 'pdf',
  }
  return map[mimeType] || 'bin'
}
