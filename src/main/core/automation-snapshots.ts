/**
 * Automation Snapshots — JSONL storage for version history
 * Each automation gets its own .jsonl file in {liteHome}/automations/snapshots/
 */
import fs from 'fs'
import path from 'path'
import { getLiteHome } from './lite-home'
import type { AutomationSnapshot, IpcResult } from '../../shared/types'

function snapshotsDir(): string {
  return path.join(getLiteHome(), 'automations', 'snapshots')
}

function snapshotFilePath(automationId: string): string {
  return path.join(snapshotsDir(), `${automationId}.jsonl`)
}

/** Append a snapshot entry */
export function appendSnapshot(snapshot: AutomationSnapshot): IpcResult<void> {
  try {
    const dir = snapshotsDir()
    fs.mkdirSync(dir, { recursive: true })
    const line = JSON.stringify(snapshot) + '\n'
    fs.appendFileSync(snapshotFilePath(snapshot.automationId), line, 'utf-8')
    return { ok: true, data: undefined }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

/** Read all snapshots for an automation, newest first */
export function readSnapshots(automationId: string): IpcResult<AutomationSnapshot[]> {
  try {
    const fp = snapshotFilePath(automationId)
    if (!fs.existsSync(fp)) return { ok: true, data: [] }

    const raw = fs.readFileSync(fp, 'utf-8')
    const entries = raw
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as AutomationSnapshot)
      .sort((a, b) => b.timestamp - a.timestamp) // newest first

    return { ok: true, data: entries }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

/** Restore a snapshot: write contentBefore back to the target file */
export function restoreSnapshot(
  automationId: string,
  timestamp: number
): IpcResult<void> {
  const result = readSnapshots(automationId)
  if (!result.ok) return result

  const snapshot = result.data.find((s) => s.timestamp === timestamp)
  if (!snapshot) return { ok: false, error: 'Snapshot not found' }

  try {
    // Read the full file
    const fullContent = fs.readFileSync(snapshot.filePath, 'utf-8')

    // Replace the contentAfter with contentBefore in the file
    if (snapshot.targetType === 'file') {
      // For file-level: restore entire file
      fs.writeFileSync(snapshot.filePath, snapshot.contentBefore, 'utf-8')
    } else {
      // For section/table: find and replace the contentAfter with contentBefore
      const idx = fullContent.indexOf(snapshot.contentAfter)
      if (idx === -1) {
        // contentAfter might have been modified since — try to write contentBefore at the same location
        // Fallback: replace entire file with contentBefore if target is section/table
        return { ok: false, error: 'Current content does not match snapshot — file may have been modified' }
      }
      const restored =
        fullContent.slice(0, idx) +
        snapshot.contentBefore +
        fullContent.slice(idx + snapshot.contentAfter.length)
      fs.writeFileSync(snapshot.filePath, restored, 'utf-8')
    }

    return { ok: true, data: undefined }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
