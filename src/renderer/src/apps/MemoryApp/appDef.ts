import type { AppDefinition } from '../../../../shared/app-interface'
import { MemoryApp } from './index'

export const memoryAppDefinition: AppDefinition = {
  manifest: {
    id: 'memory.app',
    name: 'Memory',
    icon: 'brain',
    version: '1.0.0',
    description: 'AI memory — persistent knowledge store with temporal knowledge graph',
    permissions: ['fs', 'state', 'ai'],
    builtin: true,
  },
  component: MemoryApp,
  sidebar: { expandable: true },
  onRegister: (api) => {
    // ── Read Tools ──

    api.bus.provideTool({
      name: 'memory.status',
      appId: 'memory.app',
      description: 'Get memory system overview: total memories, wings, rooms, knowledge graph stats.',
      parameters: {},
      handler: async () => {
        const res = await window.api.memory.status()
        return res.ok ? res.data : { error: res.error }
      },
    })

    api.bus.provideTool({
      name: 'memory.search',
      appId: 'memory.app',
      description: 'Search memories by keyword. Returns matching memories with relevance scores. Can filter by wing (project/domain) and room (topic).',
      parameters: {
        query: { type: 'string', description: 'Search query', required: true },
        wing: { type: 'string', description: 'Filter by wing (project/domain)' },
        room: { type: 'string', description: 'Filter by room (topic)' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      handler: async (params) => {
        const res = await window.api.memory.search(
          params.query as string, params.wing as string, params.room as string, params.limit as number,
        )
        return res.ok ? res.data : []
      },
    })

    api.bus.provideTool({
      name: 'memory.getTaxonomy',
      appId: 'memory.app',
      description: 'Get the full wing → room → memory count tree. Shows how memories are organized.',
      parameters: {},
      handler: async () => {
        const res = await window.api.memory.taxonomy()
        return res.ok ? res.data : { error: res.error }
      },
    })

    api.bus.provideTool({
      name: 'memory.getContext',
      appId: 'memory.app',
      description: 'Load the 4-layer memory context: Layer 0 (identity) + Layer 1 (essential facts) + Layer 2 (topic-specific memories). Call this on wake-up to remember who you are and what matters.',
      parameters: {
        wing: { type: 'string', description: 'Wing to load on-demand memories from' },
        room: { type: 'string', description: 'Room to load on-demand memories from' },
      },
      handler: async (params) => {
        const res = await window.api.memory.getContext(params.wing as string, params.room as string)
        return res.ok ? res.data : { error: res.error }
      },
    })

    api.bus.provideTool({
      name: 'memory.kgQuery',
      appId: 'memory.app',
      description: 'Query the knowledge graph for an entity\'s relationships. Can filter by date to see what was true at a specific time.',
      parameters: {
        entity: { type: 'string', description: 'Entity name to query', required: true },
        asOf: { type: 'string', description: 'ISO date — show facts valid at this date' },
        direction: { type: 'string', description: 'outgoing, incoming, or both (default: both)' },
      },
      handler: async (params) => {
        const res = await window.api.memory.kgQuery(params.entity as string, {
          asOf: params.asOf, direction: params.direction,
        })
        return res.ok ? res.data : { error: res.error }
      },
    })

    // ── Write Tools ──

    api.bus.provideTool({
      name: 'memory.store',
      appId: 'memory.app',
      description: 'Store a memory. Set wing/room to "auto" for automatic detection from content keywords. Use hall to classify: facts, events, decisions, preferences, advice. Set importance 1-5 (5=critical). Set compress:true for AAAK compression (30x reduction, still LLM-readable).',
      parameters: {
        wing: { type: 'string', description: 'Wing (project/domain name, or "auto" for keyword detection)', required: true },
        room: { type: 'string', description: 'Room (topic name, or "auto" for keyword detection)', required: true },
        content: { type: 'string', description: 'Memory content (verbatim or AAAK compressed)', required: true },
        hall: { type: 'string', description: 'Memory type: general, facts, events, decisions, preferences, advice' },
        importance: { type: 'number', description: 'Importance 1-5 (default 3)' },
        summary: { type: 'string', description: 'Short summary for quick recall' },
      },
      handler: async (params) => {
        const res = await window.api.memory.store(
          params.wing as string, params.room as string, params.content as string,
          { hall: params.hall as string, importance: params.importance as number, summary: params.summary as string },
        )
        return res.ok ? { id: res.data.id, success: true } : { error: res.error }
      },
    })

    api.bus.provideTool({
      name: 'memory.kgAdd',
      appId: 'memory.app',
      description: 'Add a fact to the knowledge graph as a triple: subject → predicate → object. Examples: "Alice" → "works_on" → "Project X", "Team" → "uses" → "Clerk".',
      parameters: {
        subject: { type: 'string', description: 'Subject entity', required: true },
        predicate: { type: 'string', description: 'Relationship type (e.g. works_on, uses, child_of)', required: true },
        object: { type: 'string', description: 'Object entity', required: true },
        validFrom: { type: 'string', description: 'ISO date when fact became true' },
      },
      handler: async (params) => {
        const res = await window.api.memory.kgAdd(
          params.subject as string, params.predicate as string, params.object as string,
          { validFrom: params.validFrom as string },
        )
        return res.ok ? { id: res.data.id, success: true } : { error: res.error }
      },
    })

    api.bus.provideTool({
      name: 'memory.kgInvalidate',
      appId: 'memory.app',
      description: 'Mark a knowledge graph fact as no longer true. The fact is kept with an end date for historical queries.',
      parameters: {
        subject: { type: 'string', description: 'Subject entity', required: true },
        predicate: { type: 'string', description: 'Relationship type', required: true },
        object: { type: 'string', description: 'Object entity', required: true },
        ended: { type: 'string', description: 'ISO date when fact ended (default: today)' },
      },
      handler: async (params) => {
        const res = await window.api.memory.kgInvalidate(
          params.subject as string, params.predicate as string, params.object as string, params.ended as string,
        )
        return res.ok ? { success: res.data } : { error: res.error }
      },
    })

    api.bus.provideTool({
      name: 'memory.setIdentity',
      appId: 'memory.app',
      description: 'Set the Layer 0 identity text — a short description of who the AI is, loaded on every wake-up.',
      parameters: {
        content: { type: 'string', description: 'Identity text (keep under 200 tokens)', required: true },
      },
      handler: async (params) => {
        const res = await window.api.memory.setIdentity(params.content as string)
        return res.ok ? { success: true } : { error: res.error }
      },
    })

    api.bus.provideTool({
      name: 'memory.delete',
      appId: 'memory.app',
      description: 'Delete a memory by ID.',
      parameters: {
        id: { type: 'string', description: 'Memory ID', required: true },
      },
      handler: async (params) => {
        const res = await window.api.memory.delete(params.id as string)
        return res.ok ? { success: res.data } : { error: res.error }
      },
    })

    // ── Intelligence Tools ──

    api.bus.provideTool({
      name: 'memory.mineConversation',
      appId: 'memory.app',
      description: 'Import a conversation file (Claude Code JSONL, ChatGPT JSON, or plain text) into memory. Auto-detects format, chunks by exchange pairs, and assigns rooms by keyword detection.',
      parameters: {
        filePath: { type: 'string', description: 'Path to the conversation file', required: true },
        wing: { type: 'string', description: 'Wing to store under (auto-detected if omitted)' },
      },
      handler: async (params) => {
        const res = await window.api.memory.mineFile(params.filePath as string, params.wing as string)
        return res.ok ? res.data : { error: res.error }
      },
    })

    api.bus.provideTool({
      name: 'memory.traverse',
      appId: 'memory.app',
      description: 'Explore the palace graph — find rooms connected to a starting room across wings. Discovers hidden connections between topics and projects.',
      parameters: {
        startRoom: { type: 'string', description: 'Room to start traversal from', required: true },
        maxDepth: { type: 'number', description: 'Max BFS depth (default 3)' },
      },
      handler: async (params) => {
        const res = await window.api.memory.graphTraverse(params.startRoom as string, params.maxDepth as number)
        return res.ok ? res.data : { error: res.error }
      },
    })
  },
}
