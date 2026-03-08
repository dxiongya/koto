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
  // Workspace
  WORKSPACE_OPEN: 'workspace:open',
  WORKSPACE_GET: 'workspace:get',

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

export type AppType = 'notes.app' | 'code.app' | 'browser.app' | 'terminal.app' | 'collector.app'

// ── Workspace State (Persistence) ──

export interface WorkspaceState {
  recentWorkspaces: string[]
  lastWorkspacePath: string | null
  lastApp: AppType
  lastActiveFilePath: string | null
  windowBounds: { x: number; y: number; width: number; height: number } | null
  sidebarExpandedPaths: string[]
}
