/**
 * Lite MCP Server — exposes app Bus tools to external AI clients.
 *
 * Supports both Streamable HTTP (modern) and SSE (legacy) transports.
 * Claude Code and other MCP clients can connect and use notes.read,
 * collector.search, etc.
 *
 * Flow: External AI → MCP Server → Bus Bridge → Renderer Bus → App handler
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import http from 'http'
import { listBusTools, callBusTool, type BridgedTool } from './bus-bridge'

let httpServer: http.Server | null = null
let cachedTools: BridgedTool[] = []
let activePort: number | null = null

function createMCPServer(): Server {
  const server = new Server(
    { name: 'koto', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
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

  return server
}

/** Start the MCP server on the given port */
export async function startMCPServer(port: number = 3899): Promise<{ port: number }> {
  if (httpServer) {
    console.log(`[MCP Server] Already running on port ${activePort}`)
    return { port: activePort! }
  }

  cachedTools = await listBusTools()
  console.log(`[MCP Server] ${cachedTools.length} tools available`)

  // Each SSE client gets its own server+transport pair
  const sseTransports = new Map<string, { transport: SSEServerTransport; server: Server }>()

  httpServer = http.createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept')
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return }

    const url = new URL(req.url || '/', `http://localhost:${port}`)

    // ── Streamable HTTP transport (modern, /mcp endpoint) ──
    if (url.pathname === '/mcp') {
      try {
        const srv = createMCPServer()
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
        res.on('close', () => { transport.close(); srv.close() })
        await srv.connect(transport)
        await transport.handleRequest(req, res)
      } catch (e) {
        console.error('[MCP Server] Streamable HTTP error:', e)
        if (!res.headersSent) { res.writeHead(500); res.end('Internal error') }
      }
      return
    }

    // ── SSE transport (/sse + /message) ──
    if (url.pathname === '/sse') {
      try {
        const srv = createMCPServer()
        const transport = new SSEServerTransport('/message', res)
        sseTransports.set(transport.sessionId, { transport, server: srv })
        res.on('close', () => {
          sseTransports.delete(transport.sessionId)
          srv.close().catch(() => {})
        })
        await srv.connect(transport)
        console.log(`[MCP Server] SSE client connected: ${transport.sessionId}`)
      } catch (e) {
        console.error('[MCP Server] SSE error:', e)
      }
      return
    }

    if (url.pathname === '/message') {
      const sessionId = url.searchParams.get('sessionId')
      const entry = sessionId ? sseTransports.get(sessionId) : undefined
      if (entry) {
        try {
          await entry.transport.handlePostMessage(req, res)
        } catch (e) {
          console.error('[MCP Server] Message error:', e)
          if (!res.headersSent) { res.writeHead(500); res.end('Error') }
        }
      } else {
        res.writeHead(404)
        res.end('Session not found')
      }
      return
    }

    // ── Health check ──
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', tools: cachedTools.length }))
      return
    }

    res.writeHead(404)
    res.end('Not found')
  })

  return new Promise((resolve, reject) => {
    httpServer!.listen(port, '127.0.0.1', () => {
      activePort = port
      console.log(`[MCP Server] Running on http://koto.localhost:${port}`)
      console.log(`[MCP Server] Streamable HTTP: http://koto.localhost:${port}/mcp`)
      console.log(`[MCP Server] SSE (legacy):    http://koto.localhost:${port}/sse`)
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
}

/** Check if server is running */
export function isMCPServerRunning(): boolean {
  return httpServer !== null
}

/** Get the active port */
export function getMCPServerPort(): number | null {
  return activePort
}
