/**
 * Automation Scheduler — checks for due automations every 60 seconds
 */
import { loadAutomations } from './automation-store'
import { runAutomation } from './automation-runner'

const TICK_INTERVAL = 60_000 // 60 seconds

class AutomationScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = new Set<string>() // prevent concurrent runs of same automation

  /** Start the scheduler */
  start(): void {
    if (this.timer) return
    console.log('[Automation] Scheduler started')

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
