/**
 * AI Tool definitions and executors.
 * Each tool can be called by the AI during a tool-use loop.
 */
import { execSync } from 'child_process'
import { FileSystemCore, getProjectPath } from './fs'
import { getLiteHome } from './lite-home'
import { searchFilesContent } from './search'
import { loadSkills } from './skills-loader'
import type { AIToolDefinition } from '../../shared/types'
import { mcpManager } from './mcp-manager'

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
}

/** Get all tools: built-in + MCP */
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

  return [...builtIn, ...mcpTools]
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

/** Execute a tool by name (built-in or MCP) */
export async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  // Check built-in tools first
  const handler = BUILTIN_TOOLS[name]
  if (handler) return handler.execute(input)

  // Check MCP tools (name format: mcp_{serverId}_{toolName})
  const mcpMatch = name.match(/^mcp_([^_]+)_(.+)$/)
  if (mcpMatch) {
    const [, serverId, toolName] = mcpMatch
    return mcpManager.callTool(serverId, toolName, input)
  }

  return `Unknown tool: ${name}`
}
