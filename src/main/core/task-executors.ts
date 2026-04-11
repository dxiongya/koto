/**
 * Task Executors — registered into the unified TaskScheduler.
 *
 * 4 types:
 *   ai-prompt  → automation-runner (notes AI automation)
 *   script     → collector-sync-runner (collector sync scripts)
 *   shell      → child_process.exec (arbitrary shell commands)
 *   mcp-tool   → Bus.callTool (invoke any app/MCP tool)
 */
import { exec } from 'child_process'
import { taskScheduler, type TaskExecutor } from './task-scheduler'
import type { ScheduledTask } from './task-store'

// ── ai-prompt executor ──

const aiPromptExecutor: TaskExecutor = {
  async execute(task: ScheduledTask) {
    const { runAutomation } = await import('./automation-runner')
    const { loadAutomations } = await import('./automation-store')

    // config.automationId links to the original automation
    const automationId = task.config.automationId as string | undefined
    if (!automationId) {
      // Inline config: build an Automation-like object from task.config
      const auto = {
        id: task.id,
        name: task.name,
        target: task.config.target as any,
        promptTemplate: task.config.promptTemplate as string,
        interval: 0 as any, // not used by runner
        providerId: task.config.providerId as string,
        enableTools: (task.config.enableTools as boolean) ?? true,
        enabled: true,
        createdAt: task.createdAt,
        lastRunAt: task.lastRunAt,
        lastRunStatus: null,
        lastRunError: null,
        runCount: task.runCount,
      }
      try {
        await runAutomation(auto as any)
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }

    // Find the linked automation
    const automations = loadAutomations()
    const auto = automations.find(a => a.id === automationId)
    if (!auto) return { success: false, error: `Automation "${automationId}" not found` }

    try {
      await runAutomation(auto)
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  },
}

// ── script executor ──

const scriptExecutor: TaskExecutor = {
  async execute(task: ScheduledTask) {
    const { runSync } = await import('./collector-sync-runner')

    const groupName = task.config.groupName as string
    if (!groupName) return { success: false, error: 'No groupName in config' }

    try {
      const result = await runSync(groupName)
      return { success: result.success, error: result.error }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  },

  cancel(_taskId: string) {
    // The sync runner tracks by groupName, so we can't cancel by taskId directly.
    // Cancellation works via the collector sync API (cancelSync(groupName)).
    return false
  },
}

// ── shell executor ──

const shellExecutor: TaskExecutor = {
  execute(task: ScheduledTask) {
    const command = task.config.command as string
    if (!command) return Promise.resolve({ success: false, error: 'No command in config' })

    const timeout = (task.config.timeout as number) || 300_000 // 5 min default
    const cwd = (task.config.cwd as string) || process.env.HOME || '/'

    return new Promise((resolve) => {
      exec(command, { timeout, cwd, shell: '/bin/zsh' }, (error, _stdout, stderr) => {
        if (error) {
          resolve({ success: false, error: `${error.message}\n${stderr}`.trim() })
        } else {
          resolve({ success: true })
        }
      })
    })
  },
}

// ── mcp-tool executor ──

const mcpToolExecutor: TaskExecutor = {
  async execute(task: ScheduledTask) {
    const { callBusTool } = await import('./bus-bridge')

    const toolName = task.config.toolName as string
    if (!toolName) return { success: false, error: 'No toolName in config' }

    const toolParams = (task.config.toolParams as Record<string, unknown>) || {}

    try {
      await callBusTool(toolName, toolParams)
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  },
}

// ── Registration ──

export function registerBuiltinExecutors(): void {
  taskScheduler.registerExecutor('ai-prompt', aiPromptExecutor)
  taskScheduler.registerExecutor('script', scriptExecutor)
  taskScheduler.registerExecutor('shell', shellExecutor)
  taskScheduler.registerExecutor('mcp-tool', mcpToolExecutor)
}
