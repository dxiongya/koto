/**
 * Notebook store — flat JSON file per notebook under {liteHome}/notebooks/.
 *
 * No DB. Notebooks are small (KB-range) and rarely numbered, so a JSON-per-file
 * model mirrors how Notes are stored as .md files and stays trivial to inspect
 * by hand. CRUD goes through `loadNotebook` / `saveNotebook` only — callers
 * never touch the filesystem layout.
 */
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { getLiteHome } from './lite-home'
import type { Notebook, NotebookSummary } from '../../shared/notebook'

function notebooksDir(): string {
  const dir = path.join(getLiteHome(), 'notebooks')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function notebookPath(id: string): string {
  return path.join(notebooksDir(), `${id}.json`)
}

/** List notebooks newest-first. Reads every file but each is tiny. */
export function listNotebooks(): NotebookSummary[] {
  const dir = notebooksDir()
  const entries = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
  const out: NotebookSummary[] = []
  for (const file of entries) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), 'utf-8')
      const nb = JSON.parse(raw) as Notebook
      out.push({
        id: nb.id,
        name: nb.name,
        sourceCount: nb.sources.length,
        updatedAt: nb.updatedAt,
      })
    } catch {
      // Skip corrupt files — surfacing them would block the UI from opening.
    }
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt)
  return out
}

export function getNotebook(id: string): Notebook | null {
  try {
    const raw = fs.readFileSync(notebookPath(id), 'utf-8')
    return JSON.parse(raw) as Notebook
  } catch {
    return null
  }
}

export function createNotebook(name: string): Notebook {
  const now = Date.now()
  const nb: Notebook = {
    id: randomUUID(),
    name: name.trim() || 'Untitled notebook',
    sources: [],
    messages: [],
    products: [],
    createdAt: now,
    updatedAt: now,
  }
  fs.writeFileSync(notebookPath(nb.id), JSON.stringify(nb, null, 2), 'utf-8')
  return nb
}

/** Whole-document replace. Cheaper than a partial patch protocol given size. */
export function saveNotebook(nb: Notebook): Notebook {
  const merged: Notebook = { ...nb, updatedAt: Date.now() }
  fs.writeFileSync(notebookPath(merged.id), JSON.stringify(merged, null, 2), 'utf-8')
  return merged
}

export function deleteNotebook(id: string): boolean {
  try {
    fs.unlinkSync(notebookPath(id))
    return true
  } catch {
    return false
  }
}
