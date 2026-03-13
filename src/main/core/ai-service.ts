import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import type {
  AIProviderConfig,
  AIChatMessage,
  AIChatResponse,
  AIToolEvent,
  IpcResult
} from '../../shared/types'
import { loadConfig } from './lite-home'
import { getAnthropicTools, getOpenAITools, executeTool } from './ai-tools'
import { loadSkills } from './skills-loader'
import { mcpManager } from './mcp-manager'

const MAX_TOOL_ITERATIONS = 100

/** Build a capabilities catalog (skills + MCP tools) for the AI system prompt */
function buildCapabilitiesCatalog(): string {
  const parts: string[] = []

  // ── MCP tools ──
  const mcpTools = mcpManager.getAllTools()
  if (mcpTools.length > 0) {
    // Group by server
    const byServer = new Map<string, typeof mcpTools>()
    for (const t of mcpTools) {
      const list = byServer.get(t.serverName) || []
      list.push(t)
      byServer.set(t.serverName, list)
    }

    const serverEntries: string[] = []
    for (const [serverName, tools] of byServer) {
      const serverId = tools[0]?.serverId || ''
      const serverDesc = mcpManager.getServerDescription(serverId)
      const descAttr = serverDesc ? ` description="${serverDesc}"` : ''
      const toolList = tools
        .map((t) => `    <tool name="mcp_${t.serverId}_${t.name}">${t.description || t.name}</tool>`)
        .join('\n')
      serverEntries.push(`  <server name="${serverName}"${descAttr}>\n${toolList}\n  </server>`)
    }

    parts.push(`<connected_mcp_servers>
${serverEntries.join('\n')}
</connected_mcp_servers>

These are external MCP (Model Context Protocol) tools connected by the user. Use them when the task matches their capability. Call them by their full tool name (e.g. mcp_serverid_toolname).`)
  }

  // ── Skills ──
  const skills = loadSkills()
  if (skills.length > 0) {
    const entries = skills
      .map((s) => `  <skill name="${s.name}" enabled="${s.enabled}">${s.description || 'No description'}</skill>`)
      .join('\n')

    parts.push(`<available_skills>
${entries}
</available_skills>

You have access to the \`use_skill\` tool. When a user's request aligns with one of the available skills, call \`use_skill\` with the skill name to load its full instructions. Then follow those instructions.
- If exactly one skill clearly applies: load and use it.
- If multiple could apply: choose the most specific one.
- If none apply: proceed without loading any skill.`)
  }

  if (parts.length === 0) return ''
  return '\n\n' + parts.join('\n\n')
}

function getProvider(providerId: string): AIProviderConfig | null {
  const config = loadConfig()
  return config.ai.providers.find((p) => p.id === providerId) ?? null
}

/** Send a chat completion request to the specified provider */
export async function aiChat(
  providerId: string,
  messages: AIChatMessage[],
  temperature = 0.7,
  maxTokens = 4096,
  enableTools = false,
  onToolEvent?: (event: AIToolEvent) => void
): Promise<IpcResult<AIChatResponse>> {
  const provider = getProvider(providerId)
  if (!provider) return { ok: false, error: 'Provider not found' }
  if (!provider.enabled) return { ok: false, error: 'Provider is disabled' }
  if (!provider.apiKey) return { ok: false, error: 'API key not configured' }

  try {
    if (provider.type === 'anthropic') {
      return await callAnthropic(provider, messages, temperature, maxTokens, enableTools, onToolEvent)
    }
    // openai, google, openai-compatible all use OpenAI SDK
    return await callOpenAICompatible(provider, messages, temperature, maxTokens, enableTools, onToolEvent)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

/** Test connection by sending a minimal request */
export async function aiTestConnection(
  provider: AIProviderConfig
): Promise<IpcResult<string>> {
  if (!provider.apiKey) return { ok: false, error: 'API key is empty' }

  try {
    if (provider.type === 'anthropic') {
      const client = new Anthropic({ apiKey: provider.apiKey })
      const resp = await client.messages.create({
        model: provider.model || 'claude-sonnet-4-20250514',
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Hi' }],
      })
      return { ok: true, data: `Connected. Model: ${resp.model}` }
    }

    // OpenAI-compatible
    const client = new OpenAI({
      apiKey: provider.apiKey,
      baseURL: provider.baseUrl || undefined,
    })
    const resp = await client.chat.completions.create({
      model: provider.model || 'gpt-4o-mini',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Hi' }],
    })
    return { ok: true, data: `Connected. Model: ${resp.model}` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

// ── Internal call implementations ──

async function callOpenAICompatible(
  provider: AIProviderConfig,
  messages: AIChatMessage[],
  temperature: number,
  maxTokens: number,
  enableTools = false,
  onToolEvent?: (event: AIToolEvent) => void
): Promise<IpcResult<AIChatResponse>> {
  const client = new OpenAI({
    apiKey: provider.apiKey,
    baseURL: provider.baseUrl || undefined,
  })

  const tools = enableTools ? getOpenAITools() : undefined

  // Inject skill catalog into system messages when tools are enabled
  const enrichedMessages = enableTools
    ? messages.map((m) => m.role === 'system' ? { ...m, content: m.content + buildCapabilitiesCatalog() } : m)
    : messages

  // Build initial OpenAI messages
  const oaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
    enrichedMessages.map((m) => ({ role: m.role, content: m.content }))

  let totalPromptTokens = 0
  let totalCompletionTokens = 0

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const resp = await client.chat.completions.create({
      model: provider.model,
      messages: oaiMessages,
      temperature,
      max_tokens: maxTokens,
      tools,
    })

    if (resp.usage) {
      totalPromptTokens += resp.usage.prompt_tokens
      totalCompletionTokens += resp.usage.completion_tokens
    }

    const choice = resp.choices[0]
    if (!choice) break

    // If no tool calls, return final response
    if (choice.finish_reason !== 'tool_calls' || !choice.message.tool_calls?.length) {
      return {
        ok: true,
        data: {
          content: choice.message?.content || '',
          model: resp.model,
          usage: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens },
        },
      }
    }

    // Append assistant message with tool calls
    oaiMessages.push(choice.message)

    // Execute each tool call
    for (const toolCall of choice.message.tool_calls) {
      const toolName = toolCall.function.name
      let toolInput: Record<string, unknown> = {}
      try { toolInput = JSON.parse(toolCall.function.arguments) } catch { /* empty */ }

      onToolEvent?.({ type: 'tool_start', toolName, toolInput })
      const startTime = Date.now()

      const result = await executeTool(toolName, toolInput)

      onToolEvent?.({
        type: 'tool_result',
        toolName,
        result: result.slice(0, 1000),
        durationMs: Date.now() - startTime,
      })

      oaiMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result,
      })
    }
  }

  return { ok: false, error: 'Tool loop exceeded maximum iterations' }
}

async function callAnthropic(
  provider: AIProviderConfig,
  messages: AIChatMessage[],
  temperature: number,
  maxTokens: number,
  enableTools = false,
  onToolEvent?: (event: AIToolEvent) => void
): Promise<IpcResult<AIChatResponse>> {
  const client = new Anthropic({ apiKey: provider.apiKey })

  // Extract system message and inject skill catalog when tools are enabled
  const systemMsgs = messages.filter((m) => m.role === 'system')
  const nonSystemMsgs = messages.filter((m) => m.role !== 'system')
  const capabilitiesCatalog = enableTools ? buildCapabilitiesCatalog() : ''

  const tools = enableTools ? getAnthropicTools() : undefined

  // Build initial Anthropic messages
  const anthropicMessages: Anthropic.Messages.MessageParam[] =
    nonSystemMsgs.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))

  let totalInputTokens = 0
  let totalOutputTokens = 0

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const resp = await client.messages.create({
      model: provider.model,
      max_tokens: maxTokens,
      temperature,
      system: (systemMsgs.map((m) => m.content).join('\n') + capabilitiesCatalog) || undefined,
      messages: anthropicMessages,
      tools,
    })

    totalInputTokens += resp.usage.input_tokens
    totalOutputTokens += resp.usage.output_tokens

    // Check if the response contains tool use blocks
    const toolUseBlocks = resp.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use'
    )

    // If no tool use or stop_reason is end_turn, return final text
    if (resp.stop_reason !== 'tool_use' || toolUseBlocks.length === 0) {
      const textBlock = resp.content.find(
        (b): b is Anthropic.Messages.TextBlock => b.type === 'text'
      )
      return {
        ok: true,
        data: {
          content: textBlock?.text || '',
          model: resp.model,
          usage: {
            promptTokens: totalInputTokens,
            completionTokens: totalOutputTokens,
          },
        },
      }
    }

    // Append the assistant response (with tool_use blocks) to messages
    anthropicMessages.push({ role: 'assistant', content: resp.content })

    // Execute tools and build tool_result blocks
    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = []
    for (const toolUse of toolUseBlocks) {
      const toolInput = (toolUse.input as Record<string, unknown>) || {}

      onToolEvent?.({ type: 'tool_start', toolName: toolUse.name, toolInput })
      const startTime = Date.now()

      const result = await executeTool(toolUse.name, toolInput)

      onToolEvent?.({
        type: 'tool_result',
        toolName: toolUse.name,
        result: result.slice(0, 1000),
        durationMs: Date.now() - startTime,
      })

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result,
      })
    }

    // Append tool results as a user message
    anthropicMessages.push({ role: 'user', content: toolResults })
  }

  return { ok: false, error: 'Tool loop exceeded maximum iterations' }
}
