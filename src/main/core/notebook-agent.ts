/**
 * Notebook Agent registry — one pi-agent-core `Agent` per active session.
 *
 * Why per-session: Agent owns the chat transcript, and we want session
 * affinity for provider caching (pi-ai's sessionId hint). Agents are
 * cheap to construct, but tearing them down loses the in-memory transcript;
 * persistence to disk goes via `appendChatEvent` on every `agent_event`.
 */
import { EventEmitter } from 'events'
import { Agent, type AgentEvent, type AgentTool } from '@earendil-works/pi-agent-core'
import { getModel, Type, type KnownProvider } from '@earendil-works/pi-ai'
import { loadConfig } from './lite-home'
import { appendChatEvent, getSession, readChatLog } from './notebook-storage'
import type { AIProviderType } from '../../shared/types'
import { buildNotebookTools } from './notebook-tools'

// ─── Event forwarding ──────────────────────────────────────────────

export interface AgentForwardEvent {
  type: 'agent_event'
  sessionId: string
  event: AgentEvent
}

const bus = new EventEmitter()
bus.setMaxListeners(0)

export function onAgentEvent(listener: (e: AgentForwardEvent) => void): () => void {
  bus.on('event', listener)
  return () => bus.off('event', listener)
}

// ─── Provider mapping ──────────────────────────────────────────────

/** Map Koto's provider config to a pi-ai (provider, modelId, apiKey) triple.
 *  `openai-compatible` is not yet supported — those users would need their
 *  baseUrl shimmed through a custom pi-ai provider (planned). */
function pickProviderModel(): { provider: KnownProvider; modelId: string; apiKey: string } | null {
  const cfg = loadConfig()
  const providers = cfg.ai?.providers?.filter((p) => p.enabled) ?? []
  if (providers.length === 0) return null

  // Honor featureRouting.chat if it points at a usable provider.
  const routed = cfg.ai?.featureRouting?.chat
  const chosen = (routed && typeof routed === 'object'
    ? providers.find((p) => p.id === routed.providerId)
    : null) ?? providers[0]

  const piProvider = kotoToPiProvider(chosen.type)
  if (!piProvider) return null
  const modelId = (routed && typeof routed === 'object' && routed.model)
    ? routed.model
    : (chosen.models?.[0] ?? chosen.model)
  if (!modelId) return null

  return { provider: piProvider, modelId, apiKey: chosen.apiKey }
}

function kotoToPiProvider(t: AIProviderType): KnownProvider | null {
  switch (t) {
    case 'anthropic': return 'anthropic'
    case 'openai': return 'openai'
    case 'google': return 'google'
    case 'openai-compatible': return null  // requires baseUrl shim, deferred
  }
}

// ─── Per-session agent factory ─────────────────────────────────────

const agents = new Map<string, Agent>()

function buildSystemPrompt(sessionId: string): string {
  const s = getSession(sessionId)
  const goals = s?.customGoals?.trim()
  return [
    'You are Koto Notebook Agent — a research and writing partner grounded in the user\'s notebook sources.',
    '',
    '## Identity',
    '- You ground every factual claim in retrieved passages from the user\'s sources.',
    '- If a source does not contain the answer, you say so — never fabricate.',
    '- For every factual sentence, append a citation marker `[src:<sourceKey>#<passageId>]` immediately after the sentence.',
    '- Multiple citations: chain them, e.g. `[src:c-abc#p2][src:n-12345#p5]`.',
    '',
    '## Tools',
    '- `list_sources` — see what sources are available in this notebook.',
    '- `get_source_summary` — read the auto-generated summary + topics for a source.',
    '- `search_in_sources` — find relevant passages across selected sources.',
    '- `get_passage` — retrieve the exact text of a passage.',
    '',
    'Use tools liberally. It is much better to call `search_in_sources` once than to guess.',
    '',
    goals ? `## Custom goals (user-defined)\n\n${goals.slice(0, 10_000)}\n` : '',
  ].filter(Boolean).join('\n')
}

/** Get or create the Agent for a session. */
async function getOrCreateAgent(sessionId: string): Promise<Agent | { error: string }> {
  let agent = agents.get(sessionId)
  if (agent) return agent

  const picked = pickProviderModel()
  if (!picked) return { error: 'No AI provider configured. Open Settings → AI to add one.' }

  let model
  try {
    // `getModel` is typed against a literal-union; fall back to `as any` for
    // the dynamic modelId — pi-ai accepts unknown model IDs gracefully and
    // surfaces provider errors at request time, which we prefer over a
    // hard install-time gate on every model the user might pick.
    model = getModel(picked.provider as KnownProvider, picked.modelId as never)
  } catch (e) {
    return { error: `Model not registered with pi-ai: ${picked.provider}/${picked.modelId}: ${String(e)}` }
  }

  const tools: AgentTool[] = buildNotebookTools(sessionId)

  agent = new Agent({
    initialState: {
      systemPrompt: buildSystemPrompt(sessionId),
      model,
      tools,
      messages: [],
    },
    convertToLlm: (messages) => messages.filter((m) =>
      // Drop UI-only message types if/when we add them.
      m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult',
    ) as never,
    getApiKey: async () => picked.apiKey,
    sessionId,
    toolExecution: 'parallel',
  })

  // Persist every event + forward to renderer.
  agent.subscribe((event) => {
    appendChatEvent(sessionId, event)
    bus.emit('event', { type: 'agent_event', sessionId, event })
  })

  agents.set(sessionId, agent)
  return agent
}

// ─── Public API used by IPC handler ────────────────────────────────

export async function promptAgent(sessionId: string, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const agentOrErr = await getOrCreateAgent(sessionId)
  if ('error' in agentOrErr) return { ok: false, error: agentOrErr.error }
  void agentOrErr.prompt(text).catch((e) => {
    console.error('[NotebookAgent] prompt failed:', e)
  })
  return { ok: true }
}

export function abortAgent(sessionId: string): boolean {
  const a = agents.get(sessionId)
  if (!a) return false
  a.abort()
  return true
}

export function disposeAgent(sessionId: string): void {
  agents.get(sessionId)?.abort()
  agents.delete(sessionId)
}

// Re-export Type so tool files can build schemas without depending on pi-ai directly.
export { Type }
export { readChatLog }
