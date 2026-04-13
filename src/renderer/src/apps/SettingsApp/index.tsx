import React, { useMemo, useState, useCallback, useEffect } from 'react'
import { useUIStore } from '../../store/useUIStore'
import { builtinThemes, getThemeGroups, fontList } from '../../themes'
import type { FontId, ThemeDefinition } from '../../themes'
import type { AIProviderConfig, AIProviderType, AIFeature, MCPServerConfig, Skill, AIToolDefinition } from '../../../../shared/types'
import { AI_PROVIDER_BASE_URLS, AI_PROVIDER_MODELS } from '../../../../shared/types'
import {
  Check, Sun, Moon, Plus, Trash2, Pencil, Zap, Eye, EyeOff,
  Radio, Loader2, BarChart3, RotateCcw, Server, BookOpen,
  Power, PowerOff, RefreshCw, ChevronDown, ChevronRight, Wrench,
  FolderOpen, Keyboard, Info, Copy, X,
} from 'lucide-react'
import { ScheduledTasksSection } from '../../components/ScheduledTasksSection'
import { getAppRegistry } from '../../core/AppContext'

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
  models: string[]
}

const AIProviderForm: React.FC<{
  initial?: AIProviderConfig
  onSave: (data: ProviderFormData) => void
  onCancel: () => void
}> = ({ initial, onSave, onCancel }) => {
  const [form, setForm] = useState<ProviderFormData>(() => {
    // Migrate legacy `model` field → `models` array on first read
    const initialModels = initial?.models?.length
      ? initial.models
      : initial?.model
      ? [initial.model]
      : []
    return {
      name: initial?.name ?? '',
      type: initial?.type ?? 'openai',
      apiKey: initial?.apiKey ?? '',
      baseUrl: initial?.baseUrl ?? AI_PROVIDER_BASE_URLS['openai'],
      models: initialModels,
    }
  })
  const [modelInput, setModelInput] = useState('')
  const [modelStatus, setModelStatus] = useState<Record<string, { ok: boolean; msg: string; loading?: boolean }>>({})
  const [showKey, setShowKey] = useState(false)

  const updateType = useCallback((type: AIProviderType) => {
    setForm((prev) => {
      // If user has no models yet, seed with the first suggested model for the new type
      const seedModel = AI_PROVIDER_MODELS[type]?.[0]
      const nextModels = prev.models.length > 0
        ? prev.models
        : seedModel
        ? [seedModel]
        : []
      return {
        ...prev,
        type,
        baseUrl: AI_PROVIDER_BASE_URLS[type] || prev.baseUrl,
        models: nextModels,
      }
    })
    setModelStatus({})
  }, [])

  const suggestedModels = AI_PROVIDER_MODELS[form.type] || []

  const addModel = useCallback((name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setForm((p) => (p.models.includes(trimmed) ? p : { ...p, models: [...p.models, trimmed] }))
    setModelInput('')
  }, [])

  const removeModel = useCallback((name: string) => {
    setForm((p) => ({ ...p, models: p.models.filter((m) => m !== name) }))
  }, [])

  const moveModelUp = useCallback((idx: number) => {
    setForm((p) => {
      if (idx <= 0) return p
      const next = [...p.models]
      ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
      return { ...p, models: next }
    })
  }, [])

  /** Test a specific model by passing it as the provider.model while using the current API key. */
  const testModel = useCallback(async (modelName: string) => {
    setModelStatus((prev) => ({ ...prev, [modelName]: { ok: false, msg: '', loading: true } }))
    try {
      const provider: AIProviderConfig = {
        id: initial?.id ?? 'test',
        name: form.name,
        type: form.type,
        apiKey: form.apiKey,
        baseUrl: form.baseUrl,
        model: modelName,
        models: [modelName],
        enabled: true,
      }
      const res = await window.api.ai.testConnection(provider as unknown as Record<string, unknown>)
      if (res.ok) {
        setModelStatus((prev) => ({ ...prev, [modelName]: { ok: true, msg: res.data } }))
      } else {
        setModelStatus((prev) => ({ ...prev, [modelName]: { ok: false, msg: res.error } }))
      }
    } catch (err) {
      setModelStatus((prev) => ({ ...prev, [modelName]: { ok: false, msg: String(err) } }))
    }
  }, [form, initial])

  const canSave = form.name.trim() && form.apiKey.trim() && form.models.length > 0

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
          className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus-visible:ring-1 focus-visible:ring-accent-main/50 focus:border-accent-main/50 placeholder-tx-faint"
        />
      </div>

      {/* API Key */}
      <div>
        <label className="block text-xs text-tx-muted mb-1.5">API Key</label>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={form.apiKey}
            onChange={(e) => { setForm((p) => ({ ...p, apiKey: e.target.value })); setModelStatus({}) }}
            placeholder="sk-..."
            className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 pr-9 border border-border-subtle outline-none focus-visible:ring-1 focus-visible:ring-accent-main/50 focus:border-accent-main/50 placeholder-tx-faint font-mono"
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
            className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus-visible:ring-1 focus-visible:ring-accent-main/50 focus:border-accent-main/50 placeholder-tx-faint font-mono"
          />
        </div>
      )}

      {/* Models — supports multiple models under one API key */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs text-tx-muted">Models</label>
          <span className="text-[10px] text-tx-faint">First entry is the default</span>
        </div>

        {/* Current model list — each row has its own test button */}
        {form.models.length > 0 && (
          <div className="space-y-1 mb-2">
            {form.models.map((m, idx) => {
              const status = modelStatus[m]
              return (
                <div key={m}>
                  <div
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border ${
                      idx === 0
                        ? 'border-accent-main/30 bg-accent-main/5'
                        : 'border-border-subtle bg-bg-app'
                    }`}
                  >
                    {idx === 0 ? (
                      <span className="text-[9px] uppercase tracking-wider text-accent-main font-medium shrink-0">
                        default
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => moveModelUp(idx)}
                        className="text-[9px] uppercase tracking-wider text-tx-faint hover:text-tx-muted shrink-0"
                        title="Set as default"
                      >
                        set default
                      </button>
                    )}
                    <code className="flex-1 text-xs text-tx-main font-mono truncate">{m}</code>
                    {/* Per-model test button */}
                    <button
                      type="button"
                      onClick={() => testModel(m)}
                      disabled={!form.apiKey.trim() || status?.loading}
                      className={`shrink-0 p-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                        status?.ok === true
                          ? 'text-status-success hover:bg-status-success/10'
                          : status?.ok === false && !status.loading
                          ? 'text-status-error hover:bg-status-error/10'
                          : 'text-tx-faint hover:text-tx-main hover:bg-bg-hover'
                      }`}
                      title={status?.msg || 'Test this model'}
                    >
                      {status?.loading
                        ? <Loader2 size={11} className="animate-spin" />
                        : status?.ok === true
                        ? <Check size={11} />
                        : <Zap size={11} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeModel(m)}
                      className="text-tx-faint hover:text-status-error shrink-0"
                      title="Remove"
                    >
                      <X size={12} />
                    </button>
                  </div>
                  {/* Inline error under the row if test failed */}
                  {status && !status.loading && !status.ok && status.msg && (
                    <div className="text-[10px] text-status-error px-2.5 py-0.5 truncate">
                      {status.msg}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Add model input */}
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={modelInput}
            onChange={(e) => setModelInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addModel(modelInput)
              }
            }}
            placeholder="Add a model (e.g. glm-5.1)"
            className="flex-1 bg-bg-app text-tx-main text-sm rounded-md px-3 py-1.5 border border-border-subtle outline-none focus-visible:ring-1 focus-visible:ring-accent-main/50 focus:border-accent-main/50 placeholder-tx-faint font-mono"
          />
          <button
            type="button"
            onClick={() => addModel(modelInput)}
            disabled={!modelInput.trim()}
            className="px-3 py-1.5 rounded-md text-xs text-tx-muted hover:text-tx-main hover:bg-bg-active transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add
          </button>
        </div>

        {/* Suggested models — tap to append */}
        {suggestedModels.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {suggestedModels
              .filter((m) => !form.models.includes(m))
              .map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => addModel(m)}
                  className="px-2 py-0.5 rounded text-xs bg-bg-active text-tx-muted hover:text-tx-main transition-colors"
                  title="Click to add"
                >
                  + {m}
                </button>
              ))}
          </div>
        )}
      </div>

      {/* Actions — per-model Test is in each row; bottom has only Save/Cancel */}
      <div className="flex items-center gap-2 pt-1">
        <div className="flex-1 text-[10px] text-tx-faint">
          Use the <Zap size={10} className="inline align-text-top" /> on each model to test it
        </div>
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
  wiki: { name: 'Wiki Ingest', desc: 'Auto-build knowledge wiki — use a cheap model (burns tokens)' },
}

const FEATURES: AIFeature[] = ['completion', 'chat', 'wiki']

// ── Embedding Section ──

// ── Apps Section ──

const AppsSection: React.FC = () => {
  const [, forceUpdate] = useState(0)
  const registry = getAppRegistry()
  const allApps = registry.getAll()

  const toggle = useCallback((id: string) => {
    const app = registry.get(id)
    if (!app) return
    registry.setEnabled(id, !app.enabled)
    // Persist enabled apps list
    const enabledIds = registry.getEnabled().map((a) => a.definition.manifest.id)
    window.api.state.update({ enabledApps: enabledIds })
    forceUpdate((n) => n + 1)
    // Bump global apps version so Sidebar also re-renders
    useUIStore.getState().bumpAppsVersion()
  }, [registry])

  const persistAppOrder = useCallback(() => {
    const orderedIds = registry.getAll().map((a) => a.definition.manifest.id)
    window.api.state.update({ appOrder: orderedIds })
  }, [registry])

  const moveUp = useCallback((id: string) => {
    const apps = registry.getAll()
    const idx = apps.findIndex((a) => a.definition.manifest.id === id)
    if (idx <= 0) return
    const ids = apps.map((a) => a.definition.manifest.id)
    ;[ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]]
    registry.reorder(ids)
    persistAppOrder()
    forceUpdate((n) => n + 1)
  }, [registry, persistAppOrder])

  const moveDown = useCallback((id: string) => {
    const apps = registry.getAll()
    const idx = apps.findIndex((a) => a.definition.manifest.id === id)
    if (idx < 0 || idx >= apps.length - 1) return
    const ids = apps.map((a) => a.definition.manifest.id)
    ;[ids[idx], ids[idx + 1]] = [ids[idx + 1], ids[idx]]
    registry.reorder(ids)
    persistAppOrder()
    forceUpdate((n) => n + 1)
  }, [registry])

  const [expandedApp, setExpandedApp] = useState<string | null>(null)

  return (
    <section className="mb-10">
      <h2 className="text-tx-muted text-xs font-medium uppercase tracking-wider mb-4">Apps</h2>
      <div className="space-y-1.5">
        {allApps.map(({ definition, enabled }, idx) => {
          const m = definition.manifest
          const hasSettings = m.id === 'notes.app'
          const isExpanded = expandedApp === m.id
          return (
            <div key={m.id} className={`group rounded-lg border transition-colors ${enabled ? 'border-border-subtle' : 'border-transparent opacity-50'}`}>
              <div className="flex items-center gap-3 px-3 py-2.5">
                <button
                  onClick={() => hasSettings ? setExpandedApp(isExpanded ? null : m.id) : undefined}
                  className={`flex-1 min-w-0 text-left ${hasSettings ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] text-tx-main font-medium">{m.name}</span>
                    {m.builtin !== false && <span className="text-[9px] text-tx-faint bg-bg-active px-1.5 py-0.5 rounded">built-in</span>}
                    {hasSettings && (
                      isExpanded
                        ? <ChevronDown size={11} className="text-tx-faint" />
                        : <ChevronRight size={11} className="text-tx-faint" />
                    )}
                  </div>
                  <div className="text-[11px] text-tx-faint truncate mt-0.5">{m.description}</div>
                </button>
                {/* Reorder: only on hover */}
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button onClick={() => moveUp(m.id)} disabled={idx === 0} className="text-tx-faint hover:text-tx-main disabled:opacity-20 text-[10px] leading-none p-0.5">▲</button>
                  <button onClick={() => moveDown(m.id)} disabled={idx === allApps.length - 1} className="text-tx-faint hover:text-tx-main disabled:opacity-20 text-[10px] leading-none p-0.5">▼</button>
                </div>
                <button
                  onClick={() => toggle(m.id)}
                  className={`shrink-0 w-9 h-5 rounded-full transition-colors relative ${enabled ? 'bg-accent-main' : 'bg-border-strong'}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-bg-app shadow transition-transform ${enabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                </button>
              </div>
              {isExpanded && enabled && m.id === 'notes.app' && (
                <div className="border-t border-border-subtle px-4 py-4">
                  <NotesAppSettings />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

const EmbeddingSection: React.FC = () => {
  const [savedKey, setSavedKey] = useState('')
  const [editing, setEditing] = useState(false)
  const [formKey, setFormKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.api.collector.getEmbeddingKey().then((res) => {
      if (res.ok && res.data) setSavedKey(res.data)
    })
  }, [])

  const maskedKey = savedKey ? `${savedKey.slice(0, 6)}${'•'.repeat(16)}${savedKey.slice(-4)}` : ''

  const handleTest = useCallback(async () => {
    const key = formKey.trim() || savedKey
    if (!key) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await window.api.collector.testEmbedding(key)
      setTestResult(res.ok ? { ok: true, msg: res.data } : { ok: false, msg: res.error })
    } catch (e) {
      setTestResult({ ok: false, msg: String(e) })
    }
    setTesting(false)
  }, [formKey, savedKey])

  const handleSave = useCallback(async () => {
    const key = formKey.trim()
    if (!key) return
    setSaving(true)
    await window.api.collector.setEmbeddingKey(key)
    setSavedKey(key)
    setFormKey('')
    setEditing(false)
    setSaving(false)
    setTestResult(null)
    window.api.collector.embedAll().catch(() => {})
  }, [formKey])

  const handleStartEdit = useCallback(() => {
    setEditing(true)
    setFormKey(savedKey)
    setTestResult(null)
  }, [savedKey])

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-tx-muted text-xs font-medium uppercase tracking-wider">Embedding</h2>
        {!editing && savedKey && (
          <button onClick={handleStartEdit} className="flex items-center gap-1 text-xs text-tx-muted hover:text-accent-main transition-colors">
            <Pencil size={12} /> Edit
          </button>
        )}
      </div>

      {/* Card view — when configured and not editing */}
      {savedKey && !editing && (
        <div className="bg-bg-hover rounded-lg p-4 border border-border-subtle space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap size={14} className="text-accent-main" />
              <span className="text-[13px] text-tx-main font-medium">Gemini Embedding 2</span>
            </div>
            <span className="text-[10px] text-status-success flex items-center gap-1"><Check size={10} /> Active</span>
          </div>
          <div className="text-[11px] text-tx-faint font-mono">{maskedKey}</div>
          <div className="text-[11px] text-tx-faint">Model: gemini-embedding-2-preview · 768 dimensions</div>
        </div>
      )}

      {/* Empty state — no key configured */}
      {!savedKey && !editing && (
        <div className="bg-bg-hover rounded-lg p-4 border border-border-subtle space-y-3">
          <p className="text-[12px] text-tx-faint leading-relaxed">
            Semantic search uses <span className="text-tx-muted">Google Gemini Embedding 2</span> to understand text, images, and video.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setEditing(true); setFormKey('') }}
              className="px-3 py-1.5 text-[11px] text-bg-app font-medium bg-accent-main rounded-md hover:opacity-90"
            >
              Configure
            </button>
            <a href="#" onClick={(e) => { e.preventDefault(); window.open('https://aistudio.google.com/apikey') }} className="text-[11px] text-accent-main hover:underline">
              Get API key →
            </a>
          </div>
        </div>
      )}

      {/* Edit form */}
      {editing && (
        <div className="bg-bg-hover rounded-lg p-4 border border-border-subtle space-y-4">
          <div>
            <label className="block text-xs text-tx-muted mb-1.5">Gemini API Key</label>
            <div className="flex items-center gap-2">
              <input
                type={showKey ? 'text' : 'password'}
                value={formKey}
                onChange={(e) => { setFormKey(e.target.value); setTestResult(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleTest() }}
                placeholder="AIza..."
                autoFocus
                className="flex-1 bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus-visible:ring-1 focus-visible:ring-accent-main/50 focus:border-accent-main/50 placeholder-tx-faint"
              />
              <button onClick={() => setShowKey(!showKey)} className="p-2 text-tx-faint hover:text-tx-muted" title={showKey ? 'Hide' : 'Show'}>
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="text-[10px] text-tx-faint mt-1.5">
              Get a free key from <a href="#" onClick={(e) => { e.preventDefault(); window.open('https://aistudio.google.com/apikey') }} className="text-accent-main hover:underline">Google AI Studio</a>
            </p>
          </div>

          {/* Test result */}
          {testResult && (
            <div className={`text-[11px] px-3 py-2 rounded-md ${testResult.ok ? 'bg-status-success/10 text-status-success' : 'bg-status-error/10 text-status-error'}`}>
              {testResult.msg}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={handleTest}
              disabled={!formKey.trim() || testing}
              className="px-3 py-1.5 text-[11px] text-tx-muted border border-border-strong rounded-md hover:bg-bg-active disabled:opacity-30 flex items-center gap-1.5"
            >
              {testing ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
              {testing ? 'Testing...' : 'Test'}
            </button>
            <button
              onClick={() => { setEditing(false); setFormKey(''); setTestResult(null) }}
              className="px-3 py-1.5 text-[11px] text-tx-muted border border-border-strong rounded-md hover:bg-bg-active"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!formKey.trim() || saving}
              className="px-3 py-1.5 text-[11px] text-bg-app font-medium bg-accent-main rounded-md hover:opacity-90 disabled:opacity-30"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

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
      model: data.models[0] ?? '',
      models: data.models,
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
      model: data.models[0] ?? '',
      models: data.models,
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
                  <div className="text-xs text-tx-faint font-mono mt-0.5 truncate">
                    {(() => {
                      const modelList = p.models?.length ? p.models : p.model ? [p.model] : []
                      if (modelList.length === 0) return 'no model'
                      if (modelList.length === 1) return modelList[0]
                      return `${modelList[0]} · +${modelList.length - 1} more`
                    })()}
                  </div>
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
                  className="shrink-0 text-tx-faint hover:text-status-error transition-colors"
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

      {/* Feature Routing — pick a specific (provider, model) pair per feature */}
      {ai.providers.length > 0 && !showForm && !editingId && (
        <div className="mt-6">
          <h3 className="text-tx-muted text-xs font-medium uppercase tracking-wider mb-3">Feature Routing</h3>
          <div className="space-y-2">
            {FEATURES.map((feature) => {
              const routed = ai.featureRouting[feature]
              const routedValue = routed
                ? `${routed.providerId}::${routed.model ?? ''}`
                : ''
              return (
                <div key={feature} className="flex items-center gap-3 px-3 py-2 rounded-md border border-border-subtle">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-tx-main">{FEATURE_LABELS[feature].name}</div>
                    <div className="text-[11px] text-tx-faint">{FEATURE_LABELS[feature].desc}</div>
                  </div>
                  <select
                    value={routedValue}
                    onChange={(e) => {
                      const val = e.target.value
                      if (!val) {
                        setAIFeatureProvider(feature, null)
                        return
                      }
                      const [providerId, model] = val.split('::')
                      setAIFeatureProvider(feature, { providerId, model: model || undefined })
                    }}
                    className="bg-bg-app text-tx-main text-xs rounded-md px-2 py-1.5 border border-border-subtle outline-none focus-visible:ring-1 focus-visible:ring-accent-main/50 focus:border-accent-main/50 min-w-[200px]"
                  >
                    <option value="">
                      Default ({ai.providers.find((p) => p.id === ai.activeProviderId)?.name || 'none'})
                    </option>
                    {ai.providers.filter((p) => p.enabled).flatMap((p) => {
                      const modelList = p.models?.length ? p.models : p.model ? [p.model] : []
                      return modelList.map((m) => (
                        <option key={`${p.id}::${m}`} value={`${p.id}::${m}`}>
                          {p.name} · {m}
                        </option>
                      ))
                    })}
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
                className="text-[11px] text-status-error hover:text-red-300"
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
          className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus-visible:ring-1 focus-visible:ring-accent-main/50 focus:border-accent-main/50 placeholder-tx-faint"
        />
      </div>
      <div>
        <label className="block text-xs text-tx-muted mb-1.5">Description <span className="text-tx-faint">(tells AI what this server does)</span></label>
        <input
          type="text" value={form.description}
          onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
          placeholder="e.g. X/Twitter API - search tweets, get user info"
          className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus-visible:ring-1 focus-visible:ring-accent-main/50 focus:border-accent-main/50 placeholder-tx-faint"
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
              className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus-visible:ring-1 focus-visible:ring-accent-main/50 focus:border-accent-main/50 placeholder-tx-faint font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-tx-muted mb-1.5">Arguments (space-separated)</label>
            <input
              type="text" value={form.args}
              onChange={(e) => setForm((p) => ({ ...p, args: e.target.value }))}
              placeholder="e.g. -y @modelcontextprotocol/server-everything"
              className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus-visible:ring-1 focus-visible:ring-accent-main/50 focus:border-accent-main/50 placeholder-tx-faint font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-tx-muted mb-1.5">Environment Variables (KEY=VALUE, one per line)</label>
            <textarea
              value={form.env}
              onChange={(e) => setForm((p) => ({ ...p, env: e.target.value }))}
              placeholder="GITHUB_TOKEN=ghp_..."
              rows={2}
              className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus-visible:ring-1 focus-visible:ring-accent-main/50 focus:border-accent-main/50 placeholder-tx-faint font-mono resize-none"
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
              className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus-visible:ring-1 focus-visible:ring-accent-main/50 focus:border-accent-main/50 placeholder-tx-faint font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-tx-muted mb-1.5">Headers (Key: Value, one per line)</label>
            <textarea
              value={form.headers}
              onChange={(e) => setForm((p) => ({ ...p, headers: e.target.value }))}
              placeholder="Authorization: Bearer sk-..."
              rows={2}
              className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus-visible:ring-1 focus-visible:ring-accent-main/50 focus:border-accent-main/50 placeholder-tx-faint font-mono resize-none"
            />
          </div>
        </>
      )}
      <div>
        <label className="block text-xs text-tx-muted mb-1.5">Timeout (ms)</label>
        <input
          type="number" value={form.timeout}
          onChange={(e) => setForm((p) => ({ ...p, timeout: Number(e.target.value) || 30000 }))}
          className="w-32 bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus-visible:ring-1 focus-visible:ring-accent-main/50 focus:border-accent-main/50 font-mono"
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
            className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus-visible:ring-1 focus-visible:ring-accent-main/50 focus:border-accent-main/50 font-mono resize-y leading-relaxed"
          />
          {jsonError && <div className="text-xs text-status-error px-1">{jsonError}</div>}
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
                  <button onClick={() => handleToggle(s.id)} className={`shrink-0 ${s.enabled ? 'text-status-success' : 'text-tx-faint'}`} title={s.enabled ? 'Enabled' : 'Disabled'}>
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
                  <button onClick={() => handleRemove(s.id)} className="shrink-0 text-tx-faint hover:text-status-error transition-colors" title="Delete">
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

// ── App Tools for AI Section ──

const AppToolsSection: React.FC = () => {
  const [tools, setTools] = useState<{ name: string; description: string; appId: string; enabled: boolean }[]>([])
  const [disabledTools, setDisabledTools] = useState<Set<string>>(new Set())
  const [serverRunning, setServerRunning] = useState(false)
  const [serverPort, setServerPort] = useState<number | null>(null)
  const [serverLoading, setServerLoading] = useState(false)

  // Subscribe to apps version so tools re-filter when apps are enabled/disabled
  const appsVersion = useUIStore((s) => s.appsVersion)

  useEffect(() => {
    // Load disabled tools + server status
    window.api.state.get().then((res) => {
      if (res.ok && res.data.disabledBusTools) {
        setDisabledTools(new Set(res.data.disabledBusTools as string[]))
      }
    })
    window.api.bus.serverStatus().then((res: any) => {
      if (res.ok) { setServerRunning(res.data.running); setServerPort(res.data.port) }
    })
    // Load available tools from Bus — filter to enabled apps only.
    // When an app is disabled, its tools shouldn't show here as "on",
    // because they aren't actually exposed to AI / external clients.
    const loadTools = async () => {
      const bus = (await import('../../core/AppContext')).getAppBus()
      const registry = getAppRegistry()
      const enabledAppIds = new Set(registry.getEnabled().map((a) => a.definition.manifest.id))
      const busTools = bus.getTools()
      setTools(
        busTools
          .filter((t) => !t.appId || t.appId === 'system' || enabledAppIds.has(t.appId))
          .map((t) => ({
            name: t.name,
            description: t.description,
            appId: t.appId,
            enabled: true,
          })),
      )
    }
    loadTools()
  }, [appsVersion])

  const toggleTool = (name: string) => {
    setDisabledTools((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      window.api.state.update({ disabledBusTools: Array.from(next) })
      return next
    })
  }

  // Group by app
  const grouped = useMemo(() => {
    const map = new Map<string, typeof tools>()
    for (const t of tools) {
      const list = map.get(t.appId) || []
      list.push(t)
      map.set(t.appId, list)
    }
    return Array.from(map.entries())
  }, [tools])

  const toggleServer = async () => {
    setServerLoading(true)
    if (serverRunning) {
      await window.api.bus.stopServer()
      setServerRunning(false)
      setServerPort(null)
    } else {
      const res = await window.api.bus.startServer()
      if (res.ok) { setServerRunning(true); setServerPort(res.data.port) }
    }
    setServerLoading(false)
  }

  return (
    <section className="mb-10">
      <h2 className="text-tx-muted text-xs font-medium uppercase tracking-wider mb-4">Koto MCP Server</h2>

      {/* MCP Server toggle */}
      <div className="flex items-center gap-3 mb-4 p-3 rounded-lg border border-border-subtle bg-bg-hover/50">
        <button
          onClick={toggleServer}
          disabled={serverLoading}
          className={`w-10 h-5 rounded-full relative transition-colors shrink-0 ${serverRunning ? 'bg-status-success' : 'bg-bg-hover border border-border-subtle'}`}
        >
          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${serverRunning ? 'left-5' : 'left-0.5'}`} />
        </button>
        <div className="flex-1">
          <div className="text-[13px] text-tx-main font-medium">MCP Server</div>
          <div className="text-[11px] text-tx-faint">
            {serverRunning
              ? <span>Running on <code className="text-accent-main">http://koto.localhost:{serverPort}/sse</code></span>
              : 'Start to expose tools to Claude Code and other AI clients'}
          </div>
        </div>
      </div>

      {serverRunning && (
        <div className="mb-4 p-3 rounded-lg border border-border-subtle text-[11px] text-tx-faint font-mono bg-bg-app">
          <div className="text-tx-muted text-[10px] uppercase tracking-wider mb-1">Claude Code config:</div>
          <div className="select-all">{`"koto": { "url": "http://koto.localhost:${serverPort}/sse" }`}</div>
        </div>
      )}

      <p className="text-tx-faint text-[12px] mb-4">
        Toggle which app tools are exposed to AI.
      </p>
      {grouped.length === 0 && (
        <p className="text-tx-faint text-[13px]">No app tools registered yet.</p>
      )}
      {grouped.map(([appId, appTools]) => (
        <div key={appId} className="mb-4">
          <h3 className="text-tx-muted text-[11px] font-medium uppercase tracking-wider mb-2">{appId}</h3>
          <div className="space-y-1">
            {appTools.map((tool) => {
              const isEnabled = !disabledTools.has(tool.name)
              return (
                <div
                  key={tool.name}
                  className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-bg-hover"
                >
                  <button
                    onClick={() => toggleTool(tool.name)}
                    className={`w-8 h-4 rounded-full relative transition-colors shrink-0 ${isEnabled ? 'bg-accent-main' : 'bg-bg-hover border border-border-subtle'}`}
                  >
                    <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${isEnabled ? 'left-4' : 'left-0.5'}`} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-tx-main font-mono">{tool.name}</div>
                    <div className="text-[11px] text-tx-faint truncate">{tool.description}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
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
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. code-review" className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus-visible:ring-1 focus-visible:ring-accent-main/50 focus:border-accent-main/50 placeholder-tx-faint" />
          </div>
          <div>
            <label className="block text-xs text-tx-muted mb-1.5">Description</label>
            <input type="text" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="One-line description" className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus-visible:ring-1 focus-visible:ring-accent-main/50 focus:border-accent-main/50 placeholder-tx-faint" />
          </div>
          <div>
            <label className="block text-xs text-tx-muted mb-1.5">Skill Content (instructions for AI)</label>
            <textarea value={newContent} onChange={(e) => setNewContent(e.target.value)} placeholder="When doing X, focus on..." rows={8} className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus-visible:ring-1 focus-visible:ring-accent-main/50 focus:border-accent-main/50 placeholder-tx-faint font-mono resize-none" />
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
            <input type="text" value={importInput} onChange={(e) => { setImportInput(e.target.value); setImportError(null) }} placeholder="skills.sh URL, GitHub URL, or owner/repo/skill" className="w-full bg-bg-app text-tx-main text-sm rounded-md px-3 py-2 border border-border-subtle outline-none focus-visible:ring-1 focus-visible:ring-accent-main/50 focus:border-accent-main/50 placeholder-tx-faint font-mono" />
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
          {importError && <div className="text-xs text-status-error px-1">{importError}</div>}
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
                    className={`shrink-0 ${skill.enabled ? 'text-status-success' : 'text-tx-faint'}`}
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
                  <button onClick={() => handleDelete(skill.name)} className="shrink-0 text-tx-faint hover:text-status-error transition-colors" title="Delete">
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

// ── Per-App Settings: Notes ──

const NotesAppSettings: React.FC = () => {
  const markdownTheme = useUIStore((s) => s.markdownTheme)
  const setMarkdownTheme = useUIStore((s) => s.setMarkdownTheme)
  const liteHome = useUIStore((s) => s.liteHome)
  const [userThemes, setUserThemes] = useState<string[]>([])

  // Scan user themes directory
  useEffect(() => {
    if (!liteHome) return
    window.api.fs.readDir(`${liteHome}/themes/md`).then((res) => {
      if (res.ok && res.data) {
        const cssFiles = (res.data as Array<{ name: string; isDirectory: boolean }>)
          .filter((f) => !f.isDirectory && f.name.endsWith('.css'))
          .map((f) => f.name)
        setUserThemes(cssFiles)
      }
    }).catch(() => {})
  }, [liteHome, markdownTheme])

  const mdThemes = [
    { id: 'default', name: 'Default', desc: 'Inherits app theme — monospace, dark' },
    { id: 'github', name: 'GitHub', desc: 'Sans-serif, larger headings' },
    { id: 'serif', name: 'Serif', desc: 'Reading-focused, relaxed spacing' },
    { id: 'compact', name: 'Compact', desc: 'Tight spacing, smaller text' },
  ]

  const handleImport = async () => {
    const res = await window.api.dialog.selectFile([{ name: 'CSS Files', extensions: ['css'] }])
    if (!res.ok || !res.data || !liteHome) return
    const srcPath = res.data
    const fileName = srcPath.split('/').pop() || 'imported.css'
    const readRes = await window.api.fs.readFile(srcPath)
    if (!readRes.ok) return
    const destPath = `${liteHome}/themes/md/${fileName}`
    await window.api.fs.writeFile(destPath, readRes.data)
    setMarkdownTheme(fileName)
  }

  const handleOpenThemesDir = () => {
    if (liteHome) window.api.shell.revealPath(`${liteHome}/themes/md`)
  }

  return (
    <div>
      <h3 className="text-tx-muted text-[11px] font-medium uppercase tracking-wider mb-2">Markdown Theme</h3>
      <p className="text-[11px] text-tx-faint mb-3">
        Controls typography, spacing, and colors of markdown content. Supports Typora-compatible CSS.
      </p>
      <div className="space-y-0.5 mb-3">
        {mdThemes.map((t) => (
          <button
            key={t.id}
            onClick={() => setMarkdownTheme(t.id)}
            className={`w-full flex items-center justify-between px-2.5 py-2 rounded text-left transition-colors ${
              markdownTheme === t.id
                ? 'bg-accent-main/10 text-accent-main'
                : 'text-tx-main hover:bg-bg-active'
            }`}
          >
            <div>
              <div className="text-[12px]">{t.name}</div>
              <div className="text-[10px] text-tx-faint mt-0.5">{t.desc}</div>
            </div>
            {markdownTheme === t.id && (
              <Check size={12} className="text-accent-main shrink-0 ml-2" />
            )}
          </button>
        ))}

        {userThemes.map((fileName) => (
          <button
            key={fileName}
            onClick={() => setMarkdownTheme(fileName)}
            className={`w-full flex items-center justify-between px-2.5 py-2 rounded text-left transition-colors ${
              markdownTheme === fileName
                ? 'bg-accent-main/10 text-accent-main'
                : 'text-tx-main hover:bg-bg-active'
            }`}
          >
            <div>
              <div className="text-[12px]">{fileName.replace(/\.css$/, '')}</div>
              <div className="text-[10px] text-tx-faint mt-0.5">Custom theme</div>
            </div>
            {markdownTheme === fileName && (
              <Check size={12} className="text-accent-main shrink-0 ml-2" />
            )}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleImport}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-tx-muted border border-border-subtle rounded hover:text-tx-main hover:border-border-strong transition-colors"
        >
          Import CSS
        </button>
        <button
          onClick={handleOpenThemesDir}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-tx-muted border border-border-subtle rounded hover:text-tx-main hover:border-border-strong transition-colors"
        >
          <FolderOpen size={11} />
          Open Themes Folder
        </button>
      </div>
    </div>
  )
}

// ── Storage Section ──

const StorageSection: React.FC = () => {
  const [liteHome, setLiteHome] = useState<string>('')

  useEffect(() => {
    window.api.lite.getHome().then((res) => {
      if (res.ok) setLiteHome(res.data)
    })
  }, [])

  const handleReveal = useCallback(() => {
    if (!liteHome) return
    window.api.shell.revealPath(liteHome)
  }, [liteHome])

  const handleCopy = useCallback(() => {
    if (!liteHome) return
    navigator.clipboard.writeText(liteHome).catch(() => {})
  }, [liteHome])

  return (
    <section className="mb-10">
      <h2 className="text-tx-muted text-xs font-medium uppercase tracking-wider mb-4">Storage</h2>
      <div className="rounded-lg border border-border-subtle p-3">
        <div className="text-[11px] text-tx-faint mb-2 uppercase tracking-wider">Data Location</div>
        <div className="flex items-center gap-2">
          <code className="flex-1 min-w-0 truncate text-[11px] font-mono text-tx-muted bg-bg-hover px-2 py-1.5 rounded">
            {liteHome || '—'}
          </code>
          <button
            onClick={handleCopy}
            className="p-1.5 rounded text-tx-faint hover:text-tx-main hover:bg-bg-hover transition-colors"
            title="Copy path"
          >
            <Copy size={12} />
          </button>
          <button
            onClick={handleReveal}
            className="flex items-center gap-1 px-2 py-1.5 rounded text-[11px] text-tx-muted hover:text-tx-main hover:bg-bg-hover transition-colors"
            title="Reveal in file manager"
          >
            <FolderOpen size={12} />
            Open
          </button>
        </div>
        <p className="text-[11px] text-tx-faint mt-2 leading-relaxed">
          All your notes, collected items, memories, and settings live here. Back up this folder to preserve everything.
        </p>
      </div>
    </section>
  )
}

// ── Keyboard Shortcuts Section ──

const SHORTCUTS: { group: string; items: { keys: string; label: string }[] }[] = [
  {
    group: 'Global',
    items: [
      { keys: '⌘K', label: 'Open command palette (search everything)' },
      { keys: '⌘P', label: 'Open command palette (same as ⌘K)' },
      { keys: '⌘⇧P', label: 'Open command palette in command mode' },
      { keys: '⌘⇧K', label: 'Open context panel (inject files/links into terminal)' },
      { keys: '⌘\\', label: 'Toggle sidebar' },
      { keys: 'Esc', label: 'Close command palette / file switcher / modal' },
    ],
  },
  {
    group: 'Navigation',
    items: [
      { keys: '⌃Tab', label: 'Switch between recent files & terminals (forward)' },
      { keys: '⌃⇧Tab', label: 'Switch to previous file / terminal' },
      { keys: '⌃-', label: 'Go back in navigation history' },
      { keys: '⌃⇧-', label: 'Go forward in navigation history' },
    ],
  },
  {
    group: 'Command Palette prefixes — type after ⌘K',
    items: [
      { keys: '>', label: 'Run a command (new note, toggle sidebar, etc.)' },
      { keys: '#', label: 'Search inside file contents (ripgrep)' },
      { keys: ':', label: 'Jump to line number in current file' },
      { keys: 'n ', label: 'Restrict search to Notes only' },
      { keys: 'c ', label: 'Restrict search to Collector only' },
      { keys: 't ', label: 'Restrict search to Terminal sessions only' },
    ],
  },
  {
    group: 'Notes editor',
    items: [
      { keys: '⌘S', label: 'Save current file (auto-save is on by default)' },
      { keys: '⌘Z / ⌘⇧Z', label: 'Undo / Redo' },
      { keys: '⌘B', label: 'Bold selected text' },
      { keys: '⌘I', label: 'Italic selected text' },
      { keys: '/', label: 'Open slash menu (block commands)' },
      { keys: 'Tab', label: 'Accept AI ghost-text completion' },
    ],
  },
  {
    group: 'Code editor',
    items: [
      { keys: '⌘/', label: 'Toggle line comment' },
      { keys: '⌘D', label: 'Select next occurrence' },
      { keys: '⌘F', label: 'Find in file' },
      { keys: '⌘G', label: 'Go to next match' },
      { keys: 'Tab', label: 'Accept AI ghost-text completion' },
    ],
  },
  {
    group: 'Terminal',
    items: [
      { keys: '⌘⌥←/→', label: 'Focus previous / next split pane' },
      { keys: '⌘⌥W', label: 'Close active terminal' },
    ],
  },
  {
    group: 'AI',
    items: [
      { keys: '⌘J', label: 'Open AI chat panel in notes' },
      { keys: '⌘⇧L', label: 'Inline AI command (in notes editor)' },
    ],
  },
]

const KeyboardSection: React.FC = () => (
  <section className="mb-10">
    <h2 className="text-tx-muted text-xs font-medium uppercase tracking-wider mb-4 flex items-center gap-1.5">
      <Keyboard size={12} />
      Keyboard Shortcuts
    </h2>
    <div className="space-y-4">
      {SHORTCUTS.map((group) => (
        <div key={group.group} className="rounded-lg border border-border-subtle overflow-hidden">
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-tx-faint bg-bg-hover/40 border-b border-border-subtle">
            {group.group}
          </div>
          {group.items.map((item) => (
            <div
              key={item.keys}
              className="flex items-center gap-3 px-3 py-2 border-b border-border-subtle last:border-b-0"
            >
              <kbd className="shrink-0 min-w-[60px] px-2 py-0.5 rounded text-[10px] font-mono bg-bg-hover border border-border-subtle text-tx-main text-center">
                {item.keys}
              </kbd>
              <span className="text-[12px] text-tx-muted">{item.label}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
    <p className="text-[10px] text-tx-faint mt-3">
      Custom key bindings coming in v1.1.
    </p>
  </section>
)

// ── About Section ──

const AboutSection: React.FC = () => {
  const version = '1.0.0'
  return (
    <section className="mb-10">
      <h2 className="text-tx-muted text-xs font-medium uppercase tracking-wider mb-4 flex items-center gap-1.5">
        <Info size={12} />
        About
      </h2>
      <div className="rounded-lg border border-border-subtle p-4">
        <div className="text-[15px] text-tx-main font-medium mb-1">Koto</div>
        <div className="text-[11px] text-tx-faint mb-3">A quiet workspace for every thing you think.</div>
        <div className="space-y-1 text-[11px] text-tx-muted font-mono">
          <div>Version <span className="text-tx-main">{version}</span></div>
          <div>Electron <span className="text-tx-main">{window.electron?.process?.versions?.electron ?? '—'}</span></div>
          <div>Chrome <span className="text-tx-main">{window.electron?.process?.versions?.chrome ?? '—'}</span></div>
          <div>Node <span className="text-tx-main">{window.electron?.process?.versions?.node ?? '—'}</span></div>
        </div>
      </div>
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
    ? 'opacity-50 transition-opacity duration-200'
    : 'transition-opacity duration-200'

  const themeGroups = useMemo(() => getThemeGroups(), [])

  // Determine current group and dark/light state
  const currentTheme = builtinThemes[currentThemeId]
  const currentGroup = currentTheme?.group ?? 'Koto'
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

  const TABS = [
    { id: 'general', label: 'General' },
    { id: 'apps', label: 'Apps' },
    { id: 'ai', label: 'AI' },
    { id: 'extensions', label: 'Extensions' },
    { id: 'automation', label: 'Automation' },
    { id: 'keyboard', label: 'Keyboard' },
  ] as const
  type TabId = typeof TABS[number]['id']
  const [activeTab, setActiveTab] = useState<TabId>('general')

  return (
    <div className={`flex-1 flex flex-col overflow-hidden ${blurClass}`}>
      {/* Tab bar */}
      <div className="shrink-0 border-b border-border-subtle">
        <div className="max-w-[560px] mx-auto px-6 pt-8 pb-0">
          <h1 className="text-tx-main text-lg font-semibold mb-4">Settings</h1>
          <div className="flex gap-0">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 text-[13px] border-b-2 transition-colors -mb-px
                  ${activeTab === tab.id
                    ? 'text-tx-active border-accent-main font-medium'
                    : 'text-tx-muted border-transparent hover:text-tx-main hover:border-border-strong'
                  }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[560px] mx-auto py-8 px-6">

        {activeTab === 'general' && (<>
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

          {/* Theme variants within selected group */}
          {(() => {
            const groupThemes = themeGroups.find(g => g.group === currentGroup)?.themes || []
            return (
              <div className={`grid gap-2 mb-4 ${groupThemes.length <= 2 ? 'grid-cols-2' : groupThemes.length <= 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
                {groupThemes.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    className={`flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                      currentThemeId === t.id
                        ? 'bg-accent-main/10 text-accent-main border border-accent-main/30'
                        : 'text-tx-muted hover:bg-bg-hover border border-border-subtle'
                    }`}
                  >
                    {t.isDark ? <Moon size={14} /> : <Sun size={14} />}
                    {t.name}
                  </button>
                ))}
              </div>
            )
          })()}

          {/* Legacy Dark / Light toggle — hidden, kept for compatibility */}
          <div className="hidden flex gap-2">
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

          <StorageSection />
          <AboutSection />
        </>)}

        {activeTab === 'apps' && (<>
          <AppsSection />
        </>)}

        {activeTab === 'keyboard' && (<>
          <KeyboardSection />
        </>)}

        {activeTab === 'ai' && (<>
          <AISettingsSection />
          <EmbeddingSection />
          <MCPServersSection />
          <SkillsSection />
          <AIUsageSection />
        </>)}

        {activeTab === 'extensions' && (<>
          <AppToolsSection />
        </>)}

        {activeTab === 'automation' && (<>
          <ScheduledTasksSection />
        </>)}

        </div>
      </div>
    </div>
  )
}

export { SettingsApp }
export default SettingsApp
