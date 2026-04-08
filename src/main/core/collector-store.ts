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

  return db
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

  getDb().prepare(`
    INSERT INTO items (id, type, title, note, url, asset_path, "group", source, meta, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.type, input.title, input.note || '',
    input.url || null, assetPath || null,
    input.group || 'all', input.source || 'paste',
    JSON.stringify(meta), now, now
  )

  return {
    id, type: input.type, title: input.title, note: input.note || '',
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

  if (patch.title !== undefined) { updates.push('title = ?'); values.push(patch.title) }
  if (patch.note !== undefined) { updates.push('note = ?'); values.push(patch.note) }
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

export function ftsSearch(query: string, limit = 30): FtsSearchResult[] {
  const db = getDb()
  // FTS5 match query — escape special chars
  const safeQuery = query.replace(/['"]/g, ' ').trim()
  if (!safeQuery) return []

  try {
    const rows = db.prepare(`
      SELECT items.*, items_fts.rank
      FROM items_fts
      JOIN items ON items.rowid = items_fts.rowid
      WHERE items_fts MATCH ?
      ORDER BY items_fts.rank
      LIMIT ?
    `).all(safeQuery, limit) as (Record<string, unknown> & { rank: number })[]

    return rows.map((row) => ({
      item: rowToItem(row),
      rank: row.rank,
    }))
  } catch {
    // Fallback: simple LIKE search if FTS query syntax fails
    const likeQuery = `%${safeQuery}%`
    const rows = db.prepare(`
      SELECT * FROM items
      WHERE title LIKE ? OR note LIKE ? OR url LIKE ? OR meta LIKE ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(likeQuery, likeQuery, likeQuery, likeQuery, limit) as Record<string, unknown>[]

    return rows.map((row, i) => ({
      item: rowToItem(row),
      rank: -(rows.length - i),
    }))
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
