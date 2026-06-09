/**
 * Notebook Guide auto-briefing.
 *
 * Triggered by the source pipeline when the first source in a session
 * reaches `ready`. Produces a short cross-source overview that becomes
 * the user's entry point ("here's what's in your notebook"). The briefing
 * is cached on the Session record so reopening the notebook doesn't
 * burn another LLM call.
 */
import { aiChat } from './ai-service'
import { loadConfig } from './lite-home'
import { getSession, saveSession } from './notebook-storage'

export interface BriefingReadyEvent {
  type: 'briefing_ready'
  sessionId: string
  briefing: string
}

type BroadcastFn = (event: BriefingReadyEvent) => void

let broadcast: BroadcastFn | null = null

export function registerBriefingBroadcaster(fn: BroadcastFn): void {
  broadcast = fn
}

/** Generate the briefing if one isn't cached yet. Idempotent + safe to
 *  call from the source pipeline on every source-ready transition. */
export async function maybeGenerateBriefing(sessionId: string): Promise<void> {
  const session = getSession(sessionId)
  if (!session || session.briefing) return

  const ready = Object.values(session.sources).filter((m) => m.status === 'ready' && m.summary)
  if (ready.length === 0) return

  const cfg = loadConfig()
  const providers = cfg.ai?.providers?.filter((p) => p.enabled) ?? []
  const routed = cfg.ai?.featureRouting?.chat
  const provider = (routed && typeof routed === 'object'
    ? providers.find((p) => p.id === (routed as { providerId: string }).providerId)
    : null) ?? providers[0]
  if (!provider) return
  const model = (routed && typeof routed === 'object' ? (routed as { model?: string }).model : undefined)
    ?? provider.models?.[0] ?? provider.model

  const sourcesBlock = ready.map((m) =>
    `### ${m.title}\n  src:${m.key}\n  ${m.summary}\n  topics: ${(m.topics ?? []).join(', ')}`,
  ).join('\n\n')

  const goals = session.customGoals?.trim()

  const system = [
    'You write the "Notebook Guide" — a single short briefing that orients the user to what is in their notebook.',
    'Use the per-source summaries below to find the through-line.',
    'Output 1 paragraph (3-5 sentences) of overview + 3-4 bullet points naming the key themes spanning the sources.',
    'Cite each theme with `[src:<key>]` markers. Be honest about gaps.',
    'Match the language of the source titles when possible.',
    goals ? `\nUser goals: ${goals.slice(0, 4000)}` : '',
  ].filter(Boolean).join('\n')

  const user = `Notebook title: ${session.name}\n\n## Sources ready in this notebook\n\n${sourcesBlock}`

  try {
    const result = await aiChat(provider.id, [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], 0.3, 700, false, undefined, model)
    if (!result.ok) return
    const briefing = result.data.content.trim()
    if (!briefing) return

    const updated = saveSession({ ...session, briefing })
    broadcast?.({ type: 'briefing_ready', sessionId: updated.id, briefing })
  } catch (e) {
    console.warn('[NotebookBriefing] generation failed:', e)
  }
}
