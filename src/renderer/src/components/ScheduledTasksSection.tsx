/**
 * Scheduled Tasks — unified view of all task-scheduler tasks.
 * Shows tasks from all sources (automation, collector sync, shell, mcp-tool).
 */
import React, { useState, useEffect, useCallback } from 'react'
import {
  Play, Pause, Trash2, Loader2, CheckCircle2, AlertCircle,
  Clock, Terminal, Zap, Database, Wrench, ChevronDown, ChevronRight
} from 'lucide-react'

interface ScheduledTask {
  id: string
  name: string
  type: string
  appId: string | null
  enabled: boolean
  schedule: string
  config: Record<string, unknown>
  lastRunAt: number | null
  lastRunStatus: string | null
  lastRunError: string | null
  runCount: number
  createdAt: number
  updatedAt: number
}

const TYPE_ICONS: Record<string, React.FC<{ size?: number; className?: string }>> = {
  'ai-prompt': Zap,
  'script': Database,
  'shell': Terminal,
  'mcp-tool': Wrench,
}

const TYPE_LABELS: Record<string, string> = {
  'ai-prompt': 'AI Prompt',
  'script': 'Sync Script',
  'shell': 'Shell',
  'mcp-tool': 'MCP Tool',
}

const SCHEDULE_LABELS: Record<string, string> = {
  manual: 'Manual',
  hourly: 'Hourly',
  daily: 'Daily',
  weekly: 'Weekly',
}

function formatSchedule(schedule: string): string {
  if (SCHEDULE_LABELS[schedule]) return SCHEDULE_LABELS[schedule]
  const m = schedule.match(/^interval:(\d+)$/)
  if (m) {
    const mins = Number(m[1])
    if (mins < 60) return `Every ${mins}m`
    if (mins < 1440) return `Every ${mins / 60}h`
    return `Every ${Math.round(mins / 1440)}d`
  }
  return schedule
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
  return new Date(ts).toLocaleDateString()
}

export const ScheduledTasksSection: React.FC = () => {
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')

  const refresh = useCallback(async () => {
    const res = await window.api.task.list()
    if (res.ok) setTasks(res.data)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Listen for task run events
  useEffect(() => {
    const unsub = window.api.task.onRunEvent((event) => {
      if (event.status === 'started') {
        setRunningIds(prev => new Set(prev).add(event.taskId))
      } else if (event.status === 'completed' || event.status === 'error' || event.status === 'cancelled') {
        setRunningIds(prev => {
          const next = new Set(prev)
          next.delete(event.taskId)
          return next
        })
        refresh()
      }
    })
    return unsub
  }, [refresh])

  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    await window.api.task.update(id, { enabled })
    refresh()
  }, [refresh])

  const handleTrigger = useCallback(async (id: string) => {
    setRunningIds(prev => new Set(prev).add(id))
    await window.api.task.trigger(id)
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    await window.api.task.delete(id)
    refresh()
  }, [refresh])

  const filteredTasks = filter === 'all'
    ? tasks
    : tasks.filter(t => t.type === filter)

  const typeGroups = ['all', 'ai-prompt', 'script', 'shell', 'mcp-tool']

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-tx-muted text-xs font-medium uppercase tracking-wider">
          Scheduled Tasks
        </h2>
        <span className="text-[10px] text-tx-faint">{tasks.length} total</span>
      </div>

      {/* Filter chips */}
      <div className="flex gap-1.5 mb-3">
        {typeGroups.map(type => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
              filter === type
                ? 'bg-accent-main/15 text-accent-main'
                : 'bg-bg-hover text-tx-faint hover:text-tx-muted'
            }`}
          >
            {type === 'all' ? 'All' : TYPE_LABELS[type] || type}
          </button>
        ))}
      </div>

      {filteredTasks.length === 0 ? (
        <div className="text-[11px] text-tx-faint py-4 text-center">
          {tasks.length === 0
            ? 'No scheduled tasks. Tasks from automations and syncs will appear here.'
            : 'No tasks match this filter.'}
        </div>
      ) : (
        <div className="space-y-1.5">
          {filteredTasks.map(task => {
            const Icon = TYPE_ICONS[task.type] || Clock
            const isRunning = runningIds.has(task.id)
            const isExpanded = expandedId === task.id

            return (
              <div key={task.id} className="rounded-lg border border-border-subtle overflow-hidden">
                {/* Task row */}
                <div className="flex items-center gap-2 px-3 py-2">
                  <Icon size={12} className={task.enabled ? 'text-accent-main shrink-0' : 'text-tx-faint shrink-0'} />

                  {/* Name + type badge */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : task.id)}
                    className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                  >
                    <span className={`text-xs truncate ${task.enabled ? 'text-tx-main' : 'text-tx-muted'}`}>
                      {task.name}
                    </span>
                    {task.appId && (
                      <span className="text-[9px] text-tx-faint bg-bg-hover px-1 rounded shrink-0">
                        {task.appId.replace('.app', '')}
                      </span>
                    )}
                    {isExpanded ? <ChevronDown size={10} className="text-tx-faint shrink-0" /> : <ChevronRight size={10} className="text-tx-faint shrink-0" />}
                  </button>

                  {/* Schedule badge */}
                  <span className="text-[9px] text-tx-faint shrink-0">
                    {formatSchedule(task.schedule)}
                  </span>

                  {/* Status indicator */}
                  {task.lastRunStatus === 'success' && (
                    <CheckCircle2 size={10} className="text-status-success shrink-0" />
                  )}
                  {task.lastRunStatus === 'error' && (
                    <span title={task.lastRunError ?? ''}>
                      <AlertCircle size={10} className="text-status-error shrink-0" />
                    </span>
                  )}

                  {/* Actions */}
                  <button
                    onClick={() => handleToggle(task.id, !task.enabled)}
                    className={`p-1 rounded transition-colors ${
                      task.enabled
                        ? 'text-accent-main hover:bg-accent-main/10'
                        : 'text-tx-faint hover:bg-bg-hover'
                    }`}
                    title={task.enabled ? 'Disable' : 'Enable'}
                  >
                    {task.enabled ? <Pause size={10} /> : <Play size={10} />}
                  </button>

                  <button
                    onClick={() => handleTrigger(task.id)}
                    disabled={isRunning}
                    className="p-1 rounded text-tx-muted hover:text-tx-main hover:bg-bg-hover transition-colors disabled:opacity-40"
                    title="Run now"
                  >
                    {isRunning ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
                  </button>

                  <button
                    onClick={() => handleDelete(task.id)}
                    className="p-1 rounded text-tx-faint hover:text-status-error transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="px-3 pb-2 border-t border-border-subtle space-y-1.5">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1.5 text-[10px]">
                      <div>
                        <span className="text-tx-faint">Type: </span>
                        <span className="text-tx-muted">{TYPE_LABELS[task.type] || task.type}</span>
                      </div>
                      <div>
                        <span className="text-tx-faint">Schedule: </span>
                        <span className="text-tx-muted">{formatSchedule(task.schedule)}</span>
                      </div>
                      <div>
                        <span className="text-tx-faint">Runs: </span>
                        <span className="text-tx-muted">{task.runCount}</span>
                      </div>
                      <div>
                        <span className="text-tx-faint">Last run: </span>
                        <span className="text-tx-muted">{task.lastRunAt ? formatRelative(task.lastRunAt) : 'never'}</span>
                      </div>
                    </div>

                    {task.lastRunError && (
                      <div className="text-[9px] text-status-error bg-status-error/10 rounded px-1.5 py-1">
                        {task.lastRunError}
                      </div>
                    )}

                    {/* Config preview */}
                    <div>
                      <div className="text-[9px] text-tx-faint">Config:</div>
                      <pre className="text-[9px] text-tx-muted font-mono whitespace-pre-wrap break-all max-h-[80px] overflow-y-auto bg-bg-hover rounded p-1 mt-0.5">
                        {JSON.stringify(task.config, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
