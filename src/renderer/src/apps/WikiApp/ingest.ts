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

/** Resource type categories the wiki cares about. */
export type WikiResourceType = 'link' | 'image' | 'video' | 'text'

/** Fully loaded source payload — type-aware, so the ingest pipeline can
 *  branch on `resourceType` and pick an appropriate prompt + page layout. */
export interface LoadedSource {
  /** The underlying collector item type (link/image/video/tweet/text/screenshot). */
  collectorType: string
  /** Normalized high-level type the wiki reasons about. */
  resourceType: WikiResourceType
  title: string
  url?: string
  /** Main textual content — varies per type:
   *    link/tweet → extracted markdown article
   *    image/screenshot → visual description + OCR text
   *    video → title + note/description
   *    text → note body */
  content: string
  /** Image/video asset reference (wiki-internal path, for frontmatter). */
  assetPath?: string
  /** Raw image OCR text (only present for image/screenshot). */
  ocrText?: string
  /** Raw image visual description (only present for image/screenshot). */
  imageDescription?: string
}

/** Map the 6 collector item types down to 4 wiki resource categories. */
function classifyResource(collectorType: string): WikiResourceType {
  if (collectorType === 'image' || collectorType === 'screenshot') return 'image'
  if (collectorType === 'video') return 'video'
  if (collectorType === 'link' || collectorType === 'tweet') return 'link'
  return 'text'
}

/** Fetch a collector item and build a type-aware source payload. */
async function loadSourceContent(itemId: string): Promise<LoadedSource | null> {
  // Use the collector Bus tool layer — respects the app's API surface
  const listRes = (await window.api.collector.list(1000, 0)) as { ok: boolean; data?: Array<Record<string, unknown>> }
  if (!listRes.ok || !listRes.data) return null
  const item = listRes.data.find((i) => i.id === itemId)
  if (!item) return null

  const collectorType = item.type as string
  const resourceType = classifyResource(collectorType)
  const itemUrl = item.url as string | undefined
  const itemTitle = item.title as string
  const itemNote = item.note as string | undefined
  const itemAssetPath = item.assetPath as string | undefined
  const meta = (item.meta as Record<string, unknown>) || {}
  const ocrText = typeof meta.ocrText === 'string' ? meta.ocrText : undefined
  const imageDescription = typeof meta.imageDescription === 'string' ? meta.imageDescription : undefined
  const metaDescription = typeof meta.description === 'string' ? meta.description : undefined

  let content = ''

  switch (resourceType) {
    case 'link': {
      // Prefer fetched markdown; fall back to og:description/note.
      if (itemUrl) {
        const mdRes = (await window.api.collector.getMarkdown(itemId)) as { ok: boolean; data?: string | null }
        if (mdRes.ok && mdRes.data) content = mdRes.data
      }
      if (!content) content = [metaDescription, itemNote].filter(Boolean).join('\n\n')
      break
    }
    case 'image': {
      // Use visual description + OCR text (already merged into note by ocrAndDescribeItem,
      // but build deterministically here so failure modes are predictable).
      const parts: string[] = []
      if (imageDescription) parts.push(`**Visual description:** ${imageDescription}`)
      if (ocrText) parts.push(`**Extracted text:**\n${ocrText}`)
      if (!parts.length && itemNote) parts.push(itemNote)
      content = parts.join('\n\n')
      break
    }
    case 'video': {
      // No transcription pipeline yet — work with what's available.
      content = [metaDescription, itemNote].filter(Boolean).join('\n\n')
      break
    }
    case 'text': {
      content = itemNote || ''
      break
    }
  }

  // Universal last-ditch fallback
  if (!content) content = itemTitle

  return {
    collectorType,
    resourceType,
    title: itemTitle,
    url: itemUrl,
    content,
    assetPath: itemAssetPath,
    ocrText,
    imageDescription,
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

/** Per-type guidance block injected into the analysis prompt. Each resource
 *  type has different "what to extract" rules — e.g. an image's key entities
 *  are visual objects, a link article's are people/orgs/technologies. */
function resourceTypeGuidance(rt: WikiResourceType): string {
  switch (rt) {
    case 'link':
      return [
        '## Resource Type: LINK / ARTICLE',
        'This source is an article or web page. Focus your extraction on:',
        '- Named entities (people, orgs, products, tools, datasets)',
        '- Concepts, methods, theories',
        '- Main claims + cited evidence',
        '- Publication/author context if derivable',
      ].join('\n')
    case 'image':
      return [
        '## Resource Type: IMAGE / SCREENSHOT',
        'This source is a visual asset. You are given:',
        '- A visual description (what the image depicts)',
        '- OCR-extracted text (any readable text in the image)',
        'Focus your extraction on:',
        '- Visual subjects + setting (what / where / who is depicted)',
        '- Text content (if it is a screenshot of an article, UI, slide, chart, etc.)',
        '- Tools, UIs, brands, products visible in the frame',
        '- Do NOT hallucinate details not present in the description or OCR',
      ].join('\n')
    case 'video':
      return [
        '## Resource Type: VIDEO',
        'This source is a video clip. You only have its title + description — no transcript.',
        'Be conservative: extract what the title/description reliably indicate, no more.',
        'Mark anything uncertain as speculative.',
      ].join('\n')
    case 'text':
      return [
        '## Resource Type: TEXT / NOTE',
        'This source is a user-authored note or pasted text. Treat it as first-person thinking.',
        'Focus your extraction on:',
        '- Core ideas and claims',
        '- Entities the user references',
        '- Questions or open threads the user is exploring',
      ].join('\n')
  }
}

function buildAnalysisPrompt(purpose: string, index: string, resourceType: WikiResourceType): string {
  return [
    'You are an expert research analyst building a personal wiki from source documents.',
    'Read the source and produce a structured analysis the wiki generator will use next.',
    '',
    LANGUAGE_RULE,
    '',
    resourceTypeGuidance(resourceType),
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

/** Each resource type lives under its own `sources/<type>/` subdirectory so
 *  the wiki file tree mirrors the resource taxonomy. Slug stays the same so
 *  source traceability (via frontmatter `sources: [<collectorItemId>]`) is
 *  unaffected. */
function sourceSubdirForType(rt: WikiResourceType): string {
  switch (rt) {
    case 'link':  return 'sources/links'
    case 'image': return 'sources/images'
    case 'video': return 'sources/videos'
    case 'text':  return 'sources/notes'
  }
}

function buildGenerationPrompt(
  schema: string,
  purpose: string,
  sourceTitle: string,
  sourceId: string,
  resourceType: WikiResourceType,
  assetPath: string | undefined,
): string {
  const today = new Date().toISOString().slice(0, 10)
  const baseName = sourceId.slice(0, 12)
  const sourceDir = sourceSubdirForType(resourceType)
  const sourcePath = `${sourceDir}/${baseName}.md`

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
    `1. **Source summary page** at \`${sourcePath}\` — mandatory, always include.`,
    `   Resource type is **${resourceType}** — title/sections should reflect that.`,
    `2. **Entity pages** at \`entities/<slug>.md\` for each key entity from the analysis`,
    `3. **Concept pages** at \`concepts/<slug>.md\` for each key concept from the analysis`,
    `4. **Updated \`index.md\`** — add new entries under their categories, PRESERVE existing entries, replace the entire index.md content.`,
    `   IMPORTANT: sources are split by type under subfolders: \`sources/links/\`, \`sources/images/\`, \`sources/videos/\`, \`sources/notes/\`. Reflect that in the index.`,
    `5. **Log entry** at \`log.md\` — use the append format:`,
    `   ---FILE: log.md---`,
    `   ## [${today}] ingest ${resourceType} | ${sourceTitle}`,
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
    `Additional frontmatter required on the source summary page (\`${sourcePath}\`):`,
    '```yaml',
    `resourceType: ${resourceType}`,
    assetPath ? `asset: "${assetPath}"` : '',
    '```',
    '',
    'Other rules:',
    '- Use `[[wikilink]]` syntax for cross-references (e.g. `[[alice]]`, `[[transformer-architecture]]`)',
    '- Use kebab-case slugs for filenames',
    '- Keep each page focused (≤ 500 words)',
    '- Cross-reference aggressively — the analysis found connections, encode them as wikilinks',
    resourceType === 'image'
      ? '- For the image source page: include the visual description AND the OCR text as separate sections. Do NOT invent details the description/OCR does not support.'
      : '',
    resourceType === 'video'
      ? '- For the video source page: state clearly that no transcript is available, and keep claims conservative.'
      : '',
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

    // 3. Step 1 — Analysis (resource-type aware)
    const analysisSystem = buildAnalysisPrompt(purpose, index, src.resourceType)
    const analysisUser = [
      `Source title: **${src.title}**`,
      `Resource type: **${src.resourceType}** (collector type: ${src.collectorType})`,
      src.url ? `Source URL: ${src.url}` : '',
      src.assetPath ? `Asset path (wiki-internal): ${src.assetPath}` : '',
      '',
      '--- SOURCE CONTENT ---',
      '',
      truncated,
    ].filter(Boolean).join('\n')
    const analysis = await callLLM(analysisSystem, analysisUser)

    // 4. Step 2 — Generation (resource-type aware)
    const generationSystem = buildGenerationPrompt(
      schema,
      purpose,
      src.title,
      collectorItemId,
      src.resourceType,
      src.assetPath,
    )
    const generationUser = [
      `Generate the wiki files for source **${src.title}** (ID: ${collectorItemId}).`,
      `Resource type: **${src.resourceType}**`,
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

    // Fallback: if no source summary was generated, create a minimal one.
    // Use the resource-type subdirectory so the file tree stays consistent.
    const hasSummary = writtenPaths.some((p) => p.startsWith('sources/'))
    if (!hasSummary) {
      const baseName = collectorItemId.slice(0, 12)
      const today = new Date().toISOString().slice(0, 10)
      const subdir = sourceSubdirForType(src.resourceType)
      const relPath = `${subdir}/${baseName}.md`
      const fallback = [
        '---',
        `title: "${src.title}"`,
        'type: source',
        `resourceType: ${src.resourceType}`,
        src.assetPath ? `asset: "${src.assetPath}"` : '',
        `created: ${today}`,
        `updated: ${today}`,
        'tags: []',
        `sources: ["${collectorItemId}"]`,
        'related: []',
        '---',
        '',
        `# ${src.title}`,
        '',
        src.url ? `**Source URL:** ${src.url}\n` : '',
        src.resourceType === 'image' && src.imageDescription
          ? `## Visual Description\n\n${src.imageDescription}\n`
          : '',
        src.resourceType === 'image' && src.ocrText
          ? `## Extracted Text (OCR)\n\n${src.ocrText}\n`
          : '',
        '## Analysis',
        '',
        analysis.slice(0, 3000),
      ].filter(Boolean).join('\n')
      await window.api.wiki.write(relPath, fallback)
      writtenPaths.push(relPath)
    }

    store.updateStatus(collectorItemId, {
      status: 'done',
      filesWritten: writtenPaths,
    })

    // Trigger search index + embedding update for written pages (background, non-blocking)
    window.api.wiki.reindex().catch(() => {})

    return { success: true, filesWritten: writtenPaths }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.warn('[Wiki ingest] failed:', error)
    store.updateStatus(collectorItemId, { status: 'error', error })
    return { success: false, filesWritten: [], error }
  }
}
