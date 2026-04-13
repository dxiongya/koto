/**
 * Wiki Store — file-system backed LLM Wiki at {liteHome}/wiki/.
 *
 * Structure:
 *   wiki/
 *     SCHEMA.md        — LLM-followed conventions
 *     purpose.md       — user's intent / direction
 *     index.md         — content catalog
 *     log.md           — chronological action log
 *     overview.md      — global summary (auto-updated)
 *     entities/        — people, organizations, products
 *     concepts/        — theories, methods, topics
 *     sources/         — one summary per ingested source
 *     comparisons/     — cross-source comparisons
 *     queries/         — saved chat answers worth keeping
 *     synthesis/       — derived analysis pages
 *
 * Raw sources are NOT stored here — they live in collector.db and are read
 * on demand via collector-store APIs during ingest.
 */
import fs from 'fs'
import path from 'path'
import { getLiteHome } from './lite-home'

export interface WikiStats {
  root: string
  total: number
  byType: Record<string, number>
  hasIndex: boolean
  hasPurpose: boolean
  lastLogEntry: string | null
}

// Source files are split by resource type so the file tree mirrors the
// collector's taxonomy (image/video/link/text). Keeps directory listings
// scannable and lets the lint pass check type-specific frontmatter.
const WIKI_DIRS = [
  'entities',
  'concepts',
  'sources',
  'sources/links',
  'sources/images',
  'sources/videos',
  'sources/notes',
  'comparisons',
  'queries',
  'synthesis',
]

/** Absolute path to the wiki root directory. */
export function wikiRoot(): string {
  return path.join(getLiteHome(), 'wiki')
}

/** Create the wiki directory + starter files if they don't exist. */
export function initWiki(): { created: boolean; root: string } {
  const root = wikiRoot()
  const existed = fs.existsSync(path.join(root, 'SCHEMA.md'))

  fs.mkdirSync(root, { recursive: true })
  for (const dir of WIKI_DIRS) {
    fs.mkdirSync(path.join(root, dir), { recursive: true })
  }

  const today = new Date().toISOString().slice(0, 10)

  // SCHEMA.md — structural rules the LLM must follow
  writeIfMissing(path.join(root, 'SCHEMA.md'), [
    '# Wiki Schema',
    '',
    '## Domain',
    '(Describe what this wiki is about. The LLM reads this for context.)',
    '',
    '## Conventions',
    '- File names: lowercase, hyphens, no spaces (e.g., `transformer-architecture.md`)',
    '- Every wiki page MUST have YAML frontmatter:',
    '  ```yaml',
    '  ---',
    '  title: Page Title',
    '  type: entity | concept | source | comparison | query | synthesis',
    '  created: YYYY-MM-DD',
    '  updated: YYYY-MM-DD',
    '  tags: []',
    '  sources: []      # collector item IDs this page was derived from',
    '  related: []      # wiki page slugs related to this page',
    '  ---',
    '  ```',
    '- Use `[[wikilink]]` syntax for cross-references between pages',
    '- When updating a page, bump the `updated` date',
    '- Every new page gets added to `index.md`',
    '- Every operation appends to `log.md`',
    '',
    '## Page Types',
    '',
    '### Entity',
    'One page per person, organization, product, tool. Include:',
    '- Overview (what it is)',
    '- Key facts & dates',
    '- Relationships to other entities (wikilinks)',
    '- Source references',
    '',
    '### Concept',
    'One page per theory, method, technique. Include:',
    '- Definition',
    '- Why it matters',
    '- Open questions',
    '- Related concepts',
    '',
    '### Source',
    'One summary per raw source ingested. Source files are split by resource type:',
    '- `sources/links/` — articles, web pages, tweets (extracted markdown)',
    '- `sources/images/` — images & screenshots (visual description + OCR text)',
    '- `sources/videos/` — video clips (title + description; no transcript yet)',
    '- `sources/notes/` — plain text notes pasted into the collector',
    '',
    'Source pages carry extra frontmatter so consumers (lint, graph, retrieval)',
    'can filter by resource type:',
    '  ```yaml',
    '  resourceType: link | image | video | text',
    '  asset: "relative/path"   # only for image/video types',
    '  ```',
    '',
    'Include:',
    '- Core claims',
    '- Key takeaways',
    '- Links to entities / concepts extracted',
    '',
    '### Comparison, Query, Synthesis',
    'Created opportunistically when the user asks questions worth keeping.',
    '',
  ].join('\n'))

  // purpose.md — user intent
  writeIfMissing(path.join(root, 'purpose.md'), [
    '# Wiki Purpose',
    '',
    '## Why this wiki exists',
    '(What are you trying to understand or track? Update this as your focus evolves.)',
    '',
    '## Key questions',
    '- (What question are you trying to answer?)',
    '- (What do you want to discover?)',
    '',
    '## Scope',
    '- (What is in scope?)',
    '- (What is out of scope?)',
    '',
    '## Evolving thesis',
    '(Your current working understanding. Revise as you learn.)',
    '',
  ].join('\n'))

  // index.md — content catalog
  writeIfMissing(path.join(root, 'index.md'), [
    '# Wiki Index',
    '',
    '> Content catalog. Every wiki page with a one-line summary.',
    '> Read this first to find relevant pages for any query.',
    '',
    '## Entities',
    '',
    '## Concepts',
    '',
    '## Sources',
    '',
    '## Comparisons',
    '',
    '## Queries',
    '',
    '## Synthesis',
    '',
  ].join('\n'))

  // log.md — action timeline
  writeIfMissing(path.join(root, 'log.md'), [
    '# Wiki Log',
    '',
    '> Chronological record of wiki operations. Append-only.',
    '> Format: `## [YYYY-MM-DD] action | subject`',
    '',
    `## [${today}] create | Wiki initialized`,
    '- Structure created with SCHEMA.md, purpose.md, index.md, log.md',
    '',
  ].join('\n'))

  // overview.md — global summary
  writeIfMissing(path.join(root, 'overview.md'), [
    '# Wiki Overview',
    '',
    '(This page is auto-updated by the wiki. It summarizes what the wiki covers.',
    'Read it for a quick sense of the whole knowledge base.)',
    '',
    '_Empty — add sources to begin._',
    '',
  ].join('\n'))

  return { created: !existed, root }
}

function writeIfMissing(filePath: string, content: string): void {
  if (fs.existsSync(filePath)) return
  fs.writeFileSync(filePath, content, 'utf-8')
}

/** List all markdown pages in the wiki with basic metadata. */
export function listWikiPages(): Array<{ path: string; relPath: string; type: string; title: string }> {
  const root = wikiRoot()
  if (!fs.existsSync(root)) return []

  const results: Array<{ path: string; relPath: string; type: string; title: string }> = []

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.name.endsWith('.md')) {
        const rel = path.relative(root, full)
        const content = tryRead(full)
        const { title, type } = parseFrontmatter(content)
        results.push({
          path: full,
          relPath: rel,
          type: type || inferTypeFromPath(rel),
          title: title || entry.name.replace(/\.md$/, ''),
        })
      }
    }
  }
  walk(root)
  return results
}

function tryRead(p: string): string {
  try { return fs.readFileSync(p, 'utf-8') } catch { return '' }
}

function parseFrontmatter(content: string): { title: string; type: string; sources: string[]; tags: string[] } {
  const m = content.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return { title: '', type: '', sources: [], tags: [] }
  const fm = m[1]
  const title = (fm.match(/^title:\s*["']?(.+?)["']?\s*$/m) || [])[1] || ''
  const type = (fm.match(/^type:\s*["']?(.+?)["']?\s*$/m) || [])[1] || ''
  const sources: string[] = []
  const tags: string[] = []
  // inline array: sources: ["a", "b"]
  const srcInline = fm.match(/^sources:\s*\[([^\]]*)\]/m)
  if (srcInline) {
    for (const item of srcInline[1].split(',')) {
      const t = item.trim().replace(/^["']|["']$/g, '')
      if (t) sources.push(t)
    }
  }
  const tagInline = fm.match(/^tags:\s*\[([^\]]*)\]/m)
  if (tagInline) {
    for (const item of tagInline[1].split(',')) {
      const t = item.trim().replace(/^["']|["']$/g, '')
      if (t) tags.push(t)
    }
  }
  return { title, type, sources, tags }
}

function inferTypeFromPath(relPath: string): string {
  const parts = relPath.split(/[\\/]/)
  if (parts.length > 1) {
    const dir = parts[0]
    if (WIKI_DIRS.includes(dir)) return dir.replace(/s$/, '')
  }
  return 'page'
}

/** Wiki-wide stats for the UI. */
export function getWikiStats(): WikiStats {
  const root = wikiRoot()
  const pages = listWikiPages()
  const byType: Record<string, number> = {}
  for (const p of pages) {
    byType[p.type] = (byType[p.type] || 0) + 1
  }
  const hasIndex = fs.existsSync(path.join(root, 'index.md'))
  const hasPurpose = fs.existsSync(path.join(root, 'purpose.md'))
  let lastLogEntry: string | null = null
  try {
    const log = fs.readFileSync(path.join(root, 'log.md'), 'utf-8')
    const entries = log.match(/^## \[[^\]]+\][^\n]*/gm) || []
    if (entries.length > 0) lastLogEntry = entries[entries.length - 1]
  } catch { /* ignore */ }

  return {
    root,
    total: pages.length,
    byType,
    hasIndex,
    hasPurpose,
    lastLogEntry,
  }
}

/** Append a line to wiki/log.md. */
export function appendLog(entry: string): void {
  const logPath = path.join(wikiRoot(), 'log.md')
  const current = tryRead(logPath)
  const newContent = current.endsWith('\n') ? current + entry + '\n' : current + '\n' + entry + '\n'
  fs.writeFileSync(logPath, newContent, 'utf-8')
}

/** Write a wiki file relative to wikiRoot (e.g. 'entities/alice.md'). */
export function writeWikiFile(relPath: string, content: string): void {
  const full = path.join(wikiRoot(), relPath)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content, 'utf-8')
}

/** Read a wiki file by relative path. */
export function readWikiFile(relPath: string): string | null {
  const full = path.join(wikiRoot(), relPath)
  if (!fs.existsSync(full)) return null
  try { return fs.readFileSync(full, 'utf-8') } catch { return null }
}

// ── Graph data ────────────────────────────────────────────────────────

export interface WikiGraphNode {
  id: string        // relPath without .md (slug)
  relPath: string
  title: string
  type: string       // entity | concept | source | page
  resourceType?: string  // link | image | video | text (only for source pages)
}

export interface WikiGraphEdge {
  source: string
  target: string
  type: 'wikilink' | 'source-ref'
}

export interface WikiGraphData {
  nodes: WikiGraphNode[]
  edges: WikiGraphEdge[]
}

/** Build graph data from all wiki pages: nodes from pages, edges from [[wikilinks]] + sources[]. */
export function getWikiGraph(): WikiGraphData {
  const root = wikiRoot()
  if (!fs.existsSync(root)) return { nodes: [], edges: [] }

  const pages = listWikiPages()
  const SYSTEM = new Set(['SCHEMA.md', 'index.md', 'log.md', 'overview.md', 'purpose.md'])

  // Build node map (slug → node)
  const nodeMap = new Map<string, WikiGraphNode>()
  const pathToSlug = (relPath: string): string => relPath.replace(/\.md$/, '')

  for (const p of pages) {
    if (SYSTEM.has(p.relPath)) continue
    const slug = pathToSlug(p.relPath)
    const content = tryRead(p.path)
    const fm = parseFrontmatter(content)
    const rtMatch = content.match(/^resourceType:\s*(.+)$/m)
    nodeMap.set(slug, {
      id: slug,
      relPath: p.relPath,
      title: fm.title || p.title,
      type: fm.type || p.type,
      resourceType: rtMatch?.[1]?.trim(),
    })
  }

  // Extract edges — use global dedup set to prevent bidirectional duplicates (A↔B)
  const edges: WikiGraphEdge[] = []
  const seenEdges = new Set<string>()
  const WIKILINK_RE = /\[\[([^\]]+)\]\]/g

  for (const p of pages) {
    if (SYSTEM.has(p.relPath)) continue
    const slug = pathToSlug(p.relPath)
    const content = tryRead(p.path)

    // Wikilink edges: [[target-slug]]
    let m: RegExpExecArray | null
    WIKILINK_RE.lastIndex = 0
    while ((m = WIKILINK_RE.exec(content)) !== null) {
      const target = m[1].trim().toLowerCase()
      if (target === slug) continue
      const resolved = resolveWikilinkTarget(target, nodeMap)
      if (resolved) {
        // Direction-agnostic key: sort endpoints so A→B and B→A share one edge
        const edgeKey = [slug, resolved].sort().join('↔')
        if (!seenEdges.has(edgeKey)) {
          seenEdges.add(edgeKey)
          edges.push({ source: slug, target: resolved, type: 'wikilink' })
        }
      }
    }

    // Source-ref edges: frontmatter sources[] → linked pages that share the same source ID
    const fm = parseFrontmatter(content)
    for (const srcId of fm.sources) {
      for (const [otherSlug, otherNode] of nodeMap) {
        if (otherSlug === slug) continue
        if (otherNode.type === 'source') continue
        const otherContent = tryRead(path.join(root, otherNode.relPath))
        const otherFm = parseFrontmatter(otherContent)
        if (otherFm.sources.includes(srcId)) {
          const edgeKey = [slug, otherSlug].sort().join('↔')
          if (!seenEdges.has(edgeKey)) {
            seenEdges.add(edgeKey)
            edges.push({ source: slug, target: otherSlug, type: 'source-ref' })
          }
        }
      }
    }
  }

  return { nodes: Array.from(nodeMap.values()), edges }
}

/** Resolve a [[wikilink]] target slug to an actual node slug in the map.
 *  Tries: exact match → filename-only match → partial path match. */
function resolveWikilinkTarget(target: string, nodeMap: Map<string, WikiGraphNode>): string | null {
  // Exact match
  if (nodeMap.has(target)) return target
  // Try with common prefixes
  for (const prefix of ['entities/', 'concepts/', 'sources/links/', 'sources/images/', 'sources/videos/', 'sources/notes/', 'sources/']) {
    const prefixed = prefix + target
    if (nodeMap.has(prefixed)) return prefixed
  }
  // Filename-only match (last segment)
  for (const slug of nodeMap.keys()) {
    const parts = slug.split('/')
    if (parts[parts.length - 1] === target) return slug
  }
  return null
}

/** Delete a wiki page. System files (SCHEMA, purpose, overview) cannot be deleted. */
export function deleteWikiFile(relPath: string): boolean {
  const PROTECTED = ['SCHEMA.md', 'purpose.md', 'overview.md']
  if (PROTECTED.includes(relPath)) return false
  const full = path.join(wikiRoot(), relPath)
  if (!fs.existsSync(full)) return false
  fs.unlinkSync(full)
  return true
}

/** Reset all wiki data — removes all wiki files and re-initializes */
export function resetWikiData(): void {
  const root = wikiRoot()
  try { fs.rmSync(root, { recursive: true, force: true }) } catch {}
  initWiki()
  console.log('[Wiki] All data reset')
}
