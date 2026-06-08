/**
 * Prompt builders for the Notebook agent.
 *
 * Source grounding is enforced *in the system prompt* + a strict citation
 * convention: the model is asked to write `[src:<id>]` right after any claim
 * that comes from a specific source. We then post-process the answer to turn
 * these markers into numbered `[N]` badges (numbered per first-appearance).
 */
import type { Notebook, NotebookSource } from '../../../shared/notebook'

/** Truncate a source body to keep total context manageable. */
const PER_SOURCE_CHAR_LIMIT = 18000

function trimSource(content: string): string {
  if (content.length <= PER_SOURCE_CHAR_LIMIT) return content
  // Keep head + tail so cited mentions toward the end of long docs survive.
  const head = content.slice(0, PER_SOURCE_CHAR_LIMIT * 0.7)
  const tail = content.slice(-PER_SOURCE_CHAR_LIMIT * 0.3)
  return `${head}\n\n…[truncated]…\n\n${tail}`
}

/** Build the grounding system prompt for a chat or report turn. */
export function buildSystemPrompt(activeSources: NotebookSource[]): string {
  const sourcesBlock = activeSources
    .filter((s) => s.content && s.content.trim().length > 0)
    .map((s) => `### src:${s.id} — ${s.title}\n\n${trimSource(s.content!)}`)
    .join('\n\n---\n\n')

  return [
    'You are Koto Research Agent — a study and writing partner grounded ONLY in the user-provided sources below.',
    '',
    '## Rules',
    '- Answer using ONLY the provided sources. If the answer is not in the sources, say so plainly.',
    '- Do NOT invent facts, URLs, names, numbers, or quotes.',
    '- For every factual claim, append a citation marker `[src:<id>]` IMMEDIATELY after the sentence that contains it. Example: "Travel demand grew 12% [src:S2]."',
    '- Multiple sources for one claim: chain markers, e.g. `[src:S1][src:S3]`.',
    '- Match the language of the user.',
    '- Be concise and structured; prefer bullets and short paragraphs.',
    '',
    '## Sources',
    '',
    sourcesBlock || '_(no sources — refuse to answer factual questions)_',
  ].join('\n')
}

/** Strict prompt for the Studio "Report" output. */
export function buildReportPrompt(notebook: Notebook, activeSources: NotebookSource[], userBrief?: string): { system: string; user: string } {
  const system = buildSystemPrompt(activeSources)
  const userBriefLine = userBrief?.trim() ? `Focus brief: ${userBrief.trim()}` : 'No specific focus — give a balanced overview.'
  const user = [
    `Write a structured Briefing Report titled "${notebook.name}".`,
    userBriefLine,
    '',
    '## Required structure',
    '1. **# Title** (use the notebook name as the title)',
    '2. **## Executive summary** — 3-5 bullets, each with `[src:X]` citations',
    '3. **## Key themes** — 3-6 themes; for each: short paragraph + citations',
    '4. **## Notable facts & figures** — bullet list, citations after every datum',
    '5. **## Open questions** — what the sources do NOT answer (no citations needed here)',
    '6. **## Sources referenced** — list every source id used in the report',
    '',
    'Output pure Markdown. Do not wrap in code fences.',
  ].join('\n')
  return { system, user }
}
