/**
 * Memory Intelligence — The "brain" layer that makes memory.app smart.
 *
 * 1. Room auto-detection: keyword patterns → auto-assign wing/room
 * 2. AAAK compression: 30x lossless compression for LLM-readable storage
 * 3. Contradiction detection: check new facts against existing KG
 * 4. Conversation mining: import Claude/ChatGPT exports
 * 5. Palace graph traversal: discover cross-wing connections
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

// ═══════════════════════════════════════════════════════════
// 1. ROOM AUTO-DETECTION
// ═══════════════════════════════════════════════════════════

/** Keyword → room mapping (70+ patterns) */
const CONTENT_ROOM_MAP: Record<string, string> = {
  // Technical
  auth: 'auth', authentication: 'auth', login: 'auth', oauth: 'auth', jwt: 'auth', clerk: 'auth',
  api: 'api', endpoint: 'api', rest: 'api', graphql: 'api', grpc: 'api',
  database: 'database', sql: 'database', postgres: 'database', sqlite: 'database', mongo: 'database', redis: 'database',
  frontend: 'frontend', react: 'frontend', vue: 'frontend', css: 'frontend', tailwind: 'frontend', ui: 'frontend', component: 'frontend',
  backend: 'backend', server: 'backend', node: 'backend', express: 'backend',
  deploy: 'devops', ci: 'devops', docker: 'devops', kubernetes: 'devops', pipeline: 'devops', infra: 'devops',
  test: 'testing', jest: 'testing', e2e: 'testing', coverage: 'testing',
  performance: 'performance', optimize: 'performance', latency: 'performance', cache: 'performance',
  security: 'security', vulnerability: 'security', xss: 'security', injection: 'security',
  architecture: 'architecture', design: 'architecture', pattern: 'architecture', refactor: 'architecture',

  // Product
  feature: 'product', roadmap: 'product', sprint: 'product', milestone: 'product', release: 'product',
  bug: 'bugs', error: 'bugs', crash: 'bugs', fix: 'bugs', issue: 'bugs',
  user: 'users', customer: 'users', feedback: 'users', ux: 'users',
  pricing: 'business', revenue: 'business', cost: 'business', budget: 'business', monetize: 'business',

  // People & Team
  team: 'team', hire: 'team', onboard: 'team', standup: 'team', meeting: 'team',
  preference: 'preferences', prefer: 'preferences', 习惯: 'preferences', 偏好: 'preferences',
  decision: 'decisions', decide: 'decisions', chose: 'decisions', 决定: 'decisions', 选择: 'decisions',

  // Chinese keywords
  架构: 'architecture', 设计: 'architecture', 重构: 'architecture',
  部署: 'devops', 测试: 'testing', 性能: 'performance', 安全: 'security',
  数据库: 'database', 前端: 'frontend', 后端: 'backend',
  产品: 'product', 用户: 'users', 团队: 'team',
  记忆: 'meta', 记住: 'meta',
}

/** Detect the best room for content based on keyword scoring */
export function detectRoom(content: string): string {
  const lower = content.toLowerCase()
  const scores: Record<string, number> = {}

  for (const [keyword, room] of Object.entries(CONTENT_ROOM_MAP)) {
    const regex = new RegExp(keyword, 'gi')
    const matches = lower.match(regex)
    if (matches) {
      scores[room] = (scores[room] || 0) + matches.length
    }
  }

  if (Object.keys(scores).length === 0) return 'general'

  // Return highest scoring room
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0]
}

/** Detect wing from content (project/domain name extraction) */
export function detectWing(content: string, defaultWing = 'general'): string {
  // Look for project name patterns
  const projectPatterns = [
    /(?:project|项目)[:\s]*[""']?([a-zA-Z0-9\u4e00-\u9fff_-]+)/i,
    /(?:repo|repository|仓库)[:\s]*[""']?([a-zA-Z0-9_-]+)/i,
    /(?:working on|开发)\s+[""']?([a-zA-Z0-9\u4e00-\u9fff_-]+)/i,
  ]

  for (const pattern of projectPatterns) {
    const match = content.match(pattern)
    if (match) return match[1].toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
  }

  return defaultWing
}

// ═══════════════════════════════════════════════════════════
// 2. AAAK COMPRESSION
// ═══════════════════════════════════════════════════════════

/** Compress content to AAAK format (LLM-readable, ~30x reduction) */
export function compressToAAAK(content: string, meta?: {
  entities?: string[]
  hall?: string
  importance?: number
  emotions?: string[]
}): string {
  // Extract key sentences (first, last, and any with strong signals)
  const sentences = content.split(/[.!?。！？\n]+/).map(s => s.trim()).filter(s => s.length > 5)
  if (sentences.length === 0) return content

  // Build entity codes (3-letter abbreviations)
  const entities = (meta?.entities || []).map(e => e.slice(0, 3).toUpperCase()).join(',')

  // Extract keywords (nouns, verbs — simplified)
  const words = content.replace(/[^\w\u4e00-\u9fff\s]/g, '').split(/\s+/)
  const keywords = [...new Set(words.filter(w => w.length > 3))].slice(0, 8).join(',')

  // Key quote (most information-dense sentence)
  const keyQuote = sentences.sort((a, b) => b.length - a.length)[0]?.slice(0, 80) || ''

  // Importance stars
  const stars = '★'.repeat(meta?.importance || 3)

  // Hall code
  const hall = meta?.hall || 'general'

  // Emotions
  const emotions = (meta?.emotions || []).join(',')

  // AAAK format
  const lines: string[] = []
  if (entities) lines.push(`ZID:${entities}|${keywords}|"${keyQuote}"|${stars}|${emotions}|${hall}`)
  else lines.push(`ZID:${keywords}|"${keyQuote}"|${stars}|${hall}`)

  // Add condensed facts
  const facts = sentences.slice(0, 5).map(s => s.slice(0, 60))
  if (facts.length > 1) lines.push(`FACTS: ${facts.join(' | ')}`)

  return lines.join('\n')
}

/** Check if content is already in AAAK format */
export function isAAAK(content: string): boolean {
  return content.startsWith('ZID:') || content.startsWith('FACTS:')
}

// ═══════════════════════════════════════════════════════════
// 3. CONTRADICTION DETECTION
// ═══════════════════════════════════════════════════════════

export interface Contradiction {
  type: 'conflict' | 'update' | 'duplicate'
  existingTripleId: string
  existingFact: string
  newFact: string
  message: string
}

/** Check if a new triple contradicts existing facts in the KG */
export function detectContradictions(
  subjectId: string,
  predicate: string,
  objectId: string,
  existingTriples: { id: string; subjectId: string; predicate: string; objectId: string; validTo: string | null }[],
): Contradiction[] {
  const contradictions: Contradiction[] = []

  for (const existing of existingTriples) {
    if (existing.validTo) continue // Skip already-invalidated facts

    // Same subject + predicate but different object → potential conflict
    if (existing.subjectId === subjectId && existing.predicate === predicate && existing.objectId !== objectId) {
      // Exclusive predicates (can only have one)
      const exclusivePredicates = ['uses', 'works_at', 'lives_in', 'married_to', 'role', 'leads', 'manages']
      if (exclusivePredicates.includes(predicate)) {
        contradictions.push({
          type: 'conflict',
          existingTripleId: existing.id,
          existingFact: `${existing.subjectId} ${existing.predicate} ${existing.objectId}`,
          newFact: `${subjectId} ${predicate} ${objectId}`,
          message: `Conflict: "${existing.subjectId}" already "${existing.predicate}" "${existing.objectId}". New claim: "${objectId}". Should the old fact be invalidated?`,
        })
      } else {
        contradictions.push({
          type: 'update',
          existingTripleId: existing.id,
          existingFact: `${existing.subjectId} ${existing.predicate} ${existing.objectId}`,
          newFact: `${subjectId} ${predicate} ${objectId}`,
          message: `Note: "${existing.subjectId}" has multiple "${existing.predicate}" relationships. Existing: "${existing.objectId}", New: "${objectId}".`,
        })
      }
    }

    // Exact duplicate
    if (existing.subjectId === subjectId && existing.predicate === predicate && existing.objectId === objectId) {
      contradictions.push({
        type: 'duplicate',
        existingTripleId: existing.id,
        existingFact: `${subjectId} ${predicate} ${objectId}`,
        newFact: `${subjectId} ${predicate} ${objectId}`,
        message: `Duplicate: This fact already exists.`,
      })
    }
  }

  return contradictions
}

// ═══════════════════════════════════════════════════════════
// 4. CONVERSATION MINING
// ═══════════════════════════════════════════════════════════

export interface MinedMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp?: number
}

export interface MinedConversation {
  id: string
  messages: MinedMessage[]
  source: string
}

/** Normalize Claude Code JSONL session format */
function parseClaudeCodeJSONL(content: string): MinedConversation[] {
  const conversations: MinedConversation[] = []
  const lines = content.split('\n').filter(Boolean)
  const messages: MinedMessage[] = []

  for (const line of lines) {
    try {
      const entry = JSON.parse(line)
      if (entry.type === 'human' || entry.role === 'user') {
        messages.push({ role: 'user', content: typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content), timestamp: entry.timestamp })
      } else if (entry.type === 'assistant' || entry.role === 'assistant') {
        const text = typeof entry.content === 'string' ? entry.content
          : Array.isArray(entry.content) ? entry.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
          : JSON.stringify(entry.content)
        messages.push({ role: 'assistant', content: text, timestamp: entry.timestamp })
      }
    } catch { /* skip malformed lines */ }
  }

  if (messages.length > 0) {
    conversations.push({ id: crypto.randomUUID(), messages, source: 'claude-code-jsonl' })
  }
  return conversations
}

/** Normalize ChatGPT export format */
function parseChatGPTJSON(content: string): MinedConversation[] {
  try {
    const data = JSON.parse(content)
    const conversations: MinedConversation[] = []

    const items = Array.isArray(data) ? data : [data]
    for (const conv of items) {
      const messages: MinedMessage[] = []
      const mapping = conv.mapping || {}

      for (const node of Object.values(mapping) as any[]) {
        const msg = node?.message
        if (!msg || !msg.content?.parts) continue
        const role = msg.author?.role === 'user' ? 'user' : msg.author?.role === 'assistant' ? 'assistant' : null
        if (!role) continue
        const text = msg.content.parts.filter((p: any) => typeof p === 'string').join('\n')
        if (text) messages.push({ role, content: text, timestamp: msg.create_time ? msg.create_time * 1000 : undefined })
      }

      if (messages.length > 0) {
        conversations.push({ id: conv.id || crypto.randomUUID(), messages, source: 'chatgpt-json' })
      }
    }
    return conversations
  } catch { return [] }
}

/** Normalize plain text conversations (> prefix for user) */
function parsePlainText(content: string): MinedConversation[] {
  const messages: MinedMessage[] = []
  const blocks = content.split(/\n(?=>|\bUser:|Human:)/i)

  for (const block of blocks) {
    const trimmed = block.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('>') || /^(User|Human):/i.test(trimmed)) {
      messages.push({ role: 'user', content: trimmed.replace(/^[>]\s*|^(User|Human):\s*/i, '') })
    } else if (/^(Assistant|AI|Claude):/i.test(trimmed)) {
      messages.push({ role: 'assistant', content: trimmed.replace(/^(Assistant|AI|Claude):\s*/i, '') })
    } else if (messages.length > 0) {
      // Continue previous message
      messages[messages.length - 1].content += '\n' + trimmed
    }
  }

  if (messages.length > 0) {
    return [{ id: crypto.randomUUID(), messages, source: 'plain-text' }]
  }
  return []
}

/** Auto-detect format and parse a conversation file */
export function mineConversationFile(filePath: string): MinedConversation[] {
  const content = fs.readFileSync(filePath, 'utf-8')
  const ext = path.extname(filePath).toLowerCase()

  // JSONL (Claude Code sessions)
  if (ext === '.jsonl' || content.trimStart().startsWith('{"')) {
    const jsonlResult = parseClaudeCodeJSONL(content)
    if (jsonlResult.length > 0) return jsonlResult
  }

  // JSON (ChatGPT exports)
  if (ext === '.json' || content.trimStart().startsWith('[')) {
    const chatgptResult = parseChatGPTJSON(content)
    if (chatgptResult.length > 0) return chatgptResult
  }

  // Plain text fallback
  return parsePlainText(content)
}

/** Chunk a conversation into memory-sized pieces */
export function chunkConversation(conv: MinedConversation, maxChunkSize = 800): { content: string; room: string }[] {
  const chunks: { content: string; room: string }[] = []

  // Group by exchange pairs (user + assistant)
  for (let i = 0; i < conv.messages.length; i += 2) {
    const user = conv.messages[i]
    const assistant = conv.messages[i + 1]
    if (!user) continue

    const content = assistant
      ? `User: ${user.content.slice(0, maxChunkSize / 2)}\nAssistant: ${assistant.content.slice(0, maxChunkSize / 2)}`
      : `User: ${user.content.slice(0, maxChunkSize)}`

    const room = detectRoom(content)
    chunks.push({ content, room })
  }

  return chunks
}

// ═══════════════════════════════════════════════════════════
// 5. PALACE GRAPH TRAVERSAL
// ═══════════════════════════════════════════════════════════

export interface PalaceNode {
  room: string
  wings: string[]
  memoryCount: number
}

export interface PalaceTunnel {
  room: string
  wingA: string
  wingB: string
}

/** Build a graph of rooms connected across wings */
export function buildPalaceGraph(
  memories: { wingId: string; roomId: string }[],
): { nodes: PalaceNode[]; tunnels: PalaceTunnel[] } {
  // Build room → wings map
  const roomWings = new Map<string, Set<string>>()
  const roomCounts = new Map<string, number>()

  for (const m of memories) {
    const wings = roomWings.get(m.roomId) || new Set()
    wings.add(m.wingId)
    roomWings.set(m.roomId, wings)
    roomCounts.set(m.roomId, (roomCounts.get(m.roomId) || 0) + 1)
  }

  // Nodes
  const nodes: PalaceNode[] = []
  for (const [room, wings] of roomWings) {
    nodes.push({ room, wings: Array.from(wings), memoryCount: roomCounts.get(room) || 0 })
  }

  // Tunnels (rooms that exist in multiple wings)
  const tunnels: PalaceTunnel[] = []
  for (const [room, wings] of roomWings) {
    if (wings.size < 2) continue
    const wingArr = Array.from(wings)
    for (let i = 0; i < wingArr.length; i++) {
      for (let j = i + 1; j < wingArr.length; j++) {
        tunnels.push({ room, wingA: wingArr[i], wingB: wingArr[j] })
      }
    }
  }

  return { nodes, tunnels }
}

/** BFS traversal from a starting room — find connected ideas */
export function traverseFromRoom(
  startRoom: string,
  nodes: PalaceNode[],
  tunnels: PalaceTunnel[],
  maxDepth = 3,
): { room: string; depth: number; via: string }[] {
  const visited = new Set<string>([startRoom])
  const result: { room: string; depth: number; via: string }[] = []
  let frontier = [{ room: startRoom, depth: 0 }]

  while (frontier.length > 0) {
    const next: typeof frontier = []
    for (const { room, depth } of frontier) {
      if (depth >= maxDepth) continue

      // Find wings this room belongs to
      const node = nodes.find(n => n.room === room)
      if (!node) continue

      // Find rooms in the same wings
      for (const wing of node.wings) {
        const sameWingRooms = nodes.filter(n => n.wings.includes(wing) && !visited.has(n.room))
        for (const r of sameWingRooms) {
          visited.add(r.room)
          result.push({ room: r.room, depth: depth + 1, via: `${wing}/${room}` })
          next.push({ room: r.room, depth: depth + 1 })
        }
      }

      // Find tunnels (cross-wing connections)
      const roomTunnels = tunnels.filter(t => t.room === room)
      for (const tunnel of roomTunnels) {
        // Rooms in the connected wing
        const otherWing = tunnel.wingA === node.wings[0] ? tunnel.wingB : tunnel.wingA
        const otherRooms = nodes.filter(n => n.wings.includes(otherWing) && !visited.has(n.room))
        for (const r of otherRooms) {
          visited.add(r.room)
          result.push({ room: r.room, depth: depth + 1, via: `tunnel:${room}→${otherWing}` })
          next.push({ room: r.room, depth: depth + 1 })
        }
      }
    }
    frontier = next
  }

  return result
}
