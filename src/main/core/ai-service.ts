import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import type {
  AIProviderConfig,
  AIChatMessage,
  AIChatResponse,
  IpcResult
} from '../../shared/types'
import { loadConfig } from './lite-home'

function getProvider(providerId: string): AIProviderConfig | null {
  const config = loadConfig()
  return config.ai.providers.find((p) => p.id === providerId) ?? null
}

/** Send a chat completion request to the specified provider */
export async function aiChat(
  providerId: string,
  messages: AIChatMessage[],
  temperature = 0.7,
  maxTokens = 4096
): Promise<IpcResult<AIChatResponse>> {
  const provider = getProvider(providerId)
  if (!provider) return { ok: false, error: 'Provider not found' }
  if (!provider.enabled) return { ok: false, error: 'Provider is disabled' }
  if (!provider.apiKey) return { ok: false, error: 'API key not configured' }

  try {
    if (provider.type === 'anthropic') {
      return await callAnthropic(provider, messages, temperature, maxTokens)
    }
    // openai, google, openai-compatible all use OpenAI SDK
    return await callOpenAICompatible(provider, messages, temperature, maxTokens)
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
  maxTokens: number
): Promise<IpcResult<AIChatResponse>> {
  const client = new OpenAI({
    apiKey: provider.apiKey,
    baseURL: provider.baseUrl || undefined,
  })

  const resp = await client.chat.completions.create({
    model: provider.model,
    messages,
    temperature,
    max_tokens: maxTokens,
  })

  const choice = resp.choices[0]
  return {
    ok: true,
    data: {
      content: choice?.message?.content || '',
      model: resp.model,
      usage: resp.usage
        ? {
            promptTokens: resp.usage.prompt_tokens,
            completionTokens: resp.usage.completion_tokens,
          }
        : undefined,
    },
  }
}

async function callAnthropic(
  provider: AIProviderConfig,
  messages: AIChatMessage[],
  temperature: number,
  maxTokens: number
): Promise<IpcResult<AIChatResponse>> {
  const client = new Anthropic({ apiKey: provider.apiKey })

  // Extract system message
  const systemMsgs = messages.filter((m) => m.role === 'system')
  const nonSystemMsgs = messages.filter((m) => m.role !== 'system')

  const resp = await client.messages.create({
    model: provider.model,
    max_tokens: maxTokens,
    temperature,
    system: systemMsgs.map((m) => m.content).join('\n') || undefined,
    messages: nonSystemMsgs.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  })

  const textBlock = resp.content.find((b) => b.type === 'text')
  return {
    ok: true,
    data: {
      content: textBlock?.text || '',
      model: resp.model,
      usage: {
        promptTokens: resp.usage.input_tokens,
        completionTokens: resp.usage.output_tokens,
      },
    },
  }
}
