/**
 * Wiki Lint — self-healing checks for wiki quality.
 * Detects broken links, orphan pages, stale content, missing frontmatter.
 */
import { listWikiPages, readWikiFile, writeWikiFile, getWikiGraph } from './wiki-store'

export interface LintIssue {
  type: 'broken-link' | 'orphan' | 'stale' | 'missing-frontmatter'
  relPath: string
  detail: string
  fixed: boolean
}

export interface LintReport {
  issues: LintIssue[]
  totalPages: number
  fixedCount: number
}

const SYSTEM_FILES = new Set(['SCHEMA.md', 'index.md', 'log.md', 'overview.md', 'purpose.md'])

export function lintWiki(): LintReport {
  const issues: LintIssue[] = []
  const pages = listWikiPages()
  const contentPages = pages.filter(p => !SYSTEM_FILES.has(p.relPath))
  const allPaths = new Set(contentPages.map(p => p.relPath))
  const allSlugs = new Set(contentPages.map(p => p.relPath.replace(/\.md$/, '')))

  // 1. Check for broken [[wikilinks]]
  for (const page of contentPages) {
    const content = readWikiFile(page.relPath)
    if (!content) continue

    const wikilinks = content.match(/\[\[([^\]]+)\]\]/g) || []
    for (const link of wikilinks) {
      const target = link.slice(2, -2).trim()
      // Try common resolutions
      const candidates = [
        `${target}.md`,
        `entities/${target}.md`,
        `concepts/${target}.md`,
        `sources/${target}.md`,
        `sources/links/${target}.md`,
        `sources/notes/${target}.md`,
      ]
      const found = candidates.some(c => allPaths.has(c) || allSlugs.has(target))
      if (!found) {
        issues.push({
          type: 'broken-link',
          relPath: page.relPath,
          detail: `Broken wikilink: [[${target}]]`,
          fixed: false,
        })
      }
    }
  }

  // 2. Check for orphan pages (no incoming links, not a source page)
  const graph = getWikiGraph()
  const hasIncoming = new Set<string>()
  for (const edge of graph.edges) {
    hasIncoming.add(edge.target + '.md')
    hasIncoming.add(edge.target) // some might not have .md
  }

  for (const page of contentPages) {
    const slug = page.relPath.replace(/\.md$/, '')
    if (page.relPath.startsWith('sources/')) continue // sources are leaf nodes
    if (hasIncoming.has(page.relPath) || hasIncoming.has(slug)) continue
    issues.push({
      type: 'orphan',
      relPath: page.relPath,
      detail: 'No incoming wikilinks — page is disconnected from the graph',
      fixed: false,
    })
  }

  // 3. Check for missing frontmatter
  for (const page of contentPages) {
    const content = readWikiFile(page.relPath)
    if (!content) continue
    if (!content.startsWith('---\n')) {
      // Auto-fix: add minimal frontmatter
      const title = page.title || page.relPath.replace(/\.md$/, '').split('/').pop() || 'Untitled'
      const type = page.relPath.startsWith('entities/') ? 'entity'
        : page.relPath.startsWith('concepts/') ? 'concept'
        : page.relPath.startsWith('sources/') ? 'source'
        : 'page'
      const fm = `---\ntitle: "${title}"\ntype: ${type}\ncreated: ${new Date().toISOString().split('T')[0]}\ntags: []\nsources: []\n---\n`
      writeWikiFile(page.relPath, fm + content)
      issues.push({
        type: 'missing-frontmatter',
        relPath: page.relPath,
        detail: 'Added default frontmatter',
        fixed: true,
      })
    }
  }

  // 4. Check for stale pages (confidence < 0.3 based on age)
  for (const page of contentPages) {
    const content = readWikiFile(page.relPath)
    if (!content) continue
    const updatedMatch = content.match(/^updated:\s*(\d{4}-\d{2}-\d{2})/m)
    if (updatedMatch) {
      const updated = new Date(updatedMatch[1]).getTime()
      const daysSince = (Date.now() - updated) / (1000 * 60 * 60 * 24)
      if (daysSince > 60) {
        issues.push({
          type: 'stale',
          relPath: page.relPath,
          detail: `Last updated ${Math.floor(daysSince)} days ago`,
          fixed: false,
        })
      }
    }
  }

  const fixedCount = issues.filter(i => i.fixed).length
  console.log(`[WikiLint] ${issues.length} issues found, ${fixedCount} auto-fixed`)

  return { issues, totalPages: contentPages.length, fixedCount }
}
