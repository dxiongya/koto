/**
 * Lite MCP Server — exposes app Bus tools to external AI clients.
 *
 * When enabled, starts an MCP server using SSE transport on a local port.
 * Claude Code and other MCP clients can connect and use notes.read,
 * collector.search, etc.
 *
 * Flow: External AI → MCP Server → Bus Bridge → Renderer Bus → App handler
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import http from 'http'
import { listBusTools, callBusTool, type BridgedTool } from './bus-bridge'

let server: Server | null = null
let httpServer: http.Server | null = null
let cachedTools: BridgedTool[] = []
let activePort: number | null = null

/** Start the MCP server on the given port */
export async function startMCPServer(port: number = 3899): Promise<{ port: number }> {
  if (httpServer) {
    console.log(`[MCP Server] Already running on port ${activePort}`)
    return { port: activePort! }
  }

  // Refresh tools from Bus
  cachedTools = await listBusTools()
  console.log(`[MCP Server] ${cachedTools.length} tools available`)

  server = new Server(
    { name: 'lite-workspace', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Refresh on each list request to catch new tools
    cachedTools = await listBusTools()
    return {
      tools: cachedTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: {
          type: 'object' as const,
          properties: Object.fromEntries(
            Object.entries(t.parameters).map(([k, v]) => [k, {
              type: v.type,
              description: v.description,
              ...(v.enum ? { enum: v.enum } : {}),
            }]),
          ),
          required: Object.entries(t.parameters)
            .filter(([, v]) => v.required)
            .map(([k]) => k),
        },
      })),
    }
  })

  // Call tool
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    try {
      const result = await callBusTool(name, (args || {}) as Record<string, unknown>)
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
      return { content: [{ type: 'text' as const, text }] }
    } catch (e) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
        isError: true,
      }
    }
  })

  // HTTP server with SSE transport
  const transports = new Map<string, SSEServerTransport>()

  httpServer = http.createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return }

    const url = new URL(req.url || '/', `http://localhost:${port}`)

    if (url.pathname === '/sse') {
      // SSE endpoint — client connects here
      const transport = new SSEServerTransport('/message', res)
      transports.set(transport.sessionId, transport)
      res.on('close', () => transports.delete(transport.sessionId))
      await server!.connect(transport)
    } else if (url.pathname === '/message') {
      // Message endpoint — client sends messages here
      const sessionId = url.searchParams.get('sessionId')
      const transport = sessionId ? transports.get(sessionId) : undefined
      if (transport) {
        await transport.handlePostMessage(req, res)
      } else {
        res.writeHead(404)
        res.end('Session not found')
      }
    } else if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', tools: cachedTools.length }))
    } else {
      res.writeHead(404)
      res.end('Not found')
    }
  })

  return new Promise((resolve, reject) => {
    httpServer!.listen(port, '127.0.0.1', () => {
      activePort = port
      console.log(`[MCP Server] Running on http://lite.localhost:${port}`)
      console.log(`[MCP Server] SSE endpoint: http://lite.localhost:${port}/sse`)
      resolve({ port })
    })
    httpServer!.on('error', (e) => {
      console.error('[MCP Server] Failed to start:', e)
      httpServer = null
      reject(e)
    })
  })
}

/** Stop the MCP server */
export async function stopMCPServer(): Promise<void> {
  if (httpServer) {
    httpServer.close()
    httpServer = null
    activePort = null
    console.log('[MCP Server] Stopped')
  }
  if (server) {
    await server.close()
    server = null
  }
}

/** Check if server is running */
export function isMCPServerRunning(): boolean {
  return httpServer !== null
}

/** Get the active port */
export function getMCPServerPort(): number | null {
  return activePort
}
