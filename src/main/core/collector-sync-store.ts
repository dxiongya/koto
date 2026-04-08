/**
 * Collector Sync Store — CRUD for group sync configurations.
 * Each group can have an automated sync script.
 */
import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { getLiteHome } from './lite-home'

// Reuse the collector DB (tables created in collector-store.ts)
let db: Database.Database | null = null
function getDb(): Database.Database {
  if (db) return db
  const dbPath = path.join(getLiteHome(), 'collected', 'collector.db')
  db = new Database(dbPath)
  return db
}

export interface GroupSyncConfig {
  groupName: string
  adapter: string
  scriptPath: string | null
  schedule: 'manual' | 'hourly' | 'daily' | 'weekly'
  enabled: boolean
  lastSyncAt: number | null
  lastSyncStatus: string | null
  lastSyncError: string | null
  lastSyncItemsAdded: number
  syncCount: number
  adapterConfig: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

function rowToConfig(row: Record<string, unknown>): GroupSyncConfig {
  return {
    groupName: row.group_name as string,
    adapter: row.adapter as string,
    scriptPath: row.script_path as string | null,
    schedule: row.schedule as GroupSyncConfig['schedule'],
    enabled: !!(row.enabled as number),
    lastSyncAt: row.last_sync_at as number | null,
    lastSyncStatus: row.last_sync_status as string | null,
    lastSyncError: row.last_sync_error as string | null,
    lastSyncItemsAdded: (row.last_sync_items_added as number) || 0,
    syncCount: (row.sync_count as number) || 0,
    adapterConfig: JSON.parse((row.adapter_config as string) || '{}'),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

// ── CRUD ──

export function getSyncConfig(groupName: string): GroupSyncConfig | null {
  const row = getDb().prepare('SELECT * FROM group_sync_configs WHERE group_name = ?').get(groupName) as Record<string, unknown> | undefined
  return row ? rowToConfig(row) : null
}

export function listSyncConfigs(): GroupSyncConfig[] {
  const rows = getDb().prepare('SELECT * FROM group_sync_configs ORDER BY group_name').all() as Record<string, unknown>[]
  return rows.map(rowToConfig)
}

export function listEnabledSyncConfigs(): GroupSyncConfig[] {
  const rows = getDb().prepare('SELECT * FROM group_sync_configs WHERE enabled = 1 AND schedule != ?').all('manual') as Record<string, unknown>[]
  return rows.map(rowToConfig)
}

export function setSyncConfig(groupName: string, config: Partial<Omit<GroupSyncConfig, 'groupName' | 'createdAt' | 'updatedAt'>>): GroupSyncConfig {
  const d = getDb()
  const now = Date.now()
  const existing = getSyncConfig(groupName)

  if (existing) {
    const updates: string[] = []
    const params: unknown[] = []
    if (config.adapter !== undefined) { updates.push('adapter = ?'); params.push(config.adapter) }
    if (config.scriptPath !== undefined) { updates.push('script_path = ?'); params.push(config.scriptPath) }
    if (config.schedule !== undefined) { updates.push('schedule = ?'); params.push(config.schedule) }
    if (config.enabled !== undefined) { updates.push('enabled = ?'); params.push(config.enabled ? 1 : 0) }
    if (config.adapterConfig !== undefined) { updates.push('adapter_config = ?'); params.push(JSON.stringify(config.adapterConfig)) }
    updates.push('updated_at = ?'); params.push(now)
    params.push(groupName)
    d.prepare(`UPDATE group_sync_configs SET ${updates.join(', ')} WHERE group_name = ?`).run(...params)
  } else {
    d.prepare(`INSERT INTO group_sync_configs (group_name, adapter, script_path, schedule, enabled, adapter_config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      groupName,
      config.adapter || 'custom',
      config.scriptPath || null,
      config.schedule || 'manual',
      config.enabled !== false ? 1 : 0,
      JSON.stringify(config.adapterConfig || {}),
      now, now,
    )
  }
  return getSyncConfig(groupName)!
}

export function deleteSyncConfig(groupName: string): boolean {
  // Also delete the script file
  const config = getSyncConfig(groupName)
  if (config?.scriptPath) {
    const fullPath = path.join(getLiteHome(), 'collected', config.scriptPath)
    try { fs.unlinkSync(fullPath) } catch {}
  }
  return getDb().prepare('DELETE FROM group_sync_configs WHERE group_name = ?').run(groupName).changes > 0
}

export function updateSyncResult(groupName: string, result: {
  status: 'success' | 'error'
  error?: string
  itemsAdded?: number
}): void {
  getDb().prepare(`UPDATE group_sync_configs SET
    last_sync_at = ?, last_sync_status = ?, last_sync_error = ?,
    last_sync_items_added = ?, sync_count = sync_count + 1, updated_at = ?
    WHERE group_name = ?`).run(
    Date.now(), result.status, result.error || null,
    result.itemsAdded || 0, Date.now(), groupName,
  )
}

// ── Script File Management ──

function getScriptsDir(): string {
  const dir = path.join(getLiteHome(), 'collected', 'sync-scripts')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function getScriptSource(groupName: string): string | null {
  const config = getSyncConfig(groupName)
  if (!config?.scriptPath) return null
  const fullPath = path.join(getLiteHome(), 'collected', config.scriptPath)
  try { return fs.readFileSync(fullPath, 'utf-8') } catch { return null }
}

export function setScriptSource(groupName: string, source: string): string {
  const scriptsDir = getScriptsDir()
  const fileName = `${groupName.replace(/[^a-z0-9_-]/gi, '_')}.js`
  const scriptPath = `sync-scripts/${fileName}`
  fs.writeFileSync(path.join(scriptsDir, fileName), source, 'utf-8')

  // Update config with script path
  const existing = getSyncConfig(groupName)
  if (existing) {
    getDb().prepare('UPDATE group_sync_configs SET script_path = ?, updated_at = ? WHERE group_name = ?')
      .run(scriptPath, Date.now(), groupName)
  }

  return scriptPath
}
