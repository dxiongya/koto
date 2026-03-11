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
}
