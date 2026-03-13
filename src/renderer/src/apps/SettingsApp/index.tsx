import React, { useMemo, useState, useCallback, useEffect } from 'react'
import { useUIStore } from '../../store/useUIStore'
import { builtinThemes, getThemeGroups, fontList } from '../../themes'
import type { FontId, ThemeDefinition } from '../../themes'
import type { AIProviderConfig, AIProviderType, AIFeature, MCPServerConfig, Skill, AIToolDefinition } from '../../../../shared/types'
import { AI_PROVIDER_BASE_URLS, AI_PROVIDER_MODELS } from '../../../../shared/types'
import {
  Check, Sun, Moon, Plus, Trash2, Pencil, Zap, Eye, EyeOff,
  Radio, Loader2, BarChart3, RotateCcw, Server, BookOpen,
  Power, PowerOff, RefreshCw, ChevronDown, ChevronRight, Wrench
} from 'lucide-react'

/** Mini app preview using a theme's colors */
const ThemePreview: React.FC<{ t: ThemeDefinition }> = ({ t }) => (
  <div
    className="rounded-md h-[52px] overflow-hidden flex"
    style={{ backgroundColor: t.colors['bg-app'], border: `1px solid ${t.colors['border-subtle']}` }}
  >
    <div className="w-[38%] h-full" style={{ backgroundColor: t.colors['bg-sidebar'] }}>
      <div className="pt-2.5 px-2 space-y-1.5">
        <div className="h-1 w-6 rounded-full" style={{ backgroundColor: t.colors['tx-faint'] }} />
        <div className="h-1 w-9 rounded-full" style={{ backgroundColor: t.colors['accent-main'] }} />
        <div className="h-1 w-7 rounded-full" style={{ backgroundColor: t.colors['tx-faint'] }} />
      </div>
    </div>
    <div className="flex-1 pt-2.5 px-2 space-y-1.5">
      <div className="h-1 w-full rounded-full" style={{ backgroundColor: t.colors['tx-faint'], opacity: 0.35 }} />
      <div className="h-1 w-3/4 rounded-full" style={{ backgroundColor: t.colors['tx-faint'], opacity: 0.25 }} />
      <div className="h-1 w-5/6 rounded-full" style={{ backgroundColor: t.colors['tx-faint'], opacity: 0.18 }} />
    </div>
  </div>
)

// ── Provider type labels ──

const PROVIDER_TYPE_LABELS: Record<AIProviderType, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  google: 'Google (Gemini)',
  'openai-compatible': 'OpenAI Compatible',
}

const PROVIDER_TYPES: AIProviderType[] = ['openai', 'anthropic', 'google', 'openai-compatible']

// ── AI Provider Form ──

interface ProviderFormData {
  name: string
  type: AIProviderType
  apiKey: string
  baseUrl: string
  model: string
}

const AIProviderForm: React.FC<{
  initial?: AIProviderConfig
  onSave: (data: ProviderFormData) => void
  onCancel: () => void
}> = ({ initial, onSave, onCancel }) => {
  const [form, setForm] = useState<ProviderFormData>({
    name: initial?.name ?? '',
    type: initial?.type ?? 'openai',
    apiKey: initial?.apiKey ?? '',
    baseUrl: initial?.baseUrl ?? AI_PROVIDER_BASE_URLS['openai'],
    model: initial?.model ?? '',
  })
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const updateType = useCallback((type: AIProviderType) => {
    setForm((prev) => ({
      ...prev,
      type,
      baseUrl: AI_PROVIDER_BASE_URLS[type] || prev.baseUrl,
      model: AI_PROVIDER_MODELS[type]?.[0] || prev.model,
    }))
    setTestResult(null)
  }, [])

  const suggestedModels = AI_PROVIDER_MODELS[form.type] || []

  const handleTest = useCallback(async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const provider: AIProviderConfig = {
        id: initial?.id ?? 'test',
        name: form.name,
        type: form.type,
        apiKey: form.apiKey,
        baseUrl: form.baseUrl,
        model: form.model,
        enabled: true,
      }
      const res = await window.api.ai.testConnection(provider as unknown as Record<string, unknown>)
      if (res.ok) {
        setTestResult({ ok: true, msg: res.data })
      } else {
        setTestResult({ ok: false, msg: res.error })
      }
    } catch (err) {
      setTestResult({ ok: false, msg: String(err) })
    }
    setTesting(false)
  }, [form, initial])

  const canSave = form.name.trim() && form.apiKey.trim() && form.model.trim()

  return (
    <div className="space-y-4 bg-bg-hover rounded-lg p-4 border border-border-subtle">
      {/* Provider Type */}
      <div>
        <label className="block text-xs text-tx-muted mb-1.5">Provider</label>
        <div className="grid grid-cols-2 gap-1.5">
          {PROVIDER_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => updateType(t)}
              className={`px-2.5 py-1.5 rounded text-xs text-left transition-colors ${
                form.type === t
                  ? 'bg-accent-main/15 text-accent-main'
                  : 'text-tx-muted hover:bg-bg-active hover:text-tx-main'
              }`}
            >
              {PROVIDER_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {/* Name */}
      <div>
        <label className="block text-xs text-tx-muted mb-1.5">Name</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          placeholder="e.g. My GPT-4o"
          className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus:border-accent-main/50 placeholder-tx-faint"
        />
      </div>

      {/* API Key */}
      <div>
        <label className="block text-xs text-tx-muted mb-1.5">API Key</label>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={form.apiKey}
            onChange={(e) => { setForm((p) => ({ ...p, apiKey: e.target.value })); setTestResult(null) }}
            placeholder="sk-..."
            className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 pr-9 border border-border-subtle outline-none focus:border-accent-main/50 placeholder-tx-faint font-mono"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-tx-faint hover:text-tx-muted"
          >
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>

      {/* Base URL */}
      {(form.type === 'openai-compatible' || form.type === 'google') && (
        <div>
          <label className="block text-xs text-tx-muted mb-1.5">Base URL</label>
          <input
            type="text"
            value={form.baseUrl}
            onChange={(e) => setForm((p) => ({ ...p, baseUrl: e.target.value }))}
            placeholder="https://api.example.com/v1"
            className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus:border-accent-main/50 placeholder-tx-faint font-mono"
          />
        </div>
      )}

      {/* Model */}
      <div>
        <label className="block text-xs text-tx-muted mb-1.5">Model</label>
        <input
          type="text"
          value={form.model}
          onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))}
          placeholder="model name"
          className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus:border-accent-main/50 placeholder-tx-faint font-mono"
        />
        {suggestedModels.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {suggestedModels.map((m) => (
              <button
                key={m}
                onClick={() => setForm((p) => ({ ...p, model: m }))}
                className={`px-2 py-0.5 rounded text-xs transition-colors ${
                  form.model === m
                    ? 'bg-accent-main/15 text-accent-main'
                    : 'bg-bg-active text-tx-muted hover:text-tx-main'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Test Result */}
      {testResult && (
        <div className={`text-xs px-3 py-2 rounded-md ${
          testResult.ok
            ? 'bg-green-500/10 text-green-400'
            : 'bg-red-500/10 text-red-400'
        }`}>
          {testResult.msg}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleTest}
          disabled={!form.apiKey.trim() || !form.model.trim() || testing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-tx-muted hover:text-tx-main hover:bg-bg-active transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {testing ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
          Test
        </button>
        <div className="flex-1" />
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-md text-xs text-tx-muted hover:text-tx-main hover:bg-bg-active transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => canSave && onSave(form)}
          disabled={!canSave}
          className="px-4 py-1.5 rounded-md text-xs bg-accent-main/15 text-accent-main hover:bg-accent-main/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {initial ? 'Update' : 'Add'}
        </button>
      </div>
    </div>
  )
}

// ── AI Settings Section ──

const FEATURE_LABELS: Record<AIFeature, { name: string; desc: string }> = {
  completion: { name: 'Tab Completion', desc: 'Ghost text while typing — use a fast model' },
  chat: { name: 'AI Chat', desc: 'Chat panel and inline actions — use a capable model' },
}

const FEATURES: AIFeature[] = ['completion', 'chat']

const AISettingsSection: React.FC = () => {
  const ai = useUIStore((s) => s.ai)
  const addAIProvider = useUIStore((s) => s.addAIProvider)
  const updateAIProvider = useUIStore((s) => s.updateAIProvider)
  const removeAIProvider = useUIStore((s) => s.removeAIProvider)
  const setActiveAIProvider = useUIStore((s) => s.setActiveAIProvider)
  const setAIFeatureProvider = useUIStore((s) => s.setAIFeatureProvider)

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const handleAdd = useCallback((data: ProviderFormData) => {
    const id = crypto.randomUUID()
    addAIProvider({
      id,
      name: data.name,
      type: data.type,
      apiKey: data.apiKey,
      baseUrl: data.baseUrl,
      model: data.model,
      enabled: true,
    })
    setShowForm(false)
  }, [addAIProvider])

  const handleUpdate = useCallback((data: ProviderFormData) => {
    if (!editingId) return
    updateAIProvider(editingId, {
      name: data.name,
      type: data.type,
      apiKey: data.apiKey,
      baseUrl: data.baseUrl,
      model: data.model,
    })
    setEditingId(null)
  }, [editingId, updateAIProvider])

  const editingProvider = editingId ? ai.providers.find((p) => p.id === editingId) : undefined

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-tx-muted text-xs font-medium uppercase tracking-wider">AI Providers</h2>
        {!showForm && !editingId && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1 text-xs text-tx-muted hover:text-accent-main transition-colors"
          >
            <Plus size={13} />
            Add
          </button>
        )}
      </div>

      {/* Provider list */}
      {ai.providers.length > 0 && !showForm && !editingId && (
        <div className="space-y-1.5 mb-4">
          {ai.providers.map((p) => {
            const isActive = p.id === ai.activeProviderId
            return (
              <div
                key={p.id}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md border transition-colors ${
                  isActive ? 'border-accent-main/30 bg-accent-main/5' : 'border-border-subtle hover:border-border-strong'
                }`}
              >
                {/* Active indicator */}
                <button
                  onClick={() => setActiveAIProvider(p.id)}
                  className={`shrink-0 ${isActive ? 'text-accent-main' : 'text-tx-faint hover:text-tx-muted'}`}
                  title={isActive ? 'Active provider' : 'Set as active'}
                >
                  <Radio size={14} />
                </button>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-tx-main font-medium truncate">{p.name}</span>
                    <span className="text-[10px] text-tx-faint px-1.5 py-0.5 bg-bg-active rounded">
                      {PROVIDER_TYPE_LABELS[p.type]}
                    </span>
                  </div>
                  <div className="text-xs text-tx-faint font-mono mt-0.5 truncate">{p.model}</div>
                </div>

                {/* Actions */}
                <button
                  onClick={() => setEditingId(p.id)}
                  className="shrink-0 text-tx-faint hover:text-tx-muted transition-colors"
                  title="Edit"
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={() => removeAIProvider(p.id)}
                  className="shrink-0 text-tx-faint hover:text-red-400 transition-colors"
                  title="Delete"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Empty state */}
      {ai.providers.length === 0 && !showForm && (
        <div
          onClick={() => setShowForm(true)}
          className="text-center py-8 text-tx-faint text-sm cursor-pointer hover:text-tx-muted border border-dashed border-border-subtle rounded-lg transition-colors"
        >
          No AI provider configured. Click to add one.
        </div>
      )}

      {/* Add form */}
      {showForm && (
        <AIProviderForm onSave={handleAdd} onCancel={() => setShowForm(false)} />
      )}

      {/* Edit form */}
      {editingId && editingProvider && (
        <AIProviderForm
          initial={editingProvider}
          onSave={handleUpdate}
          onCancel={() => setEditingId(null)}
        />
      )}

      {/* Feature Routing */}
      {ai.providers.length > 0 && !showForm && !editingId && (
        <div className="mt-6">
          <h3 className="text-tx-muted text-xs font-medium uppercase tracking-wider mb-3">Feature Routing</h3>
          <div className="space-y-2">
            {FEATURES.map((feature) => {
              const routed = ai.featureRouting[feature]
              return (
                <div key={feature} className="flex items-center gap-3 px-3 py-2 rounded-md border border-border-subtle">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-tx-main">{FEATURE_LABELS[feature].name}</div>
                    <div className="text-[11px] text-tx-faint">{FEATURE_LABELS[feature].desc}</div>
                  </div>
                  <select
                    value={routed ?? ''}
                    onChange={(e) => setAIFeatureProvider(feature, e.target.value || null)}
                    className="bg-bg-app text-tx-main text-xs rounded-md px-2 py-1.5 border border-border-subtle outline-none focus:border-accent-main/50 min-w-[140px]"
                  >
                    <option value="">Default ({ai.providers.find((p) => p.id === ai.activeProviderId)?.name || 'none'})</option>
                    {ai.providers.filter((p) => p.enabled).map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.model})</option>
                    ))}
                  </select>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}

// ── AI Usage Stats ──

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatTime(ts: number | null): string {
  if (!ts) return 'Never'
  const d = new Date(ts)
  const now = Date.now()
  const diff = now - ts
  if (diff < 60_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return d.toLocaleDateString()
}

const StatCard: React.FC<{ label: string; value: string; sub?: string }> = ({ label, value, sub }) => (
  <div className="bg-bg-hover rounded-lg p-3 border border-border-subtle">
    <div className="text-[11px] text-tx-faint uppercase tracking-wider mb-1">{label}</div>
    <div className="text-lg text-tx-main font-semibold">{value}</div>
    {sub && <div className="text-[11px] text-tx-faint mt-0.5">{sub}</div>}
  </div>
)

const AIUsageSection: React.FC = () => {
  const ai = useUIStore((s) => s.ai)
  const resetAIUsage = useUIStore((s) => s.resetAIUsage)
  const [showConfirm, setShowConfirm] = useState(false)

  const stats = ai.usage ?? { total: { requests: 0, promptTokens: 0, completionTokens: 0, errors: 0 }, byProvider: {}, byFeature: {}, daily: {}, lastRequestAt: null }
  const totalTokens = stats.total.promptTokens + stats.total.completionTokens

  // Recent 7 days
  const recentDays = useMemo(() => {
    const days: Array<{ date: string; tokens: number; requests: number }> = []
    const today = new Date()
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      const rec = stats.daily[key]
      days.push({
        date: d.toLocaleDateString(undefined, { weekday: 'short' }),
        tokens: rec ? rec.promptTokens + rec.completionTokens : 0,
        requests: rec?.requests ?? 0,
      })
    }
    return days
  }, [stats.daily])

  const maxDayTokens = Math.max(...recentDays.map((d) => d.tokens), 1)

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-tx-muted text-xs font-medium uppercase tracking-wider flex items-center gap-1.5">
          <BarChart3 size={13} />
          AI Usage
        </h2>
        {stats.total.requests > 0 && (
          showConfirm ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-tx-faint">Reset all stats?</span>
              <button
                onClick={() => { resetAIUsage(); setShowConfirm(false) }}
                className="text-[11px] text-red-400 hover:text-red-300"
              >
                Confirm
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                className="text-[11px] text-tx-muted hover:text-tx-main"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowConfirm(true)}
              className="flex items-center gap-1 text-xs text-tx-faint hover:text-tx-muted transition-colors"
            >
              <RotateCcw size={11} />
              Reset
            </button>
          )
        )}
      </div>

      {stats.total.requests === 0 ? (
        <div className="text-center py-6 text-tx-faint text-sm border border-dashed border-border-subtle rounded-lg">
          No AI usage recorded yet.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Overview cards */}
          <div className="grid grid-cols-4 gap-2">
            <StatCard label="Requests" value={formatTokens(stats.total.requests)} />
            <StatCard label="Tokens" value={formatTokens(totalTokens)} sub={`${formatTokens(stats.total.promptTokens)} in / ${formatTokens(stats.total.completionTokens)} out`} />
            <StatCard label="Errors" value={String(stats.total.errors)} />
            <StatCard label="Last Used" value={formatTime(stats.lastRequestAt)} />
          </div>

          {/* 7-day chart */}
          <div className="bg-bg-hover rounded-lg p-3 border border-border-subtle">
            <div className="text-[11px] text-tx-faint uppercase tracking-wider mb-3">Last 7 Days</div>
            <div className="flex items-end gap-1.5 h-[48px]">
              {recentDays.map((day, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end justify-center" style={{ height: 36 }}>
                    <div
                      className="w-full max-w-[24px] rounded-sm bg-accent-main/30 hover:bg-accent-main/50 transition-colors"
                      style={{ height: Math.max(2, (day.tokens / maxDayTokens) * 36) }}
                      title={`${day.requests} requests, ${formatTokens(day.tokens)} tokens`}
                    />
                  </div>
                  <span className="text-[9px] text-tx-faint">{day.date}</span>
                </div>
              ))}
            </div>
          </div>

          {/* By Provider */}
          {Object.keys(stats.byProvider).length > 0 && (
            <div className="bg-bg-hover rounded-lg p-3 border border-border-subtle">
              <div className="text-[11px] text-tx-faint uppercase tracking-wider mb-2">By Provider</div>
              <div className="space-y-1.5">
                {Object.entries(stats.byProvider).map(([pid, rec]) => {
                  const provider = ai.providers.find((p) => p.id === pid)
                  return (
                    <div key={pid} className="flex items-center justify-between text-xs">
                      <span className="text-tx-main truncate">{provider?.name ?? pid.slice(0, 8)}</span>
                      <span className="text-tx-faint font-mono">
                        {rec.requests} req · {formatTokens(rec.promptTokens + rec.completionTokens)} tok
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* By Feature */}
          {Object.keys(stats.byFeature).length > 0 && (
            <div className="bg-bg-hover rounded-lg p-3 border border-border-subtle">
              <div className="text-[11px] text-tx-faint uppercase tracking-wider mb-2">By Feature</div>
              <div className="space-y-1.5">
                {Object.entries(stats.byFeature).map(([feat, rec]) => (
                  <div key={feat} className="flex items-center justify-between text-xs">
                    <span className="text-tx-main capitalize">{feat}</span>
                    <span className="text-tx-faint font-mono">
                      {rec.requests} req · {formatTokens(rec.promptTokens + rec.completionTokens)} tok
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// ── MCP Servers Section ──

const MCPServerForm: React.FC<{
  initial?: MCPServerConfig
  onSave: (data: Omit<MCPServerConfig, 'id'>) => void
  onCancel: () => void
}> = ({ initial, onSave, onCancel }) => {
  const [mode, setMode] = useState<'stdio' | 'url'>(initial?.url ? 'url' : 'stdio')
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    command: initial?.command ?? '',
    args: initial?.args?.join(' ') ?? '',
    env: Object.entries(initial?.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'),
    url: initial?.url ?? '',
    headers: Object.entries(initial?.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n'),
    timeout: initial?.timeout ?? 30000,
    enabled: initial?.enabled ?? true,
  })

  const canSave = form.name.trim() && (mode === 'stdio' ? form.command.trim() : form.url.trim())

  const handleSave = () => {
    if (!canSave) return
    const envObj: Record<string, string> = {}
    form.env.split('\n').filter(Boolean).forEach((line) => {
      const eq = line.indexOf('=')
      if (eq > 0) envObj[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
    })
    const headersObj: Record<string, string> = {}
    form.headers.split('\n').filter(Boolean).forEach((line) => {
      const sep = line.indexOf(':')
      if (sep > 0) headersObj[line.slice(0, sep).trim()] = line.slice(sep + 1).trim()
    })
    onSave({
      name: form.name.trim(),
      description: form.description.trim(),
      command: mode === 'stdio' ? form.command.trim() : '',
      args: mode === 'stdio' && form.args.trim() ? form.args.trim().split(/\s+/) : [],
      env: mode === 'stdio' ? envObj : {},
      url: mode === 'url' ? form.url.trim() : '',
      headers: mode === 'url' ? headersObj : {},
      timeout: form.timeout,
      enabled: form.enabled,
    })
  }

  return (
    <div className="space-y-3 bg-bg-hover rounded-lg p-4 border border-border-subtle">
      <div>
        <label className="block text-xs text-tx-muted mb-1.5">Name</label>
        <input
          type="text" value={form.name}
          onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          placeholder="e.g. GitHub MCP"
          className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus:border-accent-main/50 placeholder-tx-faint"
        />
      </div>
      <div>
        <label className="block text-xs text-tx-muted mb-1.5">Description <span className="text-tx-faint">(tells AI what this server does)</span></label>
        <input
          type="text" value={form.description}
          onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
          placeholder="e.g. X/Twitter API - search tweets, get user info"
          className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus:border-accent-main/50 placeholder-tx-faint"
        />
      </div>
      {/* Transport mode toggle */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-tx-muted">Transport:</label>
        <button onClick={() => setMode('stdio')} className={`px-2 py-1 rounded text-[11px] font-mono transition-colors ${mode === 'stdio' ? 'bg-accent-main/15 text-accent-main' : 'text-tx-faint hover:text-tx-muted'}`}>stdio</button>
        <button onClick={() => setMode('url')} className={`px-2 py-1 rounded text-[11px] font-mono transition-colors ${mode === 'url' ? 'bg-accent-main/15 text-accent-main' : 'text-tx-faint hover:text-tx-muted'}`}>url</button>
      </div>
      {mode === 'stdio' ? (
        <>
          <div>
            <label className="block text-xs text-tx-muted mb-1.5">Command</label>
            <input
              type="text" value={form.command}
              onChange={(e) => setForm((p) => ({ ...p, command: e.target.value }))}
              placeholder="e.g. npx, node, python"
              className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus:border-accent-main/50 placeholder-tx-faint font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-tx-muted mb-1.5">Arguments (space-separated)</label>
            <input
              type="text" value={form.args}
              onChange={(e) => setForm((p) => ({ ...p, args: e.target.value }))}
              placeholder="e.g. -y @modelcontextprotocol/server-everything"
              className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus:border-accent-main/50 placeholder-tx-faint font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-tx-muted mb-1.5">Environment Variables (KEY=VALUE, one per line)</label>
            <textarea
              value={form.env}
              onChange={(e) => setForm((p) => ({ ...p, env: e.target.value }))}
              placeholder="GITHUB_TOKEN=ghp_..."
              rows={2}
              className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus:border-accent-main/50 placeholder-tx-faint font-mono resize-none"
            />
          </div>
        </>
      ) : (
        <>
          <div>
            <label className="block text-xs text-tx-muted mb-1.5">URL</label>
            <input
              type="text" value={form.url}
              onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))}
              placeholder="https://mcp.example.com/sse"
              className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus:border-accent-main/50 placeholder-tx-faint font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-tx-muted mb-1.5">Headers (Key: Value, one per line)</label>
            <textarea
              value={form.headers}
              onChange={(e) => setForm((p) => ({ ...p, headers: e.target.value }))}
              placeholder="Authorization: Bearer sk-..."
              rows={2}
              className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus:border-accent-main/50 placeholder-tx-faint font-mono resize-none"
            />
          </div>
        </>
      )}
      <div>
        <label className="block text-xs text-tx-muted mb-1.5">Timeout (ms)</label>
        <input
          type="number" value={form.timeout}
          onChange={(e) => setForm((p) => ({ ...p, timeout: Number(e.target.value) || 30000 }))}
          className="w-32 bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus:border-accent-main/50 font-mono"
        />
      </div>
      <div className="flex items-center gap-2 pt-1">
        <div className="flex-1" />
        <button onClick={onCancel} className="px-3 py-1.5 rounded-md text-xs text-tx-muted hover:text-tx-main hover:bg-bg-active transition-colors">Cancel</button>
        <button onClick={handleSave} disabled={!canSave} className="px-4 py-1.5 rounded-md text-xs bg-accent-main/15 text-accent-main hover:bg-accent-main/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          {initial ? 'Update' : 'Add'}
        </button>
      </div>
    </div>
  )
}

/** Convert MCPServerConfig[] to Claude Desktop JSON format */
function serversToJson(servers: MCPServerConfig[]): string {
  const obj: Record<string, Record<string, unknown>> = {}
  for (const s of servers) {
    const entry: Record<string, unknown> = {}
    if (s.description) entry.description = s.description
    if (s.url) {
      entry.url = s.url
      if (Object.keys(s.headers || {}).length > 0) entry.headers = s.headers
    } else {
      entry.command = s.command
      entry.args = s.args
      if (Object.keys(s.env || {}).length > 0) entry.env = s.env
    }
    obj[s.name] = entry
  }
  return JSON.stringify({ mcpServers: obj }, null, 2)
}

/** Parse a single server config entry */
function parseServerEntry(name: string, c: Record<string, unknown>): MCPServerConfig {
  return {
    id: String(c.id || crypto.randomUUID().slice(0, 8)),
    name,
    description: String(c.description || ''),
    command: String(c.command || ''),
    args: Array.isArray(c.args) ? c.args.map(String) : [],
    env: (c.env && typeof c.env === 'object') ? c.env as Record<string, string> : {},
    url: String(c.url || ''),
    headers: (c.headers && typeof c.headers === 'object') ? c.headers as Record<string, string> : {},
    enabled: c.enabled !== false,
    timeout: Number(c.timeout) || 30000,
  }
}

/** Parse Claude Desktop / array / single-server JSON into MCPServerConfig[] */
function parseServersJson(text: string): { ok: true; data: MCPServerConfig[] } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(text)
    const result: MCPServerConfig[] = []

    if (parsed.mcpServers && typeof parsed.mcpServers === 'object' && !Array.isArray(parsed.mcpServers)) {
      // Claude Desktop format: { "mcpServers": { "name": { command, args, env } | { url, headers } } }
      for (const [name, cfg] of Object.entries(parsed.mcpServers)) {
        result.push(parseServerEntry(name, cfg as Record<string, unknown>))
      }
    } else if (Array.isArray(parsed)) {
      for (const c of parsed) {
        result.push(parseServerEntry(String(c.name || 'unnamed'), c))
      }
    } else {
      return { ok: false, error: 'Use Claude Desktop format {"mcpServers":{...}} or an array.' }
    }

    // A server must have either command or url
    const valid = result.filter((s) => s.command || s.url)
    if (valid.length === 0) return { ok: false, error: 'No valid servers found (need "command" or "url").' }
    return { ok: true, data: valid }
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` }
  }
}

const MCPServersSection: React.FC = () => {
  const mcpServers = useUIStore((s) => s.mcpServers)
  const updateMCPServers = useUIStore((s) => s.updateMCPServers)
  const [showForm, setShowForm] = useState(false)
  const [jsonMode, setJsonMode] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [tools, setTools] = useState<AIToolDefinition[]>([])
  const [expandedServer, setExpandedServer] = useState<string | null>(null)
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [jsonDirty, setJsonDirty] = useState(false)

  useEffect(() => {
    if (!window.api.mcp) return
    window.api.mcp.listTools().then((res) => {
      if (res.ok) setTools(res.data)
    })
  }, [])

  const handleAdd = useCallback((data: Omit<MCPServerConfig, 'id'>) => {
    const id = crypto.randomUUID().slice(0, 8)
    updateMCPServers([...mcpServers, { id, ...data }])
    setShowForm(false)
  }, [mcpServers, updateMCPServers])

  const handleUpdate = useCallback((data: Omit<MCPServerConfig, 'id'>) => {
    if (!editingId) return
    updateMCPServers(mcpServers.map((s) => s.id === editingId ? { ...s, ...data } : s))
    setEditingId(null)
  }, [editingId, mcpServers, updateMCPServers])

  const handleRemove = useCallback((id: string) => {
    updateMCPServers(mcpServers.filter((s) => s.id !== id))
  }, [mcpServers, updateMCPServers])

  const handleToggle = useCallback((id: string) => {
    updateMCPServers(mcpServers.map((s) => s.id === id ? { ...s, enabled: !s.enabled } : s))
  }, [mcpServers, updateMCPServers])

  const handleRefresh = useCallback(async () => {
    if (!window.api.mcp) return
    setRefreshing(true)
    try {
      const res = await window.api.mcp.refresh()
      if (res.ok) {
        const toolsRes = await window.api.mcp.listTools()
        if (toolsRes.ok) setTools(toolsRes.data)
      }
    } catch { /* ignore */ }
    setRefreshing(false)
  }, [])

  // Switch to JSON mode: serialize current config
  const enterJsonMode = useCallback(() => {
    setJsonText(serversToJson(mcpServers))
    setJsonError(null)
    setJsonDirty(false)
    setJsonMode(true)
  }, [mcpServers])

  // Apply JSON changes
  const applyJson = useCallback(() => {
    const result = parseServersJson(jsonText)
    if (!result.ok) { setJsonError(result.error); return }
    updateMCPServers(result.data)
    setJsonMode(false)
    setJsonDirty(false)
    setJsonError(null)
  }, [jsonText, updateMCPServers])

  const editingServer = editingId ? mcpServers.find((s) => s.id === editingId) : undefined
  const mcpToolsForServer = (serverId: string) => tools.filter((t) => t.name.startsWith(`mcp_${serverId}_`))
  const isIdle = !showForm && !editingId && !jsonMode

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-tx-muted text-xs font-medium uppercase tracking-wider flex items-center gap-1.5">
          <Server size={13} />
          MCP Servers
        </h2>
        <div className="flex items-center gap-2">
          {mcpServers.length > 0 && isIdle && (
            <button onClick={handleRefresh} disabled={refreshing} className="flex items-center gap-1 text-xs text-tx-faint hover:text-tx-muted transition-colors disabled:opacity-40">
              <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
              Refresh
            </button>
          )}
          {/* JSON / Form toggle */}
          {!showForm && !editingId && (
            <button
              onClick={() => jsonMode ? setJsonMode(false) : enterJsonMode()}
              className={`px-2 py-1 rounded text-[11px] font-mono transition-colors ${jsonMode ? 'bg-accent-main/15 text-accent-main' : 'text-tx-faint hover:text-tx-muted hover:bg-bg-active'}`}
            >
              JSON
            </button>
          )}
          {isIdle && (
            <button onClick={() => setShowForm(true)} className="flex items-center gap-1 text-xs text-tx-muted hover:text-accent-main transition-colors">
              <Plus size={13} /> Add
            </button>
          )}
        </div>
      </div>

      {/* JSON Editor Mode */}
      {jsonMode && (
        <div className="space-y-3 mb-4">
          <textarea
            value={jsonText}
            onChange={(e) => { setJsonText(e.target.value); setJsonError(null); setJsonDirty(true) }}
            rows={Math.min(20, Math.max(8, jsonText.split('\n').length + 2))}
            spellCheck={false}
            className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus:border-accent-main/50 font-mono resize-y leading-relaxed"
          />
          {jsonError && <div className="text-xs text-red-400 px-1">{jsonError}</div>}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-tx-faint">Claude Desktop / Cursor format supported</span>
            <div className="flex-1" />
            <button onClick={() => { setJsonMode(false); setJsonError(null) }} className="px-3 py-1.5 rounded-md text-xs text-tx-muted hover:text-tx-main hover:bg-bg-active transition-colors">Cancel</button>
            {jsonDirty && (
              <button onClick={applyJson} className="px-4 py-1.5 rounded-md text-xs bg-accent-main/15 text-accent-main hover:bg-accent-main/25 transition-colors">
                Apply
              </button>
            )}
          </div>
        </div>
      )}

      {/* Server List (form mode) */}
      {mcpServers.length > 0 && isIdle && (
        <div className="space-y-1.5 mb-4">
          {mcpServers.map((s) => {
            const serverTools = mcpToolsForServer(s.id)
            const isExpanded = expandedServer === s.id
            return (
              <div key={s.id} className="border border-border-subtle rounded-md overflow-hidden">
                <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-bg-hover/50 transition-colors">
                  <button onClick={() => handleToggle(s.id)} className={`shrink-0 ${s.enabled ? 'text-green-400' : 'text-tx-faint'}`} title={s.enabled ? 'Enabled' : 'Disabled'}>
                    {s.enabled ? <Power size={14} /> : <PowerOff size={14} />}
                  </button>
                  <button onClick={() => setExpandedServer(isExpanded ? null : s.id)} className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-tx-main font-medium truncate">{s.name}</span>
                      <span className="text-[10px] text-tx-faint px-1.5 py-0.5 bg-bg-active rounded font-mono">{s.url ? 'url' : s.command}</span>
                      {serverTools.length > 0 && (
                        <span className="text-[10px] text-accent-main/70">{serverTools.length} tools</span>
                      )}
                    </div>
                    <div className="text-xs text-tx-faint mt-0.5 truncate">{s.description || <span className="font-mono">{s.url || s.args.join(' ')}</span>}</div>
                  </button>
                  <button onClick={() => setExpandedServer(isExpanded ? null : s.id)} className="shrink-0 text-tx-faint hover:text-tx-muted">
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  <button onClick={() => setEditingId(s.id)} className="shrink-0 text-tx-faint hover:text-tx-muted transition-colors" title="Edit">
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => handleRemove(s.id)} className="shrink-0 text-tx-faint hover:text-red-400 transition-colors" title="Delete">
                    <Trash2 size={13} />
                  </button>
                </div>
                {isExpanded && serverTools.length > 0 && (
                  <div className="border-t border-border-subtle bg-bg-hover/30 px-3 py-2">
                    <div className="text-[11px] text-tx-faint uppercase tracking-wider mb-1.5">Available Tools</div>
                    <div className="space-y-1">
                      {serverTools.map((t) => (
                        <div key={t.name} className="flex items-start gap-2 text-xs">
                          <Wrench size={11} className="text-tx-faint mt-0.5 shrink-0" />
                          <div>
                            <span className="text-tx-main font-mono">{t.name.replace(`mcp_${s.id}_`, '')}</span>
                            {t.description && <span className="text-tx-faint ml-1.5">{t.description}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {mcpServers.length === 0 && isIdle && (
        <div onClick={enterJsonMode} className="text-center py-6 text-tx-faint text-sm cursor-pointer hover:text-tx-muted border border-dashed border-border-subtle rounded-lg transition-colors">
          No MCP servers configured. Click to edit JSON or use + Add.
        </div>
      )}

      {showForm && <MCPServerForm onSave={handleAdd} onCancel={() => setShowForm(false)} />}
      {editingId && editingServer && <MCPServerForm initial={editingServer} onSave={handleUpdate} onCancel={() => setEditingId(null)} />}
    </section>
  )
}

// ── Skills Section ──

type SkillsView = 'list' | 'new' | 'import'

const SkillsSection: React.FC = () => {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null)
  const [view, setView] = useState<SkillsView>('list')

  // New skill form
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newContent, setNewContent] = useState('')

  // Import
  const [importInput, setImportInput] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const reloadSkills = useCallback(() => {
    if (!window.api.skills) return
    window.api.skills.list().then((res) => {
      if (res.ok) setSkills(res.data)
    })
  }, [])

  useEffect(() => {
    if (!window.api.skills) { setLoading(false); return }
    window.api.skills.list().then((res) => {
      if (res.ok) setSkills(res.data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const handleToggle = useCallback(async (name: string, enabled: boolean) => {
    await window.api.skills.toggle(name, enabled)
    setSkills((prev) => prev.map((s) => s.name === name ? { ...s, enabled } : s))
  }, [])

  const handleDelete = useCallback(async (name: string) => {
    await window.api.skills.delete(name)
    setSkills((prev) => prev.filter((s) => s.name !== name))
  }, [])

  const handleCreate = useCallback(async () => {
    if (!newName.trim() || !newContent.trim()) return
    const res = await window.api.skills.create(newName.trim(), newDesc.trim(), newContent.trim())
    if (res.ok) {
      setView('list')
      setNewName(''); setNewDesc(''); setNewContent('')
      reloadSkills()
    }
  }, [newName, newDesc, newContent, reloadSkills])

  /** Resolve import input to a raw URL. Supports:
   *  - skills.sh URLs: skills.sh/{owner}/{repo}/{skill} → GitHub raw SKILL.md
   *  - GitHub repo URLs: github.com/{owner}/{repo} with optional path
   *  - Direct raw URLs: any http(s) URL returning markdown
   */
  const resolveImportUrl = (input: string): string => {
    const trimmed = input.trim()

    // skills.sh/{owner}/{repo}/{skill}
    const skillsShMatch = trimmed.match(/^(?:https?:\/\/)?skills\.sh\/([^/]+)\/([^/]+)\/([^/]+)\/?$/)
    if (skillsShMatch) {
      const [, owner, repo, skill] = skillsShMatch
      return `https://raw.githubusercontent.com/${owner}/${repo}/refs/heads/main/skills/${skill}/SKILL.md`
    }

    // GitHub blob/tree URL → raw
    const ghBlobMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/)
    if (ghBlobMatch) {
      const [, owner, repo, branch, path] = ghBlobMatch
      return `https://raw.githubusercontent.com/${owner}/${repo}/refs/heads/${branch}/${path}`
    }

    // Already a URL
    if (/^https?:\/\//.test(trimmed)) return trimmed

    // Bare owner/repo/skill pattern (assume skills.sh style)
    const bareMatch = trimmed.match(/^([^/]+)\/([^/]+)\/([^/]+)$/)
    if (bareMatch) {
      const [, owner, repo, skill] = bareMatch
      return `https://raw.githubusercontent.com/${owner}/${repo}/refs/heads/main/skills/${skill}/SKILL.md`
    }

    return trimmed
  }

  const handleImport = useCallback(async () => {
    if (!importInput.trim()) return
    setImporting(true)
    setImportError(null)
    try {
      const url = resolveImportUrl(importInput)
      const res = await window.api.skills.importUrl(url)
      if (res.ok) {
        setView('list')
        setImportInput('')
        reloadSkills()
      } else {
        setImportError(res.error)
      }
    } catch (e) {
      setImportError(String(e))
    }
    setImporting(false)
  }, [importInput, reloadSkills])

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-tx-muted text-xs font-medium uppercase tracking-wider flex items-center gap-1.5">
          <BookOpen size={13} />
          Skills
        </h2>
        {view === 'list' && (
          <div className="flex items-center gap-2">
            <button onClick={() => setView('import')} className="flex items-center gap-1 text-xs text-tx-muted hover:text-accent-main transition-colors">
              Import URL
            </button>
            <button onClick={() => setView('new')} className="flex items-center gap-1 text-xs text-tx-muted hover:text-accent-main transition-colors">
              <Plus size={13} /> New
            </button>
          </div>
        )}
      </div>

      {/* New Skill Form */}
      {view === 'new' && (
        <div className="space-y-3 bg-bg-hover rounded-lg p-4 border border-border-subtle mb-4">
          <div>
            <label className="block text-xs text-tx-muted mb-1.5">Name</label>
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. code-review" className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus:border-accent-main/50 placeholder-tx-faint" />
          </div>
          <div>
            <label className="block text-xs text-tx-muted mb-1.5">Description</label>
            <input type="text" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="One-line description" className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus:border-accent-main/50 placeholder-tx-faint" />
          </div>
          <div>
            <label className="block text-xs text-tx-muted mb-1.5">Skill Content (instructions for AI)</label>
            <textarea value={newContent} onChange={(e) => setNewContent(e.target.value)} placeholder="When doing X, focus on..." rows={8} className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus:border-accent-main/50 placeholder-tx-faint font-mono resize-none" />
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1" />
            <button onClick={() => { setView('list'); setNewName(''); setNewDesc(''); setNewContent('') }} className="px-3 py-1.5 rounded-md text-xs text-tx-muted hover:text-tx-main hover:bg-bg-active transition-colors">Cancel</button>
            <button onClick={handleCreate} disabled={!newName.trim() || !newContent.trim()} className="px-4 py-1.5 rounded-md text-xs bg-accent-main/15 text-accent-main hover:bg-accent-main/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">Create</button>
          </div>
        </div>
      )}

      {/* Import Form */}
      {view === 'import' && (
        <div className="space-y-3 bg-bg-hover rounded-lg p-4 border border-border-subtle mb-4">
          <div>
            <label className="block text-xs text-tx-muted mb-1.5">Import Skill</label>
            <input type="text" value={importInput} onChange={(e) => { setImportInput(e.target.value); setImportError(null) }} placeholder="skills.sh URL, GitHub URL, or owner/repo/skill" className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus:border-accent-main/50 placeholder-tx-faint font-mono" />
          </div>
          <div className="text-[11px] text-tx-faint leading-relaxed space-y-1">
            <div>Supported formats:</div>
            <div className="font-mono text-tx-faint/70 pl-2 space-y-0.5">
              <div>skills.sh/vercel-labs/skills/find-skills</div>
              <div>vercel-labs/skills/find-skills</div>
              <div>https://github.com/.../blob/main/SKILL.md</div>
              <div>https://any-url.com/skill.md</div>
            </div>
          </div>
          {importError && <div className="text-xs text-red-400 px-1">{importError}</div>}
          <div className="flex items-center gap-2">
            <div className="flex-1" />
            <button onClick={() => { setView('list'); setImportInput(''); setImportError(null) }} className="px-3 py-1.5 rounded-md text-xs text-tx-muted hover:text-tx-main hover:bg-bg-active transition-colors">Cancel</button>
            <button onClick={handleImport} disabled={!importInput.trim() || importing} className="px-4 py-1.5 rounded-md text-xs bg-accent-main/15 text-accent-main hover:bg-accent-main/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
              {importing && <Loader2 size={12} className="animate-spin" />}
              Import
            </button>
          </div>
        </div>
      )}

      {/* Skills List */}
      {view === 'list' && (loading ? (
        <div className="text-center py-6 text-tx-faint text-sm"><Loader2 size={14} className="animate-spin inline mr-1.5" />Loading skills...</div>
      ) : skills.length === 0 ? (
        <div className="text-center py-6 text-tx-faint text-sm border border-dashed border-border-subtle rounded-lg space-y-2">
          <div>No skills yet.</div>
          <div className="flex items-center justify-center gap-3">
            <button onClick={() => setView('new')} className="text-accent-main hover:underline">Create one</button>
            <span className="text-tx-faint">or</span>
            <button onClick={() => setView('import')} className="text-accent-main hover:underline">Import from URL</button>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {skills.map((skill) => {
            const isExpanded = expandedSkill === skill.name
            return (
              <div key={skill.name} className="border border-border-subtle rounded-md overflow-hidden">
                <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-bg-hover/50 transition-colors">
                  <button
                    onClick={() => handleToggle(skill.name, !skill.enabled)}
                    className={`shrink-0 ${skill.enabled ? 'text-green-400' : 'text-tx-faint'}`}
                    title={skill.enabled ? 'Enabled' : 'Disabled'}
                  >
                    {skill.enabled ? <Power size={14} /> : <PowerOff size={14} />}
                  </button>
                  <button onClick={() => setExpandedSkill(isExpanded ? null : skill.name)} className="flex-1 min-w-0 text-left">
                    <div className="text-sm text-tx-main font-medium">{skill.name}</div>
                    {skill.description && <div className="text-xs text-tx-faint mt-0.5">{skill.description}</div>}
                  </button>
                  <button onClick={() => setExpandedSkill(isExpanded ? null : skill.name)} className="shrink-0 text-tx-faint hover:text-tx-muted">
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  <button onClick={() => handleDelete(skill.name)} className="shrink-0 text-tx-faint hover:text-red-400 transition-colors" title="Delete">
                    <Trash2 size={13} />
                  </button>
                </div>
                {isExpanded && (
                  <div className="border-t border-border-subtle bg-bg-hover/30 px-3 py-2">
                    <pre className="text-xs text-tx-muted whitespace-pre-wrap font-mono leading-relaxed max-h-[200px] overflow-y-auto">{skill.content}</pre>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </section>
  )
}

// ── Main Settings Component ──

const SettingsApp: React.FC = () => {
  const currentThemeId = useUIStore((s) => s.theme)
  const fontFamily = useUIStore((s) => s.fontFamily)
  const setTheme = useUIStore((s) => s.setTheme)
  const setFontFamily = useUIStore((s) => s.setFontFamily)
  const showCommandPalette = useUIStore((s) => s.showCommandPalette)

  const blurClass = showCommandPalette
    ? 'filter blur-[3px] opacity-50 transition-all duration-300'
    : 'transition-all duration-300'

  const themeGroups = useMemo(() => getThemeGroups(), [])

  // Determine current group and dark/light state
  const currentTheme = builtinThemes[currentThemeId]
  const currentGroup = currentTheme?.group ?? 'Lite'
  const isDark = currentTheme?.isDark ?? true

  // Switch group: keep current dark/light preference, find matching theme in new group
  const handleGroupSelect = (group: string) => {
    const groupThemes = themeGroups.find((g) => g.group === group)?.themes
    if (!groupThemes) return
    const match = groupThemes.find((t) => t.isDark === isDark) || groupThemes[0]
    setTheme(match.id)
  }

  // Toggle dark/light within the same group
  const handleModeToggle = (dark: boolean) => {
    const groupThemes = themeGroups.find((g) => g.group === currentGroup)?.themes
    if (!groupThemes) return
    const match = groupThemes.find((t) => t.isDark === dark)
    if (match) setTheme(match.id)
  }

  return (
    <div className={`flex-1 overflow-y-auto ${blurClass}`}>
      <div className="max-w-[560px] mx-auto py-12 px-6">
        <h1 className="text-tx-main text-lg font-semibold mb-8">Settings</h1>

        {/* ── AI Providers ── */}
        <AISettingsSection />

        {/* ── AI Usage Stats ── */}
        <AIUsageSection />

        {/* ── MCP Servers ── */}
        <MCPServersSection />

        {/* ── Skills ── */}
        <SkillsSection />

        {/* ── Theme ── */}
        <section className="mb-10">
          <h2 className="text-tx-muted text-xs font-medium uppercase tracking-wider mb-4">Theme</h2>

          {/* Group selector */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            {themeGroups.map(({ group, themes }) => {
              const isActive = currentGroup === group
              const previewTheme = themes.find((t) => t.isDark) || themes[0]
              return (
                <button
                  key={group}
                  onClick={() => handleGroupSelect(group)}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    isActive ? 'border-accent-main' : 'border-border-subtle hover:border-border-strong'
                  }`}
                >
                  <ThemePreview t={previewTheme} />
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-tx-main text-sm font-medium">{group}</span>
                    {isActive && <Check size={14} className="text-accent-main" />}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Dark / Light toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => handleModeToggle(true)}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                isDark
                  ? 'bg-accent-main/10 text-accent-main'
                  : 'text-tx-muted hover:bg-bg-hover'
              }`}
            >
              <Moon size={14} />
              Dark
            </button>
            <button
              onClick={() => handleModeToggle(false)}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                !isDark
                  ? 'bg-accent-main/10 text-accent-main'
                  : 'text-tx-muted hover:bg-bg-hover'
              }`}
            >
              <Sun size={14} />
              Light
            </button>
          </div>
        </section>

        {/* ── Font ── */}
        <section className="mb-10">
          <h2 className="text-tx-muted text-xs font-medium uppercase tracking-wider mb-4">Font</h2>
          <div className="space-y-1">
            {fontList.map((f) => (
              <button
                key={f.id}
                onClick={() => setFontFamily(f.id as FontId)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-left transition-colors ${
                  fontFamily === f.id
                    ? 'bg-accent-main/10 text-accent-main'
                    : 'text-tx-main hover:bg-bg-hover'
                }`}
              >
                <div>
                  <div className="text-sm" style={{ fontFamily: f.family }}>
                    {f.name}
                  </div>
                  <div
                    className="text-xs text-tx-faint mt-0.5"
                    style={{ fontFamily: f.family }}
                  >
                    The quick brown fox jumps over the lazy dog 0123456789
                  </div>
                </div>
                {fontFamily === f.id && (
                  <Check size={14} className="text-accent-main shrink-0 ml-3" />
                )}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

export { SettingsApp }
export default SettingsApp
