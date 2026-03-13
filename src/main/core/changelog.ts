import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getLiteHome } from './lite-home'
import type { IpcResult, ChangelogEntry } from '../../shared/types'

function changelogsDir(): string {
  return path.join(getLiteHome(), 'changelogs')
}

function hashFilePath(filePath: string): string {
  return crypto.createHash('sha256').update(filePath).digest('hex').slice(0, 16)
}

function logFilePath(filePath: string): string {
  return path.join(changelogsDir(), `${hashFilePath(filePath)}.jsonl`)
}

export function appendChangelog(entry: ChangelogEntry): IpcResult<void> {
  try {
    const dir = changelogsDir()
    fs.mkdirSync(dir, { recursive: true })
    const line = JSON.stringify(entry) + '\n'
    fs.appendFileSync(logFilePath(entry.filePath), line, 'utf-8')
    return { ok: true, data: undefined }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export function readChangelog(filePath: string): IpcResult<ChangelogEntry[]> {
  try {
    const fp = logFilePath(filePath)
    if (!fs.existsSync(fp)) {
      return { ok: true, data: [] }
    }
    const raw = fs.readFileSync(fp, 'utf-8')
    const entries = raw
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as ChangelogEntry)
    return { ok: true, data: entries }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
