import React, { useMemo, useState, useCallback } from 'react'
import { useUIStore } from '../../store/useUIStore'
import { builtinThemes, getThemeGroups, fontList } from '../../themes'
import type { FontId, ThemeDefinition } from '../../themes'
import type { AIProviderConfig, AIProviderType, AIFeature } from '../../../../shared/types'
import { AI_PROVIDER_BASE_URLS, AI_PROVIDER_MODELS } from '../../../../shared/types'
import {
  Check, Sun, Moon, Plus, Trash2, Pencil, Zap, Eye, EyeOff,
  Radio, Loader2
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
              const routedProvider = routed ? ai.providers.find((p) => p.id === routed) : null
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
