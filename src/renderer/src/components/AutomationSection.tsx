/**
 * Automation Management — SettingsApp section for creating/managing AI automations
 */
import React, { useState, useEffect, useCallback } from 'react'
import {
  Plus, Trash2, Play, Pause, Clock, ChevronDown, ChevronRight,
  Loader2, AlertCircle, CheckCircle2, History, Zap, RotateCcw, MapPin
} from 'lucide-react'
import { useUIStore } from '../store/useUIStore'
import type { Automation, AutomationSnapshot, AutomationTargetType, AutomationInterval } from '../../../shared/types'

const INTERVAL_LABELS: Record<AutomationInterval, string> = {
  5: '5 min',
  15: '15 min',
  30: '30 min',
  60: '1 hour',
  360: '6 hours',
  720: '12 hours',
  1440: '24 hours',
}

const TARGET_TYPE_LABELS: Record<AutomationTargetType, string> = {
  file: 'Entire File',
  section: 'Section',
  table: 'Table',
}

// ── Create/Edit Form ──

interface FormData {
  name: string
  targetType: AutomationTargetType
  filePath: string
  sectionHeading: string
  tableIdentifier: string
  promptTemplate: string
  interval: AutomationInterval
  providerId: string
  enableTools: boolean
}

const AutomationForm: React.FC<{
  initial?: Automation
  providers: Array<{ id: string; name: string }>
  onSave: (data: FormData) => void
  onCancel: () => void
}> = ({ initial, providers, onSave, onCancel }) => {
  const [form, setForm] = useState<FormData>({
    name: initial?.name ?? '',
    targetType: initial?.target.type ?? 'file',
    filePath: initial?.target.filePath ?? '',
    sectionHeading: initial?.target.sectionHeading ?? '',
    tableIdentifier: initial?.target.tableIdentifier ?? '',
    promptTemplate: initial?.promptTemplate ?? '',
    interval: initial?.interval ?? 60,
    providerId: initial?.providerId ?? 'default',
    enableTools: initial?.enableTools ?? true,
  })

  const update = (key: keyof FormData, value: unknown): void => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div className="space-y-3 p-3 rounded-lg border border-border-subtle bg-bg-app/50">
      {/* Name */}
      <div>
        <label className="text-[10px] text-tx-faint uppercase tracking-wider">Name</label>
        <input
          value={form.name}
          onChange={(e) => update('name', e.target.value)}
          placeholder="e.g., Update crypto prices"
          className="w-full mt-1 px-2.5 py-1.5 rounded bg-bg-input border border-border-subtle text-tx-main text-xs outline-none focus:border-accent-main/50"
        />
      </div>

      {/* Target type */}
      <div>
        <label className="text-[10px] text-tx-faint uppercase tracking-wider">Target Type</label>
        <div className="flex gap-1.5 mt-1">
          {(['file', 'section', 'table'] as AutomationTargetType[]).map((t) => (
            <button
              key={t}
              onClick={() => update('targetType', t)}
              className={`px-2.5 py-1 rounded text-[11px] transition-colors ${
                form.targetType === t
                  ? 'bg-accent-main/15 text-accent-main'
                  : 'bg-bg-hover text-tx-muted hover:text-tx-main'
              }`}
            >
              {TARGET_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {/* File path */}
      <div>
        <label className="text-[10px] text-tx-faint uppercase tracking-wider">File Path</label>
        <input
          value={form.filePath}
          onChange={(e) => update('filePath', e.target.value)}
          placeholder="/path/to/notes/file.md"
          className="w-full mt-1 px-2.5 py-1.5 rounded bg-bg-input border border-border-subtle text-tx-main text-xs font-mono outline-none focus:border-accent-main/50"
        />
      </div>

      {/* Section heading (conditional) */}
      {form.targetType === 'section' && (
        <div>
          <label className="text-[10px] text-tx-faint uppercase tracking-wider">Section Heading</label>
          <input
            value={form.sectionHeading}
            onChange={(e) => update('sectionHeading', e.target.value)}
            placeholder="e.g., ## Market Data"
            className="w-full mt-1 px-2.5 py-1.5 rounded bg-bg-input border border-border-subtle text-tx-main text-xs outline-none focus:border-accent-main/50"
          />
        </div>
      )}

      {/* Table identifier (conditional) */}
      {form.targetType === 'table' && (
        <div>
          <label className="text-[10px] text-tx-faint uppercase tracking-wider">Table Header (pipe-separated)</label>
          <input
            value={form.tableIdentifier}
            onChange={(e) => update('tableIdentifier', e.target.value)}
            placeholder="e.g., Name|Price|Change"
            className="w-full mt-1 px-2.5 py-1.5 rounded bg-bg-input border border-border-subtle text-tx-main text-xs outline-none focus:border-accent-main/50"
          />
        </div>
      )}

      {/* Prompt template */}
      <div>
        <label className="text-[10px] text-tx-faint uppercase tracking-wider">AI Prompt</label>
        <textarea
          value={form.promptTemplate}
          onChange={(e) => update('promptTemplate', e.target.value)}
          placeholder="Describe what the AI should do each time this runs..."
          rows={4}
          className="w-full mt-1 px-2.5 py-1.5 rounded bg-bg-input border border-border-subtle text-tx-main text-xs outline-none focus:border-accent-main/50 resize-none"
        />
      </div>

      {/* Interval + Provider row */}
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-[10px] text-tx-faint uppercase tracking-wider">Interval</label>
          <select
            value={form.interval}
            onChange={(e) => update('interval', Number(e.target.value))}
            className="w-full mt-1 px-2.5 py-1.5 rounded bg-bg-input border border-border-subtle text-tx-main text-xs outline-none"
          >
            {Object.entries(INTERVAL_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="text-[10px] text-tx-faint uppercase tracking-wider">AI Provider</label>
          <select
            value={form.providerId}
            onChange={(e) => update('providerId', e.target.value)}
            className="w-full mt-1 px-2.5 py-1.5 rounded bg-bg-input border border-border-subtle text-tx-main text-xs outline-none"
          >
            <option value="default">Default (AI Chat)</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Enable tools toggle */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={form.enableTools}
          onChange={(e) => update('enableTools', e.target.checked)}
          className="accent-[var(--accent-main)]"
        />
        <span className="text-xs text-tx-muted">Enable tools (web_fetch, MCP, skills)</span>
      </label>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onSave(form)}
          disabled={!form.name.trim() || !form.filePath.trim() || !form.promptTemplate.trim()}
          className="px-3 py-1.5 rounded text-[11px] bg-accent-main/15 text-accent-main hover:bg-accent-main/25 transition-colors disabled:opacity-40"
        >
          {initial ? 'Update' : 'Create'}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded text-[11px] bg-bg-hover text-tx-muted hover:text-tx-main transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Timeline View ──

const SnapshotTimeline: React.FC<{
  automationId: string
  onClose: () => void
}> = ({ automationId, onClose }) => {
  const [snapshots, setSnapshots] = useState<AutomationSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [restoring, setRestoring] = useState<number | null>(null)

  useEffect(() => {
    setLoading(true)
    window.api.automation.getSnapshots(automationId).then((res) => {
      if (res.ok) setSnapshots(res.data)
      setLoading(false)
    })
  }, [automationId])

  const handleRestore = useCallback(async (timestamp: number) => {
    setRestoring(timestamp)
    const res = await window.api.automation.restoreSnapshot(automationId, timestamp)
    setRestoring(null)
    if (!res.ok) alert(`Restore failed: ${res.error}`)
  }, [automationId])

  if (loading) {
    return (
      <div className="p-4 flex items-center gap-2 text-tx-muted text-xs">
        <Loader2 size={12} className="animate-spin" /> Loading snapshots...
      </div>
    )
  }

  return (
    <div className="p-3 rounded-lg border border-border-subtle bg-bg-app/50 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-tx-main font-medium">
          <History size={12} />
          Timeline ({snapshots.length} snapshots)
        </div>
        <button onClick={onClose} className="text-tx-faint hover:text-tx-main text-[10px]">Close</button>
      </div>

      {snapshots.length === 0 ? (
        <div className="text-[11px] text-tx-faint py-2">No snapshots yet</div>
      ) : (
        <div className="space-y-1 max-h-[300px] overflow-y-auto">
          {snapshots.map((snap, i) => (
            <div key={snap.timestamp} className="rounded border border-border-subtle overflow-hidden">
              <button
                onClick={() => setExpanded(expanded === i ? null : i)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-[10px] hover:bg-bg-hover transition-colors"
              >
                {snap.status === 'success' ? (
                  <CheckCircle2 size={10} className="text-status-success shrink-0" />
                ) : (
                  <AlertCircle size={10} className="text-status-error shrink-0" />
                )}
                <span className="text-tx-main font-mono">
                  {new Date(snap.timestamp).toLocaleString()}
                </span>
                <span className="text-tx-faint ml-auto">{snap.targetType}</span>
                {expanded === i ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              </button>

              {expanded === i && (
                <div className="px-2 pb-2 border-t border-border-subtle space-y-1.5">
                  {snap.error && (
                    <div className="text-[9px] text-status-error bg-status-error/10 rounded px-1.5 py-1 mt-1">
                      {snap.error}
                    </div>
                  )}
                  {snap.contentBefore && (
                    <div>
                      <div className="text-[9px] text-tx-faint mt-1">Before:</div>
                      <pre className="text-[9px] text-tx-muted font-mono whitespace-pre-wrap break-all max-h-[80px] overflow-y-auto bg-bg-hover rounded p-1">
                        {snap.contentBefore.slice(0, 500)}{snap.contentBefore.length > 500 ? '...' : ''}
                      </pre>
                    </div>
                  )}
                  {snap.contentAfter && (
                    <div>
                      <div className="text-[9px] text-tx-faint">After:</div>
                      <pre className="text-[9px] text-tx-muted font-mono whitespace-pre-wrap break-all max-h-[80px] overflow-y-auto bg-bg-hover rounded p-1">
                        {snap.contentAfter.slice(0, 500)}{snap.contentAfter.length > 500 ? '...' : ''}
                      </pre>
                    </div>
                  )}
                  {snap.status === 'success' && (
                    <button
                      onClick={() => handleRestore(snap.timestamp)}
                      disabled={restoring === snap.timestamp}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-accent-main/15 text-accent-main hover:bg-accent-main/25 transition-colors disabled:opacity-40"
                    >
                      {restoring === snap.timestamp ? (
                        <Loader2 size={9} className="animate-spin" />
                      ) : (
                        <RotateCcw size={9} />
                      )}
                      Restore this version
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Section ──

export const AutomationSection: React.FC = () => {
  const [automations, setAutomations] = useState<Automation[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [timelineId, setTimelineId] = useState<string | null>(null)
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set())
  const [providers, setProviders] = useState<Array<{ id: string; name: string }>>([])

  const refresh = useCallback(async () => {
    const res = await window.api.automation.list()
    if (res.ok) setAutomations(res.data)
  }, [])

  useEffect(() => {
    refresh()
    // Load AI providers for the form
    window.api.state.get().then((res) => {
      if (res.ok) {
        const aiProviders = (res.data.ai?.providers ?? [])
          .filter((p: { enabled: boolean }) => p.enabled)
          .map((p: { id: string; name: string }) => ({ id: p.id, name: p.name }))
        setProviders(aiProviders)
      }
    })
  }, [refresh])

  // Listen for run events
  useEffect(() => {
    const unsub = window.api.automation.onRunEvent((event) => {
      if (event.status === 'started' || event.status === 'ai_running') {
        setRunningIds((prev) => new Set(prev).add(event.automationId))
      } else if (event.status === 'completed' || event.status === 'error') {
        setRunningIds((prev) => {
          const next = new Set(prev)
          next.delete(event.automationId)
          return next
        })
        refresh()
      }
    })
    return unsub
  }, [refresh])

  const handleCreate = useCallback(async (data: FormData) => {
    await window.api.automation.create({
      name: data.name,
      target: {
        type: data.targetType,
        filePath: data.filePath,
        sectionHeading: data.targetType === 'section' ? data.sectionHeading : undefined,
        tableIdentifier: data.targetType === 'table' ? data.tableIdentifier : undefined,
      },
      promptTemplate: data.promptTemplate,
      interval: data.interval,
      providerId: data.providerId,
      enableTools: data.enableTools,
      enabled: true,
    })
    setShowForm(false)
    refresh()
  }, [refresh])

  const handleUpdate = useCallback(async (data: FormData) => {
    if (!editingId) return
    await window.api.automation.update(editingId, {
      name: data.name,
      target: {
        type: data.targetType,
        filePath: data.filePath,
        sectionHeading: data.targetType === 'section' ? data.sectionHeading : undefined,
        tableIdentifier: data.targetType === 'table' ? data.tableIdentifier : undefined,
      },
      promptTemplate: data.promptTemplate,
      interval: data.interval,
      providerId: data.providerId,
      enableTools: data.enableTools,
    })
    setEditingId(null)
    refresh()
  }, [editingId, refresh])

  const handleDelete = useCallback(async (id: string) => {
    await window.api.automation.delete(id)
    refresh()
  }, [refresh])

  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    await window.api.automation.update(id, { enabled })
    refresh()
  }, [refresh])

  const handleRunNow = useCallback(async (id: string) => {
    setRunningIds((prev) => new Set(prev).add(id))
    await window.api.automation.runNow(id)
  }, [])

  /** Navigate to the automation's target node in the editor */
  const handleLocate = useCallback((auto: Automation) => {
    const store = useUIStore.getState()
    // Switch to notes app and open the target file
    store.setCurrentApp('notes.app')
    store.setActiveFilePath(auto.target.filePath)

    // Wait for the editor to mount, then dispatch scroll event
    setTimeout(() => {
      const identifier = auto.target.type === 'table'
        ? auto.target.tableIdentifier
        : auto.target.sectionHeading
      if (identifier) {
        window.dispatchEvent(new CustomEvent('automation:scrollTo', {
          detail: { targetType: auto.target.type, identifier }
        }))
      }
    }, 500) // allow editor to mount and render
  }, [])

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-tx-muted text-xs font-medium uppercase tracking-wider">Automations</h2>
        <button
          onClick={() => { setShowForm(!showForm); setEditingId(null) }}
          className="flex items-center gap-1 text-[11px] text-accent-main hover:text-accent-main/80 transition-colors"
        >
          <Plus size={12} />
          Add
        </button>
      </div>

      {/* Create form */}
      {showForm && !editingId && (
        <div className="mb-3">
          <AutomationForm
            providers={providers}
            onSave={handleCreate}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {/* Automation list */}
      {automations.length === 0 && !showForm ? (
        <div className="text-[11px] text-tx-faint py-4 text-center">
          No automations configured. Click "Add" to create one.
        </div>
      ) : (
        <div className="space-y-2">
          {automations.map((auto) => (
            <div key={auto.id}>
              {editingId === auto.id ? (
                <AutomationForm
                  initial={auto}
                  providers={providers}
                  onSave={handleUpdate}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div className="rounded-lg border border-border-subtle p-3 space-y-2">
                  {/* Header row */}
                  <div className="flex items-center gap-2">
                    <Zap size={12} className={auto.enabled ? 'text-accent-main' : 'text-tx-faint'} />
                    <span className="text-xs text-tx-main font-medium flex-1 truncate">{auto.name}</span>
                    <span className="text-[10px] text-tx-faint">
                      <Clock size={9} className="inline mr-0.5" />
                      {INTERVAL_LABELS[auto.interval]}
                    </span>
                  </div>

                  {/* Target info */}
                  <div className="text-[10px] text-tx-faint font-mono truncate">
                    {TARGET_TYPE_LABELS[auto.target.type]}: {auto.target.filePath.split('/').pop()}
                    {auto.target.sectionHeading && ` → ${auto.target.sectionHeading}`}
                    {auto.target.tableIdentifier && ` → ${auto.target.tableIdentifier}`}
                  </div>

                  {/* Prompt preview */}
                  <div className="text-[10px] text-tx-muted truncate">{auto.promptTemplate}</div>

                  {/* Status + last run */}
                  <div className="flex items-center gap-2 text-[10px]">
                    {auto.lastRunStatus === 'success' && (
                      <span className="flex items-center gap-0.5 text-status-success">
                        <CheckCircle2 size={9} /> Last run OK
                      </span>
                    )}
                    {auto.lastRunStatus === 'error' && (
                      <span className="flex items-center gap-0.5 text-status-error" title={auto.lastRunError ?? ''}>
                        <AlertCircle size={9} /> Error
                      </span>
                    )}
                    {auto.lastRunAt && (
                      <span className="text-tx-faint">
                        {new Date(auto.lastRunAt).toLocaleString()}
                      </span>
                    )}
                    <span className="text-tx-faint ml-auto">
                      {auto.runCount} runs
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 pt-1 border-t border-border-subtle">
                    <button
                      onClick={() => handleToggle(auto.id, !auto.enabled)}
                      className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-colors ${
                        auto.enabled
                          ? 'bg-accent-main/15 text-accent-main'
                          : 'bg-bg-hover text-tx-faint'
                      }`}
                    >
                      {auto.enabled ? <Pause size={9} /> : <Play size={9} />}
                      {auto.enabled ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      onClick={() => handleRunNow(auto.id)}
                      disabled={runningIds.has(auto.id)}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-bg-hover text-tx-muted hover:text-tx-main transition-colors disabled:opacity-40"
                    >
                      {runningIds.has(auto.id) ? (
                        <Loader2 size={9} className="animate-spin" />
                      ) : (
                        <Play size={9} />
                      )}
                      Run Now
                    </button>
                    <button
                      onClick={() => setTimelineId(timelineId === auto.id ? null : auto.id)}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-bg-hover text-tx-muted hover:text-tx-main transition-colors"
                    >
                      <History size={9} />
                      Timeline
                    </button>
                    <button
                      onClick={() => handleLocate(auto)}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-bg-hover text-tx-muted hover:text-status-warning transition-colors"
                      title="Jump to target node in editor"
                    >
                      <MapPin size={9} />
                      Locate
                    </button>
                    <button
                      onClick={() => { setEditingId(auto.id); setShowForm(false) }}
                      className="px-2 py-1 rounded text-[10px] bg-bg-hover text-tx-muted hover:text-tx-main transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(auto.id)}
                      className="px-2 py-1 rounded text-[10px] bg-bg-hover text-status-error/60 hover:text-status-error transition-colors ml-auto"
                    >
                      <Trash2 size={9} />
                    </button>
                  </div>
                </div>
              )}

              {/* Timeline */}
              {timelineId === auto.id && (
                <div className="mt-2">
                  <SnapshotTimeline
                    automationId={auto.id}
                    onClose={() => setTimelineId(null)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
