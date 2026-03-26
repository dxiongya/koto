import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getLiteHome } from './lite-home'
import type { CollectedItem, CollectorAddInput } from '../../shared/types'

function dbPath(): string {
  return path.join(getLiteHome(), 'collected', 'items.json')
}

function assetsDir(): string {
  return path.join(getLiteHome(), 'collected', 'assets')
}

function thumbsDir(): string {
  return path.join(getLiteHome(), 'collected', 'thumbnails')
}

function ensureDirs(): void {
  for (const dir of [assetsDir(), thumbsDir()]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function readItems(): CollectedItem[] {
  try {
    const raw = fs.readFileSync(dbPath(), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function writeItems(items: CollectedItem[]): void {
  fs.writeFileSync(dbPath(), JSON.stringify(items, null, 2), 'utf-8')
}

function generateId(): string {
  return crypto.randomBytes(8).toString('hex')
}

export function listCollectedItems(): CollectedItem[] {
  return readItems().sort((a, b) => b.createdAt - a.createdAt)
}

export function addCollectedItem(input: CollectorAddInput): CollectedItem {
  ensureDirs()

  const id = generateId()
  const now = Date.now()

  // Save asset if provided
  let assetPath: string | undefined
  if (input.assetData && input.assetMimeType) {
    const ext = mimeToExt(input.assetMimeType)
    const filename = `${id}.${ext}`
    const filePath = path.join(assetsDir(), filename)
    fs.writeFileSync(filePath, Buffer.from(input.assetData))
    assetPath = `assets/${filename}`
  }

  const item: CollectedItem = {
    id,
    type: input.type,
    title: input.title,
    note: input.note || '',
    url: input.url,
    assetPath,
    thumbnailPath: undefined,
    group: input.group || 'all',
    source: input.source || 'paste',
    meta: input.meta || {},
    createdAt: now,
    updatedAt: now,
  }

  const items = readItems()
  items.push(item)
  writeItems(items)

  return item
}

export function updateCollectedItem(id: string, patch: Partial<CollectedItem>): CollectedItem | null {
  const items = readItems()
  const idx = items.findIndex((i) => i.id === id)
  if (idx === -1) return null

  const updated = { ...items[idx], ...patch, updatedAt: Date.now() }
  // Prevent overwriting id/createdAt
  updated.id = items[idx].id
  updated.createdAt = items[idx].createdAt

  items[idx] = updated
  writeItems(items)
  return updated
}

export function deleteCollectedItem(id: string): boolean {
  const items = readItems()
  const item = items.find((i) => i.id === id)
  if (!item) return false

  // Delete asset file
  if (item.assetPath) {
    const fullPath = path.join(getLiteHome(), 'collected', item.assetPath)
    try { fs.unlinkSync(fullPath) } catch { /* ignore */ }
  }
  // Delete thumbnail
  if (item.thumbnailPath) {
    const fullPath = path.join(getLiteHome(), 'collected', item.thumbnailPath)
    try { fs.unlinkSync(fullPath) } catch { /* ignore */ }
  }

  const filtered = items.filter((i) => i.id !== id)
  writeItems(filtered)
  return true
}

function groupsPath(): string {
  return path.join(getLiteHome(), 'collected', 'groups.json')
}

function readGroups(): string[] {
  try {
    return JSON.parse(fs.readFileSync(groupsPath(), 'utf-8'))
  } catch {
    return []
  }
}

function writeGroups(groups: string[]): void {
  fs.writeFileSync(groupsPath(), JSON.stringify(groups, null, 2), 'utf-8')
}

export function getCollectorGroups(): string[] {
  const saved = readGroups()
  // Also include groups from items that aren't in saved list
  const items = readItems()
  const all = new Set(saved)
  for (const item of items) {
    if (item.group && item.group !== 'all') all.add(item.group)
  }
  const sorted = Array.from(all).sort()
  // Persist merged list
  if (sorted.length !== saved.length) writeGroups(sorted)
  return sorted
}

export function addCollectorGroup(name: string): string[] {
  const groups = readGroups()
  if (!groups.includes(name)) {
    groups.push(name)
    groups.sort()
    writeGroups(groups)
  }
  return groups
}

export function renameCollectorGroup(oldName: string, newName: string): string[] {
  const groups = readGroups().map((g) => g === oldName ? newName : g)
  groups.sort()
  writeGroups(groups)
  // Update items
  const items = readItems()
  let changed = false
  for (const item of items) {
    if (item.group === oldName) { item.group = newName; changed = true }
  }
  if (changed) writeItems(items)
  return groups
}

export function deleteCollectorGroup(name: string): string[] {
  const groups = readGroups().filter((g) => g !== name)
  writeGroups(groups)
  // Move items in this group back to 'all'
  const items = readItems()
  let changed = false
  for (const item of items) {
    if (item.group === name) { item.group = 'all'; changed = true }
  }
  if (changed) writeItems(items)
  return groups
}

function markdownDir(): string {
  return path.join(getLiteHome(), 'collected', 'markdown')
}

/**
 * Fetch page as markdown and save to file.
 * Strategy: 1) Cloudflare Markdown for Agents (Accept: text/markdown)
 *           2) Fallback to Jina Reader (r.jina.ai)
 */
export async function fetchAndSaveMarkdown(itemId: string, url: string): Promise<string | null> {
  const dir = markdownDir()
  fs.mkdirSync(dir, { recursive: true })

  let markdown: string | null = null

  // 1) Try Cloudflare Markdown for Agents — just add Accept: text/markdown
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
      // CF returns content-type: text/markdown when supported
      if (contentType.includes('text/markdown') && body.length > 50) {
        markdown = body
      }
    }
  } catch { /* fall through to Jina */ }

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
    } catch { /* give up */ }
  }

  if (!markdown) return null

  // Save markdown file
  const filePath = path.join(dir, `${itemId}.md`)
  fs.writeFileSync(filePath, markdown, 'utf-8')

  // Update item meta
  const items = readItems()
  const item = items.find((i) => i.id === itemId)
  if (item) {
    item.meta = { ...item.meta, hasMarkdown: true, markdownLength: markdown.length }
    item.updatedAt = Date.now()
    writeItems(items)
  }

  return filePath
}

/** Read stored markdown for an item */
export function readItemMarkdown(itemId: string): string | null {
  try {
    return fs.readFileSync(path.join(markdownDir(), `${itemId}.md`), 'utf-8')
  } catch {
    return null
  }
}

function mimeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'application/pdf': 'pdf',
  }
  return map[mimeType] || 'bin'
}
