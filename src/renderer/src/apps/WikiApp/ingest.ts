/**
 * Wiki Ingest — Two-step Chain-of-Thought pipeline.
 *
 * Given a collector item ID:
 *   Step 1 (Analysis): LLM reads the source + wiki purpose + current index,
 *     produces structured analysis of entities/concepts/claims/connections.
 *   Step 2 (Generation): LLM takes its own analysis and outputs wiki files
 *     in a block format we can parse and write to disk.
 *
 * The AI model used comes from `featureRouting.wiki` (or falls back to the
 * user's active chat provider), so heavy ingest work can run on a cheap
 * model without affecting chat / completion quality.
 */
import { useUIStore } from '../../store/useUIStore'
import { useWikiIngestStore } from './ingest-queue'

const FILE_BLOCK_REGEX = /---FILE:\s*([^\n-]+?)\s*---\n([\s\S]*?)---END FILE---/g

export interface IngestResult {
  success: boolean
  filesWritten: string[]
  error?: string
}

/** Pick the LLM provider + model for wiki operations. */
function getWikiProvider(): { provider: { id: string; name: string }; model: string } | null {
  const store = useUIStore.getState()
  // Prefer the dedicated 'wiki' feature route
  const routed = store.getAIProviderForFeature('wiki')
  if (routed) return routed
  // Fallback to 'chat' route
  return store.getAIProviderForFeature('chat')
}

/** Fetch a collector item's readable content (markdown, OCR, or note). */
async function loadSourceContent(itemId: string): Promise<{
  title: string
  type: string
  url?: string
  content: string
} | null> {
  // Use the collector Bus tool layer — respects the app's API surface
  const listRes = (await window.api.collector.list(1000, 0)) as { ok: boolean; data?: Array<Record<string, unknown>> }
  if (!listRes.ok || !listRes.data) return null
  const item = listRes.data.find((i) => i.id === itemId)
  if (!item) return null

  const itemType = item.type as string
  const itemUrl = item.url as string | undefined
  const itemTitle = item.title as string
  const itemNote = item.note as string | undefined

  // For link/tweet types, try to get the extracted markdown
  let content = ''
  if (itemUrl && (itemType === 'link' || itemType === 'tweet')) {
    const mdRes = (await window.api.collector.getMarkdown(itemId)) as { ok: boolean; data?: string | null }
    if (mdRes.ok && mdRes.data) content = mdRes.data
  }
  // Fall back to note (which may contain description + OCR merged)
  if (!content && itemNote) content = itemNote
  // Last fallback: title
  if (!content) content = itemTitle

  return {
    title: itemTitle,
    type: itemType,
    url: itemUrl,
    content,
  }
}

/** Call the LLM via Bus, returning the full text response. */
async function callLLM(
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const routed = getWikiProvider()
  if (!routed) {
    throw new Error('No AI provider configured for wiki. Configure one in Settings → AI → Feature Routing → Wiki Ingest.')
  }
  const { provider, model } = routed
  const result = await window.api.ai.chat(
    provider.id,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    0.3,
    4096,
    false, // no tools — keeps it simple and cheap
    model,
  )
  if (!result.ok) throw new Error(result.error || 'AI call failed')
  return result.data.content
}

// ── Prompts ────────────────────────────────────────────────────────────

const LANGUAGE_RULE = 'Match the language of the source document. If the source is in Chinese, write in Chinese. If in English, write in English.'

function buildAnalysisPrompt(purpose: string, index: string): string {
  return [
    'You are an expert research analyst building a personal wiki from source documents.',
    'Read the source and produce a structured analysis the wiki generator will use next.',
    '',
    LANGUAGE_RULE,
    '',
    'Your analysis MUST cover:',
    '',
    '## Key Entities',
    'People, organizations, products, tools mentioned. For each give:',
    '- Name',
    '- Type (person | org | product | tool | dataset)',
    '- Role in this source (central / peripheral)',
    '- Whether it likely already has a page in the wiki (check the index)',
    '',
    '## Key Concepts',
    'Theories, methods, techniques, ideas. For each:',
    '- Name',
    '- Brief definition (one sentence)',
    '- Why it matters in this source',
    '',
    '## Main Claims',
    'The 2-5 most important claims or findings in the source. Cite evidence briefly.',
    '',
    '## Connections to Existing Wiki',
    'Based on the index below, which existing pages does this source relate to?',
    'Does it strengthen, challenge, or extend existing knowledge?',
    '',
    '## Recommendations',
    'What wiki pages should be created or updated from this source?',
    '',
    'Be thorough but concise. Do not make things up.',
    '',
    purpose ? `## Wiki Purpose (for context)\n${purpose}\n` : '',
    index ? `## Current Wiki Index\n${index}\n` : '',
  ].filter(Boolean).join('\n')
}

function buildGenerationPrompt(
  schema: string,
  purpose: string,
  sourceTitle: string,
  sourceId: string,
): string {
  const today = new Date().toISOString().slice(0, 10)
  const baseName = sourceId.slice(0, 12)

  return [
    'You are a wiki maintainer. Based on the provided analysis, generate wiki files.',
    '',
    LANGUAGE_RULE,
    '',
    '## Output Format',
    '',
    'Output each wiki file in this exact block format:',
    '',
    '---FILE: path/to/file.md---',
    '(complete file content with YAML frontmatter)',
    '---END FILE---',
    '',
    '## What to Generate',
    '',
    `1. **Source summary page** at \`sources/${baseName}.md\` — mandatory, always include`,
    `2. **Entity pages** at \`entities/<slug>.md\` for each key entity from the analysis`,
    `3. **Concept pages** at \`concepts/<slug>.md\` for each key concept from the analysis`,
    `4. **Updated \`index.md\`** — add new entries under their categories, PRESERVE existing entries, replace the entire index.md content`,
    `5. **Log entry** at \`log.md\` — use the append format:`,
    `   ---FILE: log.md---`,
    `   ## [${today}] ingest | ${sourceTitle}`,
    `   - (what was added)`,
    `   ---END FILE---`,
    `   (the system will append this to the existing log, do not include old entries)`,
    '',
    '## Frontmatter Rules (MANDATORY)',
    '',
    'Every page MUST start with:',
    '```yaml',
    '---',
    'title: Human-readable Title',
    'type: entity | concept | source | comparison | query | synthesis',
    `created: ${today}`,
    `updated: ${today}`,
    'tags: []',
    `sources: ["${sourceId}"]`,
    'related: []',
    '---',
    '```',
    '',
    'Other rules:',
    '- Use `[[wikilink]]` syntax for cross-references (e.g. `[[alice]]`, `[[transformer-architecture]]`)',
    '- Use kebab-case slugs for filenames',
    '- Keep each page focused (≤ 500 words)',
    '- Cross-reference aggressively — the analysis found connections, encode them as wikilinks',
    '',
    purpose ? `## Wiki Purpose (for context)\n${purpose}\n` : '',
    schema ? `## Wiki Schema (structural rules)\n${schema}\n` : '',
  ].filter(Boolean).join('\n')
}

// ── Parser ─────────────────────────────────────────────────────────────

function parseFileBlocks(text: string): Array<{ relPath: string; content: string }> {
  const blocks: Array<{ relPath: string; content: string }> = []
  let m: RegExpExecArray | null
  FILE_BLOCK_REGEX.lastIndex = 0
  while ((m = FILE_BLOCK_REGEX.exec(text)) !== null) {
    const relPath = m[1].trim()
    const content = m[2]
    if (relPath) blocks.push({ relPath, content })
  }
  return blocks
}

// ── Main entry ─────────────────────────────────────────────────────────

export async function runIngest(collectorItemId: string): Promise<IngestResult> {
  const store = useWikiIngestStore.getState()
  store.updateStatus(collectorItemId, { status: 'running', error: undefined })

  try {
    // 1. Load source
    const src = await loadSourceContent(collectorItemId)
    if (!src || !src.content.trim()) {
      throw new Error('Source has no readable content')
    }

    // 2. Load wiki context (purpose, schema, index)
    await window.api.wiki.init() // ensure exists
    const readWikiText = async (p: string): Promise<string> => {
      const r = await window.api.wiki.read(p)
      return r.ok && r.data ? r.data : ''
    }
    const [purpose, schema, index] = await Promise.all([
      readWikiText('purpose.md'),
      readWikiText('SCHEMA.md'),
      readWikiText('index.md'),
    ])

    // Truncate long sources to keep ingest affordable
    const truncated = src.content.length > 20000
      ? src.content.slice(0, 20000) + '\n\n[...truncated...]'
      : src.content

    // 3. Step 1 — Analysis
    const analysisSystem = buildAnalysisPrompt(purpose, index)
    const analysisUser = [
      `Source title: **${src.title}**`,
      src.url ? `Source URL: ${src.url}` : '',
      '',
      '--- SOURCE CONTENT ---',
      '',
      truncated,
    ].filter(Boolean).join('\n')
    const analysis = await callLLM(analysisSystem, analysisUser)

    // 4. Step 2 — Generation
    const generationSystem = buildGenerationPrompt(schema, purpose, src.title, collectorItemId)
    const generationUser = [
      `Generate the wiki files for source **${src.title}** (ID: ${collectorItemId}).`,
      '',
      '## Analysis from Step 1',
      '',
      analysis,
      '',
      '## Original Source (for reference)',
      '',
      truncated.slice(0, 8000), // smaller context in step 2
    ].join('\n')
    const generation = await callLLM(generationSystem, generationUser)

    // 5. Parse and write files
    const blocks = parseFileBlocks(generation)
    const writtenPaths: string[] = []

    for (const block of blocks) {
      if (block.relPath === 'log.md') {
        // Append, don't overwrite
        await window.api.wiki.appendLog(block.content.trim())
        writtenPaths.push('log.md')
      } else {
        await window.api.wiki.write(block.relPath, block.content)
        writtenPaths.push(block.relPath)
      }
    }

    // Fallback: if no source summary was generated, create a minimal one
    const hasSummary = writtenPaths.some((p) => p.startsWith('sources/'))
    if (!hasSummary) {
      const baseName = collectorItemId.slice(0, 12)
      const today = new Date().toISOString().slice(0, 10)
      const fallback = [
        '---',
        `title: "${src.title}"`,
        'type: source',
        `created: ${today}`,
        `updated: ${today}`,
        'tags: []',
        `sources: ["${collectorItemId}"]`,
        'related: []',
        '---',
        '',
        `# ${src.title}`,
        '',
        src.url ? `**Source:** ${src.url}\n` : '',
        '## Analysis',
        '',
        analysis.slice(0, 3000),
      ].filter(Boolean).join('\n')
      await window.api.wiki.write(`sources/${baseName}.md`, fallback)
      writtenPaths.push(`sources/${baseName}.md`)
    }

    store.updateStatus(collectorItemId, {
      status: 'done',
      filesWritten: writtenPaths,
    })

    return { success: true, filesWritten: writtenPaths }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.warn('[Wiki ingest] failed:', error)
    store.updateStatus(collectorItemId, { status: 'error', error })
    return { success: false, filesWritten: [], error }
  }
}
