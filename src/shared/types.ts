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
  TERMINAL_DATA: 'terminal:data',
  TERMINAL_EXIT: 'terminal:exit',

  // Image Storage
  IMAGE_SAVE: 'image:save',
  IMAGE_SAVE_FROM_URL: 'image:saveFromUrl',
  IMAGE_SAVE_FROM_PATH: 'image:saveFromPath',
  IMAGE_DELETE: 'image:delete',

  // Dialog
  DIALOG_SELECT_IMAGES: 'dialog:selectImages',

  // URL Metadata
  URL_FETCH_META: 'url:fetchMeta',

  // Search
  SEARCH_CONTENT: 'search:content',

  // AI
  AI_CHAT: 'ai:chat',
  AI_TEST_CONNECTION: 'ai:testConnection',

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

export type AppType = 'notes.app' | 'code.app' | 'browser.app' | 'terminal.app' | 'collector.app' | 'settings.app'

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
  model: string
  enabled: boolean
}

export type AIFeature = 'completion' | 'chat'

export interface AIFeatureRouting {
  completion: string | null  // provider ID, null = use active
  chat: string | null
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
  featureRouting: { completion: null, chat: null },
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

// ── Lite Config (Persistence) ──

export interface TerminalSessionInfo {
  title: string
  cwd?: string
}

export interface RecentFileEntry {
  path: string
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
  // AI
  ai: AISettings
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
  },
  notesExpandedGroups: [],
  notesSortBy: 'modified',
  codeProjectPath: null,
  recentProjects: [],
  terminalSessions: [],
  recentFiles: [],
  ai: { ...DEFAULT_AI_SETTINGS },
}
