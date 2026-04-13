// ── File System Types ──

export interface FileNode {
  name: string
  path: string
  isDirectory: boolean
  children?: FileNode[]
}

// ── IPC Result Wrapper ──

export type IpcResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string }

// ── IPC Channel Names ──

export const IpcChannels = {
  // Lite Home
  LITE_GET_HOME: 'lite:getHome',

  // Project (code.app)
  PROJECT_OPEN: 'project:open',
  PROJECT_GET: 'project:get',

  // State Persistence
  STATE_GET: 'state:get',
  STATE_UPDATE: 'state:update',

  // File System
  FS_READ_DIR: 'fs:readDir',
  FS_READ_FILE: 'fs:readFile',
  FS_WRITE_FILE: 'fs:writeFile',
  FS_CREATE_FILE: 'fs:createFile',
  FS_CREATE_DIR: 'fs:createDir',
  FS_RENAME: 'fs:rename',
  FS_DELETE: 'fs:delete',
  FS_STAT: 'fs:stat',

  // File Watcher (main → renderer push)
  FS_WATCH_EVENT: 'fs:watchEvent',

  // Terminal
  TERMINAL_CREATE: 'terminal:create',
  TERMINAL_WRITE: 'terminal:write',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_CLOSE: 'terminal:close',
  TERMINAL_GET_CWD: 'terminal:getCwd',
  TERMINAL_SAVE_BUFFER: 'terminal:saveBuffer',
  TERMINAL_LOAD_BUFFER: 'terminal:loadBuffer',
  TERMINAL_GET_REPLAY_BUFFER: 'terminal:getReplayBuffer',
  // Bus-to-main bridge
  BUS_LIST_TOOLS: 'bus:listTools',
  BUS_CALL_TOOL: 'bus:callTool',
  BUS_TOOLS_READY: 'bus:toolsReady',
  // Memory.app
  MEMORY_STORE: 'memory:store',
  MEMORY_SEARCH: 'memory:search',
  MEMORY_LIST: 'memory:list',
  MEMORY_DELETE: 'memory:delete',
  MEMORY_STATUS: 'memory:status',
  MEMORY_TAXONOMY: 'memory:taxonomy',
  MEMORY_GET_CONTEXT: 'memory:getContext',
  MEMORY_SET_IDENTITY: 'memory:setIdentity',
  MEMORY_KG_ADD: 'memory:kgAdd',
  MEMORY_KG_INVALIDATE: 'memory:kgInvalidate',
  MEMORY_KG_QUERY: 'memory:kgQuery',
  MEMORY_KG_STATS: 'memory:kgStats',
  COLLECTOR_DEDUP: 'collector:dedup',
  COLLECTOR_SYNC_GET_CONFIG: 'collector:syncGetConfig',
  COLLECTOR_SYNC_SET_CONFIG: 'collector:syncSetConfig',
  COLLECTOR_SYNC_DELETE_CONFIG: 'collector:syncDeleteConfig',
  COLLECTOR_SYNC_LIST_CONFIGS: 'collector:syncListConfigs',
  COLLECTOR_SYNC_RUN_NOW: 'collector:syncRunNow',
  COLLECTOR_SYNC_GET_SCRIPT: 'collector:syncGetScript',
  COLLECTOR_SYNC_SET_SCRIPT: 'collector:syncSetScript',
  COLLECTOR_SYNC_LIST_ADAPTERS: 'collector:syncListAdapters',
  COLLECTOR_SYNC_RUN_EVENT: 'collector:syncRunEvent',
  MEMORY_MINE_FILE: 'memory:mineFile',
  MEMORY_GRAPH_TRAVERSE: 'memory:graphTraverse',

  MCP_SERVER_START: 'mcpServer:start',
  MCP_SERVER_STOP: 'mcpServer:stop',
  MCP_SERVER_STATUS: 'mcpServer:status',
  TERMINAL_SAVE_ALL_SYNC: 'terminal:saveAllSync',
  TERMINAL_DATA: 'terminal:data',
  TERMINAL_EXIT: 'terminal:exit',

  // Image Storage
  IMAGE_SAVE: 'image:save',
  IMAGE_SAVE_FROM_URL: 'image:saveFromUrl',
  IMAGE_SAVE_FROM_PATH: 'image:saveFromPath',
  IMAGE_DELETE: 'image:delete',

  // Video Storage
  VIDEO_SAVE: 'video:save',
  VIDEO_SAVE_FROM_PATH: 'video:saveFromPath',
  VIDEO_DELETE: 'video:delete',

  // Dialog
  DIALOG_SELECT_IMAGES: 'dialog:selectImages',
  DIALOG_SELECT_VIDEOS: 'dialog:selectVideos',
  DIALOG_SELECT_FOLDER: 'dialog:selectFolder',
  DIALOG_SELECT_FILE: 'dialog:selectFile',

  // URL Metadata
  URL_FETCH_META: 'url:fetchMeta',

  // Search
  SEARCH_CONTENT: 'search:content',

  // AI
  AI_CHAT: 'ai:chat',
  AI_TEST_CONNECTION: 'ai:testConnection',

  // AI Changelog
  CHANGELOG_APPEND: 'changelog:append',
  CHANGELOG_READ: 'changelog:read',

  // AI Tool Events (main → renderer push)
  AI_CHAT_TOOL_EVENT: 'ai:chatToolEvent',

  // MCP
  MCP_LIST_TOOLS: 'mcp:listTools',
  MCP_REFRESH: 'mcp:refresh',

  // Skills
  SKILLS_LIST: 'skills:list',
  SKILLS_TOGGLE: 'skills:toggle',
  SKILLS_CREATE: 'skills:create',
  SKILLS_DELETE: 'skills:delete',
  SKILLS_IMPORT_URL: 'skills:importUrl',

  // Automation
  AUTOMATION_LIST: 'automation:list',
  AUTOMATION_CREATE: 'automation:create',
  AUTOMATION_UPDATE: 'automation:update',
  AUTOMATION_DELETE: 'automation:delete',
  AUTOMATION_RUN_NOW: 'automation:runNow',
  AUTOMATION_GET_SNAPSHOTS: 'automation:getSnapshots',
  AUTOMATION_RESTORE_SNAPSHOT: 'automation:restoreSnapshot',
  AUTOMATION_RUN_EVENT: 'automation:runEvent',
  AUTOMATION_GET_EXPERIENCE: 'automation:getExperience',

  // Collector
  COLLECTOR_LIST: 'collector:list',
  COLLECTOR_COUNT: 'collector:count',
  COLLECTOR_CHECK_DUPLICATE: 'collector:checkDuplicate',
  COLLECTOR_CHECK_DUPLICATE_HASH: 'collector:checkDuplicateHash',
  COLLECTOR_ADD: 'collector:add',
  COLLECTOR_UPDATE: 'collector:update',
  COLLECTOR_DELETE: 'collector:delete',
  EMBEDDING_GET_API_KEY: 'embedding:getApiKey',
  EMBEDDING_SET_API_KEY: 'embedding:setApiKey',
  EMBEDDING_TEST: 'embedding:test',
  COLLECTOR_SEARCH: 'collector:search',
  COLLECTOR_FETCH_MARKDOWN: 'collector:fetchMarkdown',
  COLLECTOR_GET_MARKDOWN: 'collector:getMarkdown',
  COLLECTOR_EMBED_ITEM: 'collector:embedItem',
  COLLECTOR_EMBED_ALL: 'collector:embedAll',
  COLLECTOR_GROUPS: 'collector:groups',
  COLLECTOR_ADD_GROUP: 'collector:addGroup',
  COLLECTOR_RENAME_GROUP: 'collector:renameGroup',
  COLLECTOR_DELETE_GROUP: 'collector:deleteGroup',

  // Apps
  APPS_DISCOVER: 'apps:discover',

  // Shell
  SHELL_OPEN_EXTERNAL: 'shell:openExternal',
  SHELL_OPEN_PATH: 'shell:openPath',
  SHELL_REVEAL_PATH: 'shell:revealPath',

  // App events (main → renderer push) — cross-app notifications
  APP_EVENT: 'app:event',

  // Wiki.app
  WIKI_INIT: 'wiki:init',
  WIKI_STATS: 'wiki:stats',
  WIKI_LIST_PAGES: 'wiki:listPages',
  WIKI_READ: 'wiki:read',
  WIKI_WRITE: 'wiki:write',
  WIKI_APPEND_LOG: 'wiki:appendLog',
  WIKI_DELETE: 'wiki:delete',
  WIKI_GRAPH: 'wiki:graph',
  WIKI_RESET: 'wiki:reset',
  WIKI_SEARCH: 'wiki:search',
  WIKI_LINT: 'wiki:lint',
  WIKI_REINDEX: 'wiki:reindex',

  // Data management
  COLLECTOR_RESET: 'collector:reset',

  // Task Scheduler
  TASK_LIST: 'task:list',
  TASK_CREATE: 'task:create',
  TASK_UPDATE: 'task:update',
  TASK_DELETE: 'task:delete',
  TASK_TRIGGER: 'task:trigger',
  TASK_RUN_EVENT: 'task:runEvent',

  // Shortcuts forwarded from main process
  SHORTCUT: 'shortcut',
} as const

// ── File Stat ──

export interface FileStat {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
  size: number
  modifiedAt: number
  createdAt: number
}

// ── File Watcher Event ──

export interface FsWatchEvent {
  type: 'create' | 'update' | 'delete'
  path: string
}

// ── App Types ──

export type AppType = 'notes.app' | 'code.app' | 'browser.app' | 'terminal.app' | 'collector.app' | 'settings.app' | 'memory.app' | 'wiki.app'

// ── Per-App State ──

export interface PerAppState {
  activeFilePath: string | null
  expandedPaths: string[]
}

// ── AI Provider Types ──

export type AIProviderType = 'openai' | 'anthropic' | 'google' | 'openai-compatible'

export interface AIProviderConfig {
  id: string
  name: string
  type: AIProviderType
  apiKey: string
  baseUrl: string
  /** @deprecated — use `models[0]`. Kept for backward compat with old configs. */
  model: string
  /** List of models this provider can use. First entry is the default. */
  models: string[]
  enabled: boolean
}

/** Resolve the active model for a provider — uses models[0] with fallback to the legacy `model` field. */
export function getProviderModel(provider: AIProviderConfig, override?: string): string {
  if (override) return override
  if (provider.models?.length) return provider.models[0]
  return provider.model
}

export type AIFeature = 'completion' | 'chat' | 'wiki'

/** A specific (provider, model) pair that a feature is routed to. */
export interface AIFeatureRoute {
  providerId: string
  /** Specific model override; if omitted, uses the provider's first model. */
  model?: string
}

export interface AIFeatureRouting {
  completion: AIFeatureRoute | null
  chat: AIFeatureRoute | null
  /** Used by wiki.app for ingest / lint / graph analysis — tends to burn
   *  tokens, so route this to a cheap model (GLM, DeepSeek, local Ollama). */
  wiki: AIFeatureRoute | null
}

/**
 * Normalize a stored routing value — older configs may still have a plain
 * string (just a providerId). Convert to the new object form.
 */
export function normalizeFeatureRoute(value: unknown): AIFeatureRoute | null {
  if (!value) return null
  if (typeof value === 'string') return { providerId: value }
  if (typeof value === 'object' && value !== null && 'providerId' in value) {
    const v = value as AIFeatureRoute
    return { providerId: v.providerId, model: v.model }
  }
  return null
}

export interface AIUsageRecord {
  requests: number
  promptTokens: number
  completionTokens: number
  errors: number
}

export interface AIUsageStats {
  total: AIUsageRecord
  byProvider: Record<string, AIUsageRecord>
  byFeature: Record<string, AIUsageRecord>
  lastRequestAt: number | null
  /** Daily breakdown — key is YYYY-MM-DD */
  daily: Record<string, AIUsageRecord>
}

export const DEFAULT_AI_USAGE_STATS: AIUsageStats = {
  total: { requests: 0, promptTokens: 0, completionTokens: 0, errors: 0 },
  byProvider: {},
  byFeature: {},
  lastRequestAt: null,
  daily: {},
}

export interface AISettings {
  providers: AIProviderConfig[]
  activeProviderId: string | null
  featureRouting: AIFeatureRouting
  usage: AIUsageStats
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  providers: [],
  activeProviderId: null,
  featureRouting: { completion: null, chat: null, wiki: null },
  usage: { ...DEFAULT_AI_USAGE_STATS },
}

/** Known base URLs per provider type */
export const AI_PROVIDER_BASE_URLS: Record<AIProviderType, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  'openai-compatible': '',
}

/** Suggested models per provider type */
export const AI_PROVIDER_MODELS: Record<AIProviderType, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'o3-mini'],
  anthropic: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-4-5-20251001'],
  google: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
  'openai-compatible': [],
}

// ── AI Chat Types ──

export interface AIChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AIChatRequest {
  providerId: string
  messages: AIChatMessage[]
  temperature?: number
  maxTokens?: number
}

export interface AIChatResponse {
  content: string
  model: string
  usage?: { promptTokens: number; completionTokens: number }
}

// ── AI Tool Types ──

export interface AIToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>  // JSON Schema
}

export interface AIToolEvent {
  type: 'tool_start' | 'tool_result'
  toolName: string
  toolInput?: Record<string, unknown>
  result?: string
  durationMs?: number
}

// ── AI Changelog Entry ──

export interface ChangelogEntry {
  timestamp: number
  filePath: string
  prompt: string
  originalText: string
  generatedText: string
  action: 'accepted' | 'rejected'
  model: string
  providerId: string
}

// ── MCP Server Types ──

export interface MCPServerConfig {
  id: string
  name: string
  description: string    // User hint for AI: what this server does
  command: string        // e.g. "npx", "node", "python" (stdio transport)
  args: string[]         // e.g. ["-y", "@mcp/server-github"]
  env: Record<string, string>
  url: string            // e.g. "https://mcp.example.com/sse" (SSE/HTTP transport)
  headers: Record<string, string>  // HTTP headers for URL-based transport
  enabled: boolean
  timeout: number        // ms, default 30000
}

// ── Skill Types ──

export interface Skill {
  name: string
  description: string
  content: string
  enabled: boolean
  filePath: string
}

// ── Automation Types ──

export type AutomationTargetType = 'file' | 'section' | 'table'

export interface AutomationTarget {
  type: AutomationTargetType
  filePath: string
  sectionHeading?: string
  tableIdentifier?: string
}

export type AutomationInterval = 5 | 15 | 30 | 60 | 360 | 720 | 1440

export interface Automation {
  id: string
  name: string
  target: AutomationTarget
  promptTemplate: string
  interval: AutomationInterval
  providerId: string
  enableTools: boolean
  enabled: boolean
  createdAt: number
  lastRunAt: number | null
  lastRunStatus: 'success' | 'error' | null
  lastRunError: string | null
  runCount: number
}

export interface AutomationSnapshot {
  automationId: string
  timestamp: number
  filePath: string
  targetType: AutomationTargetType
  contentBefore: string
  contentAfter: string
  prompt: string
  aiResponse: string
  model: string
  status: 'success' | 'error'
  error?: string
}

export interface AutomationRunEvent {
  automationId: string
  status: 'started' | 'snapshot_taken' | 'ai_running' | 'writing' | 'completed' | 'error'
  timestamp: number
  message?: string
}

// ── Lite Config (Persistence) ──

export interface TerminalSessionInfo {
  title: string
  cwd?: string
}

/**
 * Unified MRU entry — used for both files and terminals.
 * The discriminator is whether `terminalId` or `path` is present.
 * For files: { path, app, openedAt }
 * For terminals: { terminalId, title, app: 'terminal.app', openedAt }
 */
export interface RecentFileEntry {
  path?: string
  terminalId?: string
  title?: string           // display title (mainly for terminals)
  app: AppType
  openedAt: number
}

export interface LiteConfig {
  lastApp: AppType
  lastTheme: string
  fontFamily: string
  windowBounds: { x: number; y: number; width: number; height: number } | null
  sidebarOpen: boolean
  appStates: Record<AppType, PerAppState>
  // notes.app
  notesExpandedGroups: string[]
  notesSortBy: 'modified' | 'name' | 'created'
  // code.app
  codeProjectPath: string | null
  recentProjects: string[]
  // terminal.app
  terminalSessions: TerminalSessionInfo[]
  // recent files
  recentFiles: RecentFileEntry[]
  // Embedding (Gemini)
  embeddingGeminiApiKey: string
  // AI
  ai: AISettings
  // MCP Servers
  mcpServers: MCPServerConfig[]
  // App enable/disable (written by welcome onboarding + Settings → Apps)
  enabledApps?: string[]
  appOrder?: string[]
  disabledBusTools?: string[]
  // First-run welcome dialog shown
  hasSeenWelcome: boolean
  // Wiki.app auto-ingest preference
  wikiAutoIngest?: boolean
}

// ── Default Per-App State ──

export const DEFAULT_PER_APP_STATE: PerAppState = {
  activeFilePath: null,
  expandedPaths: [],
}

export const DEFAULT_LITE_CONFIG: LiteConfig = {
  lastApp: 'notes.app',
  lastTheme: 'dark',
  fontFamily: 'sf-mono',
  windowBounds: null,
  sidebarOpen: true,
  appStates: {
    'notes.app': { ...DEFAULT_PER_APP_STATE },
    'code.app': { ...DEFAULT_PER_APP_STATE },
    'browser.app': { ...DEFAULT_PER_APP_STATE },
    'terminal.app': { ...DEFAULT_PER_APP_STATE },
    'collector.app': { ...DEFAULT_PER_APP_STATE },
    'settings.app': { ...DEFAULT_PER_APP_STATE },
    'memory.app': { ...DEFAULT_PER_APP_STATE },
    'wiki.app': { ...DEFAULT_PER_APP_STATE },
  },
  notesExpandedGroups: [],
  notesSortBy: 'modified',
  codeProjectPath: null,
  recentProjects: [],
  terminalSessions: [],
  recentFiles: [],
  embeddingGeminiApiKey: '',
  ai: { ...DEFAULT_AI_SETTINGS },
  mcpServers: [],
  hasSeenWelcome: false,
}

// ── Collector Types ──

export type CollectedItemType = 'link' | 'image' | 'video' | 'tweet' | 'text' | 'screenshot'

export interface CollectedItem {
  id: string
  type: CollectedItemType
  title: string
  note: string
  url?: string
  assetPath?: string
  thumbnailPath?: string
  group: string           // 'all' or custom group name
  source: string          // e.g. 'paste', 'drag', 'command-palette', 'context-menu'
  meta: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface CollectorAddInput {
  type: CollectedItemType
  title: string
  note?: string
  url?: string
  assetData?: ArrayBuffer  // raw image/file data
  assetMimeType?: string
  group?: string
  source?: string
  meta?: Record<string, unknown>
}
