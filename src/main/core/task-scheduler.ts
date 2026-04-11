/**
 * Unified Task Scheduler — system-level cron service.
 *
 * 60-second tick checks all enabled tasks. Executors are registered per type.
 * Each app keeps its own execution logic; the scheduler only manages timing.
 */
import { BrowserWindow } from 'electron'
import { IpcChannels } from '../../shared/types'
import {
  listEnabledTasks,
  getTask,
  updateRunStatus,
  type ScheduledTask,
  type TaskRunEvent,
} from './task-store'

const TICK_INTERVAL = 60_000 // 60 seconds

// ── Schedule Parsing ──

/** Named schedule shortcuts → minutes */
const NAMED_SCHEDULES: Record<string, number> = {
  hourly: 60,
  daily: 1440,
  weekly: 10080,
}

/**
 * Parse schedule string into interval in milliseconds.
 * Returns 0 for 'manual' (never auto-run).
 *
 * Formats:
 *   'manual'        → 0
 *   'hourly'        → 60 * 60_000
 *   'daily'         → 1440 * 60_000
 *   'weekly'        → 10080 * 60_000
 *   'interval:N'    → N * 60_000 (N in minutes)
 */
function parseScheduleMs(schedule: string): number {
  if (schedule === 'manual') return 0
  if (NAMED_SCHEDULES[schedule]) return NAMED_SCHEDULES[schedule] * 60_000
  const intervalMatch = schedule.match(/^interval:(\d+)$/)
  if (intervalMatch) return Number(intervalMatch[1]) * 60_000
  return 0
}

// ── Executor Interface ──

export interface TaskExecutor {
  execute(task: ScheduledTask): Promise<{ success: boolean; error?: string }>
  cancel?(taskId: string): boolean
}

// ── Scheduler ──

class TaskScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = new Set<string>()
  private executors = new Map<string, TaskExecutor>()

  /** Register an executor for a task type */
  registerExecutor(type: string, executor: TaskExecutor): void {
    this.executors.set(type, executor)
    console.log(`[TaskScheduler] Registered executor: ${type}`)
  }

  /** Start the scheduler */
  start(): void {
    if (this.timer) return
    console.log('[TaskScheduler] Started')
    this.tick()
    this.timer = setInterval(() => this.tick(), TICK_INTERVAL)
  }

  /** Stop the scheduler */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    console.log('[TaskScheduler] Stopped')
  }

  /** Check all enabled tasks and run due ones */
  private tick(): void {
    try {
      const tasks = listEnabledTasks()
      const now = Date.now()

      for (const task of tasks) {
        if (this.running.has(task.id)) continue

        const intervalMs = parseScheduleMs(task.schedule)
        if (intervalMs <= 0) continue // manual only

        const elapsed = now - (task.lastRunAt ?? 0)
        if (elapsed >= intervalMs) {
          this.executeTask(task)
        }
      }
    } catch (e) {
      console.error('[TaskScheduler] Tick error:', e)
    }
  }

  /** Manually trigger a task by ID */
  async runNow(id: string): Promise<{ success: boolean; error?: string }> {
    if (this.running.has(id)) {
      return { success: false, error: 'Task is already running' }
    }

    const task = getTask(id)
    if (!task) return { success: false, error: 'Task not found' }

    return this.executeTask(task)
  }

  /** Execute a task using its type's executor */
  private async executeTask(task: ScheduledTask): Promise<{ success: boolean; error?: string }> {
    const executor = this.executors.get(task.type)
    if (!executor) {
      console.warn(`[TaskScheduler] No executor for type "${task.type}"`)
      return { success: false, error: `No executor for type "${task.type}"` }
    }

    this.running.add(task.id)
    this.emitEvent({ taskId: task.id, taskName: task.name, status: 'started', timestamp: Date.now() })

    try {
      const result = await executor.execute(task)
      updateRunStatus(task.id, result.success ? 'success' : 'error', result.error)
      this.emitEvent({
        taskId: task.id,
        taskName: task.name,
        status: result.success ? 'completed' : 'error',
        timestamp: Date.now(),
        message: result.error,
      })
      return result
    } catch (e) {
      const error = String(e)
      updateRunStatus(task.id, 'error', error)
      this.emitEvent({
        taskId: task.id,
        taskName: task.name,
        status: 'error',
        timestamp: Date.now(),
        message: error,
      })
      return { success: false, error }
    } finally {
      this.running.delete(task.id)
    }
  }

  /** Cancel a running task (if executor supports it) */
  cancel(id: string): boolean {
    const task = getTask(id)
    if (!task) return false
    const executor = this.executors.get(task.type)
    if (executor?.cancel) {
      const cancelled = executor.cancel(id)
      if (cancelled) {
        this.running.delete(id)
        this.emitEvent({ taskId: id, taskName: task.name, status: 'cancelled', timestamp: Date.now() })
      }
      return cancelled
    }
    return false
  }

  /** Check if a task is currently running */
  isRunning(id: string): boolean {
    return this.running.has(id)
  }

  /** Broadcast run event to all renderer windows */
  private emitEvent(event: TaskRunEvent): void {
    console.log(`[TaskScheduler] ${event.taskName}: ${event.status}${event.message ? ' — ' + event.message : ''}`)
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannels.TASK_RUN_EVENT, event)
    }
  }
}

export const taskScheduler = new TaskScheduler()
