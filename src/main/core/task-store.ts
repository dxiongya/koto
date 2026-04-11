/**
 * Task Store — SQLite-backed unified scheduled tasks.
 * Single table for all task types (ai-prompt, script, shell, mcp-tool).
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import Database from 'better-sqlite3'
import { getLiteHome } from './lite-home'

// ── Types ──

export type TaskType = 'ai-prompt' | 'script' | 'shell' | 'mcp-tool'

export interface ScheduledTask {
  id: string
  name: string
  type: TaskType
  appId: string | null
  enabled: boolean
  schedule: string           // 'manual' | cron expression | 'interval:60' (minutes)
  config: Record<string, unknown>
  lastRunAt: number | null
  lastRunStatus: string | null
  lastRunError: string | null
  runCount: number
  createdAt: number
  updatedAt: number
}

export interface TaskCreateInput {
  name: string
  type: TaskType
  appId?: string | null
  enabled?: boolean
  schedule?: string
  config?: Record<string, unknown>
}

export interface TaskRunEvent {
  taskId: string
  taskName: string
  status: 'started' | 'progress' | 'completed' | 'error' | 'cancelled'
  timestamp: number
  message?: string
}

// ── Database ──

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (db) return db

  const dir = getLiteHome()
  fs.mkdirSync(dir, { recursive: true })

  db = new Database(path.join(dir, 'tasks.db'))
  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      app_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      schedule TEXT NOT NULL DEFAULT 'manual',
      config TEXT NOT NULL DEFAULT '{}',
      last_run_at INTEGER,
      last_run_status TEXT,
      last_run_error TEXT,
      run_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)

  return db
}

function generateId(): string {
  return crypto.randomBytes(8).toString('hex')
}

function rowToTask(row: Record<string, unknown>): ScheduledTask {
  return {
    id: row.id as string,
    name: row.name as string,
    type: row.type as TaskType,
    appId: (row.app_id as string) || null,
    enabled: row.enabled === 1,
    schedule: row.schedule as string,
    config: JSON.parse((row.config as string) || '{}'),
    lastRunAt: (row.last_run_at as number) || null,
    lastRunStatus: (row.last_run_status as string) || null,
    lastRunError: (row.last_run_error as string) || null,
    runCount: (row.run_count as number) || 0,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

// ── CRUD ──

export function listTasks(appId?: string): ScheduledTask[] {
  const d = getDb()
  const rows = appId
    ? d.prepare('SELECT * FROM scheduled_tasks WHERE app_id = ? ORDER BY created_at DESC').all(appId)
    : d.prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC').all()
  return (rows as Record<string, unknown>[]).map(rowToTask)
}

export function getTask(id: string): ScheduledTask | null {
  const d = getDb()
  const row = d.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id)
  return row ? rowToTask(row as Record<string, unknown>) : null
}

export function listEnabledTasks(): ScheduledTask[] {
  const d = getDb()
  const rows = d.prepare('SELECT * FROM scheduled_tasks WHERE enabled = 1').all()
  return (rows as Record<string, unknown>[]).map(rowToTask)
}

export function createTask(input: TaskCreateInput): ScheduledTask {
  const d = getDb()
  const now = Date.now()
  const id = generateId()

  d.prepare(`
    INSERT INTO scheduled_tasks (id, name, type, app_id, enabled, schedule, config, run_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    id,
    input.name,
    input.type,
    input.appId ?? null,
    input.enabled !== false ? 1 : 0,
    input.schedule ?? 'manual',
    JSON.stringify(input.config ?? {}),
    now,
    now,
  )

  return getTask(id)!
}

export function updateTask(id: string, patch: Partial<Pick<ScheduledTask, 'name' | 'enabled' | 'schedule' | 'config' | 'appId'>>): ScheduledTask | null {
  const d = getDb()
  const existing = getTask(id)
  if (!existing) return null

  const sets: string[] = []
  const values: unknown[] = []

  if (patch.name !== undefined) { sets.push('name = ?'); values.push(patch.name) }
  if (patch.enabled !== undefined) { sets.push('enabled = ?'); values.push(patch.enabled ? 1 : 0) }
  if (patch.schedule !== undefined) { sets.push('schedule = ?'); values.push(patch.schedule) }
  if (patch.config !== undefined) { sets.push('config = ?'); values.push(JSON.stringify(patch.config)) }
  if (patch.appId !== undefined) { sets.push('app_id = ?'); values.push(patch.appId) }

  if (sets.length === 0) return existing

  sets.push('updated_at = ?')
  values.push(Date.now())
  values.push(id)

  d.prepare(`UPDATE scheduled_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  return getTask(id)
}

export function deleteTask(id: string): boolean {
  const d = getDb()
  const result = d.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id)
  return result.changes > 0
}

export function updateRunStatus(id: string, status: string, error?: string): void {
  const d = getDb()
  d.prepare(`
    UPDATE scheduled_tasks
    SET last_run_at = ?, last_run_status = ?, last_run_error = ?,
        run_count = run_count + 1, updated_at = ?
    WHERE id = ?
  `).run(Date.now(), status, error ?? null, Date.now(), id)
}

/** Find task by name + appId (used to avoid duplicates during migration) */
export function findTaskByName(name: string, appId?: string | null): ScheduledTask | null {
  const d = getDb()
  const row = appId
    ? d.prepare('SELECT * FROM scheduled_tasks WHERE name = ? AND app_id = ?').get(name, appId)
    : d.prepare('SELECT * FROM scheduled_tasks WHERE name = ? AND app_id IS NULL').get(name)
  return row ? rowToTask(row as Record<string, unknown>) : null
}
