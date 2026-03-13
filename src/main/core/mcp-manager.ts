/**
 * MCP (Model Context Protocol) Manager
 * Manages lifecycle of MCP server connections via stdio, SSE, or streamable HTTP transport.
 * Uses dynamic import() for the ESM-only @modelcontextprotocol/sdk.
 */
import type { MCPServerConfig } from '../../shared/types'

// Lazy-loaded SDK modules (ESM-only, must use dynamic import)
let _Client: typeof import('@modelcontextprotocol/sdk/client/index.js').Client
let _StdioClientTransport: typeof import('@modelcontextprotocol/sdk/client/stdio.js').StdioClientTransport
let _SSEClientTransport: typeof import('@modelcontextprotocol/sdk/client/sse.js').SSEClientTransport
let _StreamableHTTPClientTransport: typeof import('@modelcontextprotocol/sdk/client/streamableHttp.js').StreamableHTTPClientTransport

async function loadSDK(): Promise<void> {
  if (_Client) return
  const clientMod = await import('@modelcontextprotocol/sdk/client/index.js')
  const stdioMod = await import('@modelcontextprotocol/sdk/client/stdio.js')
  const sseMod = await import('@modelcontextprotocol/sdk/client/sse.js')
  const httpMod = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
  _Client = clientMod.Client
  _StdioClientTransport = stdioMod.StdioClientTransport
  _SSEClientTransport = sseMod.SSEClientTransport
  _StreamableHTTPClientTransport = httpMod.StreamableHTTPClientTransport
}

interface MCPConnection {
  client: InstanceType<typeof _Client>
  tools: MCPToolInfo[]
  config: MCPServerConfig
}

export interface MCPToolInfo {
  serverName: string
  serverId: string
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

const MAX_RETRIES = 3

class MCPManager {
  private connections = new Map<string, MCPConnection>()

  /** Initialize from config — start all enabled servers */
  async initFromConfig(servers: MCPServerConfig[]): Promise<void> {
    await loadSDK()

    // Stop servers no longer in config
    for (const [id] of this.connections) {
      if (!servers.find((s) => s.id === id)) {
        await this.stopServer(id)
      }
    }

    // Start/restart enabled servers
    for (const config of servers) {
      if (!config.enabled) {
        if (this.connections.has(config.id)) {
          await this.stopServer(config.id)
        }
        continue
      }

      // Skip if already running with same config
      const existing = this.connections.get(config.id)
      if (existing && JSON.stringify(existing.config) === JSON.stringify(config)) {
        continue
      }

      // Stop existing if config changed
      if (existing) {
        await this.stopServer(config.id)
      }

      await this.startServer(config)
    }
  }

  /** Create transports to try based on config type */
  private createTransports(config: MCPServerConfig) {
    if (config.url) {
      const url = new URL(config.url)
      const headers = config.headers || {}

      // Try StreamableHTTP first for /mcp endpoints, then fallback to SSE
      if (url.pathname.endsWith('/mcp')) {
        return [
          { type: 'streamable-http', transport: new _StreamableHTTPClientTransport(url, { requestInit: { headers } }) },
          { type: 'sse', transport: new _SSEClientTransport(url, { requestInit: { headers } }) },
        ]
      }
      // For other URLs, try SSE first then StreamableHTTP
      return [
        { type: 'sse', transport: new _SSEClientTransport(url, { requestInit: { headers } }) },
        { type: 'streamable-http', transport: new _StreamableHTTPClientTransport(url, { requestInit: { headers } }) },
      ]
    }

    // Stdio transport
    return [{
      type: 'stdio',
      transport: new _StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...process.env, ...config.env } as Record<string, string>,
      }),
    }]
  }

  /** Start a single MCP server */
  async startServer(config: MCPServerConfig, retryCount = 0): Promise<void> {
    try {
      await loadSDK()

      const transports = this.createTransports(config)
      let lastError: Error | null = null
      let connected = false

      for (const { type, transport } of transports) {
        try {
          const client = new _Client({ name: 'lite-app', version: '1.0.0' })

          console.log(`[MCP] Trying ${type} transport for "${config.name}"...`)
          await Promise.race([
            client.connect(transport),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Connection timeout')), config.timeout || 30000)
            ),
          ])

          // Discover tools
          const toolsResult = await client.listTools()
          const tools: MCPToolInfo[] = (toolsResult.tools || []).map((t) => ({
            serverName: config.name,
            serverId: config.id,
            name: t.name,
            description: t.description || '',
            inputSchema: (t.inputSchema as Record<string, unknown>) || {},
          }))

          this.connections.set(config.id, { client, tools, config })
          console.log(`[MCP] Connected "${config.name}" via ${type} with ${tools.length} tools`)
          connected = true
          break
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err))
          console.warn(`[MCP] ${type} transport failed for "${config.name}":`, lastError.message)
          try { transport.close?.() } catch { /* ignore */ }
        }
      }

      if (!connected) {
        throw lastError || new Error('All transports failed')
      }
    } catch (err) {
      console.error(`[MCP] Failed to start "${config.name}":`, err)

      if (retryCount < MAX_RETRIES) {
        console.log(`[MCP] Retrying "${config.name}" (${retryCount + 1}/${MAX_RETRIES})...`)
        await new Promise((r) => setTimeout(r, 1000 * (retryCount + 1)))
        return this.startServer(config, retryCount + 1)
      }
    }
  }

  /** Stop a single server */
  async stopServer(id: string): Promise<void> {
    const conn = this.connections.get(id)
    if (!conn) return

    try {
      await conn.client.close()
    } catch {
      // Ignore close errors
    }

    this.connections.delete(id)
    console.log(`[MCP] Stopped server "${conn.config.name}"`)
  }

  /** Get all tools from all connected servers */
  getAllTools(): MCPToolInfo[] {
    const tools: MCPToolInfo[] = []
    for (const conn of this.connections.values()) {
      tools.push(...conn.tools)
    }
    return tools
  }

  /** Get server description by id */
  getServerDescription(serverId: string): string {
    return this.connections.get(serverId)?.config.description || ''
  }

  /** Call a tool on a specific server */
  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<string> {
    const conn = this.connections.get(serverId)
    if (!conn) return `MCP server "${serverId}" not connected`

    try {
      const result = await conn.client.callTool({ name: toolName, arguments: args })

      // Extract text from result content
      if (Array.isArray(result.content)) {
        return result.content
          .map((block) => {
            if (typeof block === 'object' && block !== null && 'text' in block) {
              return (block as { text: string }).text
            }
            return JSON.stringify(block)
          })
          .join('\n')
      }

      return typeof result.content === 'string' ? result.content : JSON.stringify(result.content)
    } catch (err) {
      return `MCP tool call failed: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  /** Shutdown all servers */
  async shutdown(): Promise<void> {
    const ids = [...this.connections.keys()]
    await Promise.allSettled(ids.map((id) => this.stopServer(id)))
  }
}

export const mcpManager = new MCPManager()
