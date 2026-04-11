/**
 * Automation Scheduler — checks for due automations every 60 seconds.
 *
 * Also syncs automations into the unified task store on start,
 * so they appear in the unified task list and can be managed via task.* API.
 */
import { loadAutomations } from './automation-store'
import { runAutomation } from './automation-runner'
import { findTaskByName, createTask } from './task-store'

const TICK_INTERVAL = 60_000 // 60 seconds

class AutomationScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = new Set<string>() // prevent concurrent runs of same automation

  /** Start the scheduler */
  start(): void {
    if (this.timer) return
    console.log('[Automation] Scheduler started')

    // Sync existing automations to unified task store
    this.syncToTaskStore()

    // Check immediately for overdue automations
    this.tick()

    // Then check every 60 seconds
    this.timer = setInterval(() => this.tick(), TICK_INTERVAL)
  }

  /** Stop the scheduler */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    console.log('[Automation] Scheduler stopped')
  }

  /** Mirror automations into the unified task store (idempotent) */
  private syncToTaskStore(): void {
    try {
      const automations = loadAutomations()
      for (const auto of automations) {
        const existing = findTaskByName(auto.name, 'notes.app')
        if (existing) continue

        createTask({
          name: auto.name,
          type: 'ai-prompt',
          appId: 'notes.app',
          enabled: auto.enabled,
          schedule: `interval:${auto.interval}`,
          config: {
            automationId: auto.id,
            target: auto.target,
            promptTemplate: auto.promptTemplate,
            providerId: auto.providerId,
            enableTools: auto.enableTools,
          },
        })
        console.log(`[Automation] Synced "${auto.name}" to task store`)
      }
    } catch (e) {
      console.error('[Automation] Failed to sync to task store:', e)
    }
  }

  /** Check for due automations and run them */
  private tick(): void {
    const automations = loadAutomations().filter((a) => a.enabled)
    const now = Date.now()

    for (const auto of automations) {
      // Skip if already running
      if (this.running.has(auto.id)) continue

      // Check if due
      const elapsed = now - (auto.lastRunAt ?? 0)
      if (elapsed >= auto.interval * 60_000) {
        this.running.add(auto.id)
        console.log(`[Automation] Running "${auto.name}" (${auto.id})`)

        runAutomation(auto).finally(() => {
          this.running.delete(auto.id)
        })
      }
    }
  }

  /** Manually trigger a specific automation */
  async runNow(id: string): Promise<void> {
    if (this.running.has(id)) {
      throw new Error('Automation is already running')
    }

    const automations = loadAutomations()
    const auto = automations.find((a) => a.id === id)
    if (!auto) throw new Error('Automation not found')

    this.running.add(id)
    try {
      await runAutomation(auto)
    } finally {
      this.running.delete(id)
    }
  }
}

export const automationScheduler = new AutomationScheduler()
