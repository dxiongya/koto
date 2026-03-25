/**
 * Automation Store — CRUD for automation registry (registry.json)
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getLiteHome } from './lite-home'
import type { Automation, IpcResult } from '../../shared/types'

function automationsDir(): string {
  return path.join(getLiteHome(), 'automations')
}

function registryPath(): string {
  return path.join(automationsDir(), 'registry.json')
}

function ensureDir(): void {
  fs.mkdirSync(automationsDir(), { recursive: true })
  fs.mkdirSync(path.join(automationsDir(), 'snapshots'), { recursive: true })
}

/** Load all automations from disk */
export function loadAutomations(): Automation[] {
  try {
    const fp = registryPath()
    if (!fs.existsSync(fp)) return []
    const raw = fs.readFileSync(fp, 'utf-8')
    return JSON.parse(raw) as Automation[]
  } catch {
    return []
  }
}

/** Save all automations to disk */
function saveAutomations(automations: Automation[]): void {
  ensureDir()
  fs.writeFileSync(registryPath(), JSON.stringify(automations, null, 2), 'utf-8')
}

/** Generate a short unique ID */
function generateId(): string {
  return crypto.randomBytes(8).toString('hex')
}

/** List all automations */
export function listAutomations(): IpcResult<Automation[]> {
  return { ok: true, data: loadAutomations() }
}

/** Create a new automation */
export function createAutomation(
  input: Omit<Automation, 'id' | 'createdAt' | 'lastRunAt' | 'lastRunStatus' | 'lastRunError' | 'runCount'>
): IpcResult<Automation> {
  const automations = loadAutomations()
  const automation: Automation = {
    ...input,
    id: generateId(),
    createdAt: Date.now(),
    lastRunAt: null,
    lastRunStatus: null,
    lastRunError: null,
    runCount: 0,
  }
  automations.push(automation)
  saveAutomations(automations)
  return { ok: true, data: automation }
}

/** Update an existing automation */
export function updateAutomation(id: string, patch: Partial<Automation>): IpcResult<Automation> {
  const automations = loadAutomations()
  const idx = automations.findIndex((a) => a.id === id)
  if (idx === -1) return { ok: false, error: 'Automation not found' }

  automations[idx] = { ...automations[idx], ...patch, id } // prevent id change
  saveAutomations(automations)
  return { ok: true, data: automations[idx] }
}

/** Delete an automation and its snapshots */
export function deleteAutomation(id: string): IpcResult<void> {
  const automations = loadAutomations()
  const filtered = automations.filter((a) => a.id !== id)
  if (filtered.length === automations.length) return { ok: false, error: 'Automation not found' }

  saveAutomations(filtered)

  // Also delete snapshots file
  const snapshotFile = path.join(automationsDir(), 'snapshots', `${id}.jsonl`)
  try { fs.unlinkSync(snapshotFile) } catch { /* ignore if not found */ }

  return { ok: true, data: undefined }
}

/** Update run status after execution */
export function updateRunStatus(
  id: string,
  status: 'success' | 'error',
  error?: string
): void {
  const automations = loadAutomations()
  const auto = automations.find((a) => a.id === id)
  if (!auto) return

  auto.lastRunAt = Date.now()
  auto.lastRunStatus = status
  auto.lastRunError = error ?? null
  if (status === 'success') auto.runCount++

  saveAutomations(automations)
}
