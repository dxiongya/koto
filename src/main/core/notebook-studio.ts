/**
 * Notebook Studio — turns the user's source pool into structured artifacts.
 *
 *   generateReport(sessionId, opts)    → polished markdown article
 *   generateSlideDeck(sessionId, opts) → markdown with `---` slide separators
 *
 * Both go through Koto's existing `aiChat` (no pi-agent-core tool loop
 * required for these one-shot generations) with the selected sources'
 * raw text packed into the system prompt. The agent layer's grounded
 * `[src:key#pId]` citation contract is preserved — the renderer's
 * citation-aware path lights them up in the resulting Note.
 */
import fs from 'fs'
import path from 'path'
import { aiChat } from './ai-service'
import { loadConfig, getLiteHome } from './lite-home'
import {
  getSession, saveSession, readSourceRaw, readSourcePassages,
} from './notebook-storage'
import type { Session, SourceMeta, NotebookProduct } from '../../shared/notebook'

type ProductTypeArg = NotebookProduct['type']

// ─── Source context packer ──────────────────────────────────────────

/** Total characters reserved for source bodies in a single Studio call.
 *  Keeps the prompt within ~150K char ≈ 35K tokens — comfortable for
 *  gpt-4o-class / Claude-Sonnet-class models. */
const TOTAL_CONTEXT_CHARS = 150_000

/** Build the "## Sources" block with each source titled + truncated. */
function packSources(session: Session): { block: string; usedKeys: string[] } {
  const selected: SourceMeta[] = Object.values(session.sources).filter((m) => m.selected && m.status === 'ready')
  if (selected.length === 0) return { block: '', usedKeys: [] }

  // Budget per source = even split. Smaller sources naturally get less of
  // the share back; we don't redistribute leftover to avoid quadratic logic.
  const perSource = Math.floor(TOTAL_CONTEXT_CHARS / selected.length)
  const usedKeys: string[] = []
  const blocks: string[] = []

  for (const m of selected) {
    const raw = readSourceRaw(session.id, m.key) || ''
    if (!raw.trim()) continue
    usedKeys.push(m.key)
    // Pick representative passages instead of raw head — better information
    // density when sources are long-form. Falls back to raw when passages
    // weren't materialized.
    const passages = readSourcePassages(session.id, m.key)
    let body: string
    if (passages.length > 0) {
      // Walk passages in order, stop when budget exceeded; tag each with
      // its passage id so the LLM can use them in `[src:#pId]` form.
      const out: string[] = []
      let used = 0
      for (const p of passages) {
        const tagged = `(${p.id}) ${p.text}`
        if (used + tagged.length > perSource && out.length > 0) break
        out.push(tagged)
        used += tagged.length + 2
      }
      body = out.join('\n\n')
    } else {
      body = raw.slice(0, perSource)
    }
    blocks.push(`### src:${m.key} — ${m.title}\n${m.subtitle ? `(${m.subtitle})\n` : ''}\n${body}`)
  }
  return { block: blocks.join('\n\n---\n\n'), usedKeys }
}

// ─── Preset prompt skeletons ────────────────────────────────────────

export type ReportPreset = 'briefing' | 'academic' | 'faq' | 'study-guide' | 'blog'
export type SlidesPreset = 'short' | 'standard' | 'long'

function reportPresetGuide(preset: ReportPreset): string {
  switch (preset) {
    case 'briefing':
      return [
        'Format: **Briefing document** — executive overview for someone who needs to quickly come up to speed.',
        'Structure:',
        '1. `#` Title',
        '2. `## Executive summary` — 3-5 punchy bullets, each with at least one citation',
        '3. `## Key facts & figures` — bullet list, citations after every datum',
        '4. `## Themes & tensions` — 3-5 short paragraphs naming the patterns and where sources disagree',
        '5. `## Open questions` — what the sources do NOT answer (no citations needed)',
      ].join('\n')
    case 'academic':
      return [
        'Format: **Academic-style article** — a structured paper an editor would accept for a research blog.',
        'Structure:',
        '1. `#` Title (specific, not generic)',
        '2. `## Abstract` — 4-6 sentence summary with citations',
        '3. `## Introduction` — context, why this matters, scope',
        '4. `## Findings` — 3-5 numbered sub-sections; each opens with a claim, then evidence with citations',
        '5. `## Discussion` — synthesis, limits, tensions across sources',
        '6. `## Conclusion`',
      ].join('\n')
    case 'faq':
      return [
        'Format: **FAQ document** — every entry is a real question a reader might ask.',
        'Structure:',
        '1. `#` Title — what topic the FAQ covers',
        '2. A 1-paragraph intro framing scope (with citations)',
        '3. 8-12 entries of:',
        '   ### Q: <question>',
        '   <2-4 sentence answer with citations>',
      ].join('\n')
    case 'study-guide':
      return [
        'Format: **Study guide** — designed to help someone learn the material.',
        'Structure:',
        '1. `#` Title',
        '2. `## Key concepts` — glossary of 6-10 terms, each with a definition + citation',
        '3. `## Core ideas` — 3-5 short essays explaining the big ideas',
        '4. `## Test yourself` — 8-12 short-answer questions (no answers — leave them for the student)',
      ].join('\n')
    case 'blog':
      return [
        'Format: **Blog post** — conversational but substantiated.',
        'Structure:',
        '1. `#` Title — punchy, opinion-ish',
        '2. Strong opening paragraph hooking the reader (with citations)',
        '3. 3-5 `##` sections, each a short readable essay with citations',
        '4. Final `## Wrapping up` — what to take away',
      ].join('\n')
  }
}

function slidesPresetGuide(preset: SlidesPreset): string {
  const range = preset === 'short' ? '5-7' : preset === 'long' ? '14-18' : '8-12'
  return [
    `Format: **Markdown slide deck** — ${range} slides separated by a line containing only \`---\`.`,
    'Every slide:',
    '- Opens with `# Title` (or `##` for sub-sections).',
    '- 3-7 bullets max, each with a citation when factual.',
    '- The FIRST slide is a cover: `# <title>` then a 1-sentence subtitle.',
    '- The LAST slide is "## Sources" listing every src:key referenced.',
    'Do not produce any text outside the slides.',
  ].join('\n')
}

// ─── Top-level callers ──────────────────────────────────────────────

function buildSystemPrompt(session: Session, sourcesBlock: string): string {
  const goals = session.customGoals?.trim()
  return [
    'You are a research writer producing a Studio artifact for a Koto notebook.',
    'Every factual claim MUST include a citation in the form `[src:<sourceKey>#<passageId>]`.',
    'Use ONLY information from the provided sources. If something is not in the sources, say so.',
    'When a passage is referenced as `(pN)` in a source body, you may cite it as `[src:<key>#pN]`.',
    'Match the language of the source material unless otherwise instructed.',
    '',
    goals ? `## Custom goals (from the user, override these defaults when they conflict)\n${goals.slice(0, 10_000)}\n` : '',
    '## Sources',
    '',
    sourcesBlock || '_(no sources available)_',
  ].filter(Boolean).join('\n')
}

interface GenerateResult {
  ok: true
  markdown: string
  notePath: string
  product: NotebookProduct
}

function buildProductDir(kind: 'reports' | 'slides'): string {
  // Live under the regular Notes app so any product is editable +
  // first-class in PaneTree without a new app needing to register.
  const dir = path.join(getLiteHome(), 'notes', kind === 'reports' ? 'Notebook Reports' : 'Notebook Slides')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function safeFilename(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
}

async function runGeneration(
  session: Session,
  productType: ProductTypeArg,
  systemPrompt: string,
  userPrompt: string,
  temperature: number,
  maxTokens: number,
  fileKind: 'reports' | 'slides',
  fileSuffix: string,
  preset: string,
): Promise<GenerateResult | { ok: false; error: string }> {
  const cfg = loadConfig()
  const routed = cfg.ai?.featureRouting?.chat
  const providers = cfg.ai?.providers?.filter((p) => p.enabled) ?? []
  const provider = (routed && typeof routed === 'object'
    ? providers.find((p) => p.id === (routed as { providerId: string }).providerId)
    : null) ?? providers[0]
  if (!provider) return { ok: false, error: 'No AI provider configured.' }
  const model = (routed && typeof routed === 'object' ? (routed as { model?: string }).model : undefined)
    ?? provider.models?.[0] ?? provider.model

  const result = await aiChat(provider.id, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ], temperature, maxTokens, false, undefined, model)
  if (!result.ok) return { ok: false, error: result.error }

  const markdown = result.data.content.trim()
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
  const filename = `${safeFilename(session.name)} · ${preset}${fileSuffix} · ${stamp}.md`
  const dir = buildProductDir(fileKind)
  const notePath = path.join(dir, filename)
  fs.writeFileSync(notePath, markdown, 'utf-8')

  const product: NotebookProduct = {
    id: `p${Date.now()}`,
    type: productType,
    targetPath: notePath,
    label: `${productType === 'report' ? 'Report' : 'Slide deck'} · ${preset}`,
    createdAt: Date.now(),
  }
  const updated = saveSession({ ...session, products: [...session.products, product] })
  void updated
  return { ok: true, markdown, notePath, product }
}

export async function generateReport(sessionId: string, preset: ReportPreset, brief?: string): Promise<GenerateResult | { ok: false; error: string }> {
  const session = getSession(sessionId)
  if (!session) return { ok: false, error: 'session not found' }
  const { block, usedKeys } = packSources(session)
  if (usedKeys.length === 0) return { ok: false, error: 'No selected sources are ready.' }

  const systemPrompt = buildSystemPrompt(session, block)
  const userPrompt = [
    `Write a ${preset} for the notebook titled "${session.name}".`,
    brief?.trim() ? `User focus: ${brief.trim()}` : '',
    '',
    '## Required structure',
    reportPresetGuide(preset),
    '',
    'Output pure Markdown. No prefatory text, no code fences around the whole document.',
  ].filter(Boolean).join('\n')

  return runGeneration(session, 'report', systemPrompt, userPrompt, 0.25, 4000, 'reports', '', preset)
}

export async function generateSlideDeck(sessionId: string, preset: SlidesPreset, brief?: string): Promise<GenerateResult | { ok: false; error: string }> {
  const session = getSession(sessionId)
  if (!session) return { ok: false, error: 'session not found' }
  const { block, usedKeys } = packSources(session)
  if (usedKeys.length === 0) return { ok: false, error: 'No selected sources are ready.' }

  const systemPrompt = buildSystemPrompt(session, block)
  const userPrompt = [
    `Produce a slide deck for the notebook titled "${session.name}".`,
    brief?.trim() ? `Focus: ${brief.trim()}` : '',
    '',
    '## Required structure',
    slidesPresetGuide(preset),
    '',
    'Use `.slides.md` markdown conventions: slides separated by `---` on its own line.',
  ].filter(Boolean).join('\n')

  return runGeneration(session, 'slide-deck', systemPrompt, userPrompt, 0.25, 3500, 'slides', ' deck', preset)
}
