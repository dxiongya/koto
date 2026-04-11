/**
 * Collector Sync Scheduler — Runs sync scripts on schedule.
 * 60-second tick checks for due syncs.
 *
 * Also syncs configs into the unified task store on start,
 * so they appear in the unified task list and can be managed via task.* API.
 */
import { listEnabledSyncConfigs, listSyncConfigs } from './collector-sync-store'
import { runSync, isSyncRunning } from './collector-sync-runner'
import { findTaskByName, createTask } from './task-store'

const TICK_INTERVAL = 60_000 // 60 seconds

const SCHEDULE_MINUTES: Record<string, number> = {
  hourly: 60,
  daily: 1440,
  weekly: 10080,
}

class CollectorSyncScheduler {
  private timer: ReturnType<typeof setInterval> | null = null

  start(): void {
    if (this.timer) return
    console.log('[Collector Sync] Scheduler started')

    // Sync existing configs to unified task store
    this.syncToTaskStore()

    // Check immediately on start
    this.tick()
    this.timer = setInterval(() => this.tick(), TICK_INTERVAL)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      console.log('[Collector Sync] Scheduler stopped')
    }
  }

  /** Mirror sync configs into the unified task store (idempotent) */
  private syncToTaskStore(): void {
    try {
      const configs = listSyncConfigs()
      for (const config of configs) {
        const taskName = `Sync: ${config.groupName}`
        const existing = findTaskByName(taskName, 'collector.app')
        if (existing) continue

        createTask({
          name: taskName,
          type: 'script',
          appId: 'collector.app',
          enabled: config.enabled,
          schedule: config.schedule === 'manual' ? 'manual' : config.schedule,
          config: {
            groupName: config.groupName,
            adapter: config.adapter,
            adapterConfig: config.adapterConfig,
          },
        })
        console.log(`[Collector Sync] Synced "${config.groupName}" to task store`)
      }
    } catch (e) {
      console.error('[Collector Sync] Failed to sync to task store:', e)
    }
  }

  private async tick(): Promise<void> {
    try {
      const configs = listEnabledSyncConfigs()
      const now = Date.now()

      for (const config of configs) {
        if (isSyncRunning(config.groupName)) continue

        const intervalMs = (SCHEDULE_MINUTES[config.schedule] || 0) * 60_000
        if (intervalMs <= 0) continue

        const elapsed = now - (config.lastSyncAt || 0)
        if (elapsed >= intervalMs) {
          console.log(`[Collector Sync] Running scheduled sync for "${config.groupName}"`)
          runSync(config.groupName).catch((e) => {
            console.error(`[Collector Sync] Scheduled sync failed for "${config.groupName}":`, e)
          })
        }
      }
    } catch (e) {
      console.error('[Collector Sync] Scheduler tick error:', e)
    }
  }
}

export const collectorSyncScheduler = new CollectorSyncScheduler()
