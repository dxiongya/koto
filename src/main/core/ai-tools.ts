/**
 * AI Tool definitions and executors.
 * Each tool can be called by the AI during a tool-use loop.
 */
import { execSync } from 'child_process'
import { FileSystemCore, getProjectPath } from './fs'
import { getLiteHome } from './lite-home'
import { searchFilesContent } from './search'
import { loadSkills } from './skills-loader'
import { createAutomation, listAutomations } from './automation-store'
import type { AIToolDefinition, AutomationInterval } from '../../shared/types'
import { mcpManager } from './mcp-manager'
import { listBusTools, callBusTool } from './bus-bridge'

const MAX_RESULT_LENGTH = 8000

function truncate(text: string, max = MAX_RESULT_LENGTH): string {
  if (text.length <= max) return text
  return text.slice(0, max) + `\n...(truncated, ${text.length} total chars)`
}

export interface ToolHandler {
  definition: AIToolDefinition
  execute: (input: Record<string, unknown>) => Promise<string>
}

export const BUILTIN_TOOLS: Record<string, ToolHandler> = {
  web_fetch: {
    definition: {
      name: 'web_fetch',
      description: 'Fetch a web page and return its text content. Use this when the user asks to analyze a URL, summarize a web page, or needs information from the internet.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to fetch' },
        },
        required: ['url'],
      },
    },
    execute: async (input) => {
      const url = String(input.url)
      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LiteBot/1.0)' },
          signal: AbortSignal.timeout(12000),
          redirect: 'follow',
        })
        if (!response.ok) return `HTTP error: ${response.status} ${response.statusText}`
        const contentType = response.headers.get('content-type') || ''
        if (contentType.includes('text/html') || contentType.includes('text/plain') || contentType.includes('application/json')) {
          const text = await response.text()
          // Strip HTML tags for cleaner content
          const cleaned = contentType.includes('html')
            ? text.replace(/<script[\s\S]*?<\/script>/gi, '')
                  .replace(/<style[\s\S]*?<\/style>/gi, '')
                  .replace(/<[^>]+>/g, ' ')
                  .replace(/\s{2,}/g, ' ')
                  .trim()
            : text
          return truncate(cleaned)
        }
        return `Non-text content type: ${contentType}`
      } catch (err) {
        return `Fetch failed: ${err instanceof Error ? err.message : String(err)}`
      }
    },
  },

  file_read: {
    definition: {
      name: 'file_read',
      description: 'Read the content of a file by its path. Paths can be relative to the notes directory or code project directory.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to read' },
        },
        required: ['path'],
      },
    },
    execute: async (input) => {
      const filePath = String(input.path)
      const result = await FileSystemCore.readFile(filePath)
      if (!result.ok) return `Error: ${result.error}`
      return truncate(result.data)
    },
  },

  file_list: {
    definition: {
      name: 'file_list',
      description: 'List files and directories in a given path. Returns file names, types, and nested structure.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to list. Use notes home or code project path.' },
        },
        required: ['path'],
      },
    },
    execute: async (input) => {
      const dirPath = String(input.path)
      const result = await FileSystemCore.readDir(dirPath)
      if (!result.ok) return `Error: ${result.error}`
      const format = (nodes: typeof result.data, indent = ''): string =>
        nodes.map(n => `${indent}${n.isDirectory ? '📁' : '📄'} ${n.name}`).join('\n')
      return truncate(format(result.data))
    },
  },

  search_content: {
    definition: {
      name: 'search_content',
      description: 'Search for text content across files in the notes directory or code project. Returns matching lines with file paths and line numbers.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (supports regex)' },
          directory: { type: 'string', description: 'Optional: specific directory to search in. Defaults to notes home + code project.' },
        },
        required: ['query'],
      },
    },
    execute: async (input) => {
      const query = String(input.query)
      const dirs: string[] = []
      if (input.directory) {
        dirs.push(String(input.directory))
      } else {
        const home = getLiteHome()
        if (home) dirs.push(home)
        const project = getProjectPath()
        if (project) dirs.push(project)
      }
      if (dirs.length === 0) return 'No directories available to search'
      try {
        const results = searchFilesContent(query, dirs, 20)
        if (results.length === 0) return 'No matches found'
        return truncate(
          results.map(r => `${r.filePath}:${r.line}: ${r.content}`).join('\n')
        )
      } catch (err) {
        return `Search failed: ${err instanceof Error ? err.message : String(err)}`
      }
    },
  },

  terminal_exec: {
    definition: {
      name: 'terminal_exec',
      description: 'Execute a shell command and return its output. Use for quick commands like checking versions, listing processes, etc. Has a 10-second timeout.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
        },
        required: ['command'],
      },
    },
    execute: async (input) => {
      const command = String(input.command)
      const cwd = getProjectPath() || getLiteHome() || process.env.HOME || '/'
      try {
        const output = execSync(command, {
          cwd,
          timeout: 10000,
          maxBuffer: 1024 * 1024,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        return truncate(output)
      } catch (err: unknown) {
        const execErr = err as { stdout?: string; stderr?: string; message?: string }
        const stderr = execErr.stderr || ''
        const stdout = execErr.stdout || ''
        return truncate(`Exit with error.\nstdout: ${stdout}\nstderr: ${stderr}`)
      }
    },
  },
  use_skill: {
    definition: {
      name: 'use_skill',
      description:
        'Load a skill by name to guide your approach for the current task. ' +
        'Skills are reusable knowledge/instructions that help you handle specific types of requests. ' +
        'Call this tool when a skill from the available skills catalog matches the user\'s intent.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The skill name to load' },
        },
        required: ['name'],
      },
    },
    execute: async (input) => {
      const name = String(input.name)
      const skills = loadSkills()
      const skill = skills.find((s) => s.name === name)
      if (!skill) return `Skill "${name}" not found. Available: ${skills.map((s) => s.name).join(', ')}`
      return `<skill name="${skill.name}">\n${skill.content}\n</skill>`
    },
  },

  create_automation: {
    definition: {
      name: 'create_automation',
      description:
        'Create a scheduled automation that periodically updates content in a markdown file using AI. ' +
        'Use this when the user wants to set up recurring tasks like: updating a table with latest data, ' +
        'refreshing content periodically, syncing information from external sources, etc. ' +
        'The automation runs on a schedule and can use all available tools (web_fetch, MCP tools, etc.). ' +
        'IMPORTANT: After calling this tool, do NOT mention the automation in your final output — just output the content (table/text). ' +
        'For table targets, set table_identifier to the pipe-separated header cells (e.g. "序号|发布时间|推文内容").',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Short name for this automation' },
          file_path: { type: 'string', description: 'Absolute path to the target .md file' },
          target_type: { type: 'string', enum: ['file', 'section', 'table'], description: 'What to update: entire file, a heading section, or a specific table' },
          section_heading: { type: 'string', description: 'For section target: the heading text including # marks, e.g. "## Market Data"' },
          table_identifier: { type: 'string', description: 'For table target: pipe-separated header cells, e.g. "Name|Price|Change"' },
          prompt: { type: 'string', description: 'Instructions for the AI on what to do each time the automation runs' },
          interval_minutes: { type: 'number', enum: [5, 15, 30, 60, 360, 720, 1440], description: 'How often to run (in minutes). 60 = 1 hour' },
          provider_id: { type: 'string', description: 'AI provider ID to use. If unsure, leave empty to use the first available.' },
        },
        required: ['name', 'file_path', 'target_type', 'prompt', 'interval_minutes'],
      },
    },
    execute: async (input) => {
      const { loadConfig } = await import('./lite-home')

      // Validate file path exists
      const filePath = String(input.file_path)
      if (!filePath || !filePath.startsWith('/')) {
        return `Error: file_path must be an absolute path (starting with /). Got: "${filePath}". Use the active file path from the system context.`
      }
      try {
        const fsStat = await import('fs')
        if (!fsStat.default.existsSync(filePath)) {
          return `Error: File not found: ${filePath}. Make sure to use the active file path from the current editor context.`
        }
      } catch { /* skip stat check */ }

      // Resolve provider — use 'default' to let runner pick from featureRouting.chat
      const providerId = input.provider_id ? String(input.provider_id) : 'default'

      const intervalMinutes = Number(input.interval_minutes) as AutomationInterval
      const targetType = String(input.target_type) as 'file' | 'section' | 'table'

      const result = createAutomation({
        name: String(input.name),
        target: {
          type: targetType,
          filePath: String(input.file_path),
          sectionHeading: targetType === 'section' ? String(input.section_heading || '') : undefined,
          tableIdentifier: targetType === 'table' ? String(input.table_identifier || '') : undefined,
        },
        promptTemplate: String(input.prompt),
        interval: intervalMinutes,
        providerId,
        enableTools: true,
        enabled: true,
      })

      if (!result.ok) return `Error creating automation: ${result.error}`
      return `✅ Automation "${result.data.name}" created successfully!\n` +
        `- ID: ${result.data.id}\n` +
        `- Target: ${targetType} in ${result.data.target.filePath}\n` +
        `- Runs every ${intervalMinutes} minutes\n` +
        `- Status: enabled (will start on next scheduler tick)\n` +
        `- Manage in Settings → Automations`
    },
  },

  list_automations: {
    definition: {
      name: 'list_automations',
      description: 'List all configured automations with their status, schedule, and last run info.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    execute: async () => {
      const result = listAutomations()
      if (!result.ok) return `Error: ${result.error}`
      if (result.data.length === 0) return 'No automations configured yet.'

      return result.data.map(a =>
        `- **${a.name}** (${a.id})\n` +
        `  Target: ${a.target.type} → ${a.target.filePath.split('/').pop()}\n` +
        `  Schedule: every ${a.interval} min | ${a.enabled ? '🟢 enabled' : '⏸ paused'}\n` +
        `  Runs: ${a.runCount} | Last: ${a.lastRunAt ? new Date(a.lastRunAt).toLocaleString() : 'never'} ${a.lastRunStatus === 'error' ? '❌' : a.lastRunStatus === 'success' ? '✅' : ''}`
      ).join('\n\n')
    },
  },
}

/** Get all tools: built-in + MCP */
// Cache Bus tools (refreshed periodically or on demand)
let _cachedBusTools: ToolHandler[] = []

/** Refresh Bus tools from renderer (call after app registration) */
export async function refreshBusTools(): Promise<void> {
  const tools = await listBusTools()
  _cachedBusTools = tools.map((t) => ({
    definition: {
      name: t.name,
      description: `[${t.appId}] ${t.description}`,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(t.parameters).map(([k, v]) => [k, { type: v.type, description: v.description, ...(v.enum ? { enum: v.enum } : {}) }]),
        ),
        required: Object.entries(t.parameters).filter(([, v]) => v.required).map(([k]) => k),
      },
    },
    execute: async (input) => {
      const result = await callBusTool(t.name, input)
      return typeof result === 'string' ? result : JSON.stringify(result, null, 2)
    },
  }))
}

function getAllToolHandlers(): ToolHandler[] {
  const builtIn = Object.values(BUILTIN_TOOLS)

  const mcpTools: ToolHandler[] = mcpManager.getAllTools().map((t) => ({
    definition: {
      name: `mcp_${t.serverId}_${t.name}`,
      description: `[MCP: ${t.serverName}] ${t.description}`,
      parameters: t.inputSchema,
    },
    execute: (input) => mcpManager.callTool(t.serverId, t.name, input),
  }))

  return [...builtIn, ..._cachedBusTools, ...mcpTools]
}

/** Get tool definitions formatted for Anthropic API */
export function getAnthropicTools(): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
  return getAllToolHandlers().map(t => ({
    name: t.definition.name,
    description: t.definition.description,
    input_schema: t.definition.parameters,
  }))
}

/** Get tool definitions formatted for OpenAI API */
export function getOpenAITools(): Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
  return getAllToolHandlers().map(t => ({
    type: 'function' as const,
    function: {
      name: t.definition.name,
      description: t.definition.description,
      parameters: t.definition.parameters,
    },
  }))
}

/** Get all tool definitions (for UI display) */
export function getAllToolDefinitions(): AIToolDefinition[] {
  return getAllToolHandlers().map(t => t.definition)
}

/** Execute a tool by name (built-in, Bus, or MCP) */
export async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  // Check built-in tools first
  const handler = BUILTIN_TOOLS[name]
  if (handler) return handler.execute(input)

  // Check Bus tools (app-provided via provideTool)
  const busTool = _cachedBusTools.find((t) => t.definition.name === name)
  if (busTool) return busTool.execute(input)

  // Check MCP tools (name format: mcp_{serverId}_{toolName})
  const mcpMatch = name.match(/^mcp_([^_]+)_(.+)$/)
  if (mcpMatch) {
    const [, serverId, toolName] = mcpMatch
    return mcpManager.callTool(serverId, toolName, input)
  }

  return `Unknown tool: ${name}`
}
