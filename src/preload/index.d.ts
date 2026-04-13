import { ElectronAPI } from '@electron-toolkit/preload'
import type { FileNode, FileStat, FsWatchEvent, IpcResult, LiteConfig, AIChatMessage, AIChatResponse, AIToolEvent, AIToolDefinition, ChangelogEntry, Skill } from '../shared/types'

export interface LiteAPI {
  getHome: () => Promise<IpcResult<string>>
}

export interface ProjectAPI {
  open: () => Promise<IpcResult<string>>
  get: () => Promise<IpcResult<string>>
}

export interface FileSystemAPI {
  readDir: (path: string) => Promise<IpcResult<FileNode[]>>
  readFile: (path: string) => Promise<IpcResult<string>>
  writeFile: (path: string, content: string) => Promise<IpcResult<void>>
  createFile: (path: string) => Promise<IpcResult<void>>
  createDir: (path: string) => Promise<IpcResult<void>>
  rename: (oldPath: string, newPath: string) => Promise<IpcResult<void>>
  delete: (path: string) => Promise<IpcResult<void>>
  stat: (path: string) => Promise<IpcResult<FileStat>>
  onWatchEvent: (callback: (event: FsWatchEvent) => void) => () => void
}

export interface StateAPI {
  get: () => Promise<IpcResult<LiteConfig>>
  update: (patch: Partial<LiteConfig>) => Promise<IpcResult<void>>
}

export interface TerminalAPI {
  create: (cwd?: string) => Promise<IpcResult<string>>
  write: (id: string, data: string) => Promise<void>
  resize: (id: string, cols: number, rows: number) => Promise<void>
  close: (id: string) => Promise<void>
  getCwd: (id: string) => Promise<IpcResult<string | null>>
  saveBuffer: (sessionKey: string, buffer: string) => Promise<IpcResult<void>>
  loadBuffer: (sessionKey: string) => Promise<IpcResult<string>>
  onData: (callback: (id: string, data: string) => void) => () => void
  onExit: (callback: (id: string, exitCode: number) => void) => () => void
}

export interface ImageAPI {
  save: (data: ArrayBuffer, mimeType: string) => Promise<IpcResult<string>>
  saveFromUrl: (imageUrl: string) => Promise<IpcResult<string>>
  saveFromPath: (localPath: string) => Promise<IpcResult<string>>
  delete: (filename: string) => Promise<IpcResult<void>>
}

export interface VideoAPI {
  save: (data: ArrayBuffer, mimeType: string) => Promise<IpcResult<string>>
  saveFromPath: (localPath: string) => Promise<IpcResult<string>>
  delete: (filename: string) => Promise<IpcResult<void>>
}

export interface DialogAPI {
  selectImages: () => Promise<IpcResult<string[]>>
  selectVideos: () => Promise<IpcResult<string[]>>
  selectFolder: () => Promise<IpcResult<string>>
  selectFile: (filters?: Array<{ name: string; extensions: string[] }>) => Promise<IpcResult<string>>
}

export interface UrlMeta {
  title: string
  description: string
  image: string
}

export interface UrlAPI {
  fetchMeta: (url: string) => Promise<IpcResult<UrlMeta>>
}

export interface SearchMatch {
  filePath: string
  fileName: string
  line: number
  content: string
}

export interface SearchAPI {
  content: (query: string, dirs: string[], maxResults?: number) => Promise<IpcResult<SearchMatch[]>>
}

export interface ShortcutAPI {
  onShortcut: (callback: (shortcut: string) => void) => () => void
  fileSwitcherState: (open: boolean) => void
}

export interface ShellAPI {
  openExternal: (url: string) => Promise<IpcResult<void>>
  openPath: (filePath: string) => Promise<IpcResult<void>>
  revealPath: (filePath: string) => Promise<IpcResult<void>>
}

// Collector API is not fully typed — existing code uses many call shapes.
// Use `any` here so we don't regress pre-existing usage while the shared
// types catch up. WikiApp imports `Record<string, unknown>` helpers above it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CollectorAPI = any

export interface ChangelogAPI {
  append: (entry: ChangelogEntry) => Promise<IpcResult<void>>
  read: (filePath: string) => Promise<IpcResult<ChangelogEntry[]>>
}

export interface MCPAPI {
  listTools: () => Promise<IpcResult<AIToolDefinition[]>>
  refresh: () => Promise<IpcResult<unknown>>
}

export interface SkillsAPI {
  list: () => Promise<IpcResult<Skill[]>>
  toggle: (name: string, enabled: boolean) => Promise<IpcResult<void>>
  create: (name: string, description: string, content: string) => Promise<IpcResult<void>>
  delete: (name: string) => Promise<IpcResult<void>>
  importUrl: (url: string) => Promise<IpcResult<Skill>>
}

export interface ScheduledTask {
  id: string
  name: string
  type: string
  appId: string | null
  enabled: boolean
  schedule: string
  config: Record<string, unknown>
  lastRunAt: number | null
  lastRunStatus: string | null
  lastRunError: string | null
  runCount: number
  createdAt: number
  updatedAt: number
}

export interface TaskRunEvent {
  taskId: string
  taskName: string
  status: string
  timestamp: number
  message?: string
}

export interface TaskAPI {
  list: (appId?: string) => Promise<IpcResult<ScheduledTask[]>>
  create: (input: Record<string, unknown>) => Promise<IpcResult<ScheduledTask>>
  update: (id: string, patch: Record<string, unknown>) => Promise<IpcResult<ScheduledTask>>
  delete: (id: string) => Promise<IpcResult<void>>
  trigger: (id: string) => Promise<IpcResult<{ success: boolean; error?: string }>>
  onRunEvent: (callback: (event: TaskRunEvent) => void) => () => void
}

export interface WikiAPI {
  init: () => Promise<IpcResult<{ created: boolean; root: string }>>
  stats: () => Promise<IpcResult<{
    root: string
    total: number
    byType: Record<string, number>
    hasIndex: boolean
    hasPurpose: boolean
    lastLogEntry: string | null
  }>>
  listPages: () => Promise<IpcResult<Array<{ path: string; relPath: string; type: string; title: string }>>>
  read: (relPath: string) => Promise<IpcResult<string | null>>
  write: (relPath: string, content: string) => Promise<IpcResult<void>>
  appendLog: (entry: string) => Promise<IpcResult<void>>
  delete: (relPath: string) => Promise<IpcResult<void>>
  graph: () => Promise<IpcResult<{
    nodes: Array<{ id: string; relPath: string; title: string; type: string; resourceType?: string }>
    edges: Array<{ source: string; target: string; type: string }>
  }>>
}

export interface EventsAPI {
  onAppEvent: (callback: (event: { type: string; [k: string]: unknown }) => void) => () => void
}

export interface AIAPI {
  chat: (
    providerId: string,
    messages: AIChatMessage[],
    temperature?: number,
    maxTokens?: number,
    enableTools?: boolean,
    modelOverride?: string,
  ) => Promise<IpcResult<AIChatResponse>>
  testConnection: (provider: Record<string, unknown>) => Promise<IpcResult<string>>
  onToolEvent: (callback: (event: AIToolEvent) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      lite: LiteAPI
      project: ProjectAPI
      state: StateAPI
      fs: FileSystemAPI
      image: ImageAPI
      video: VideoAPI
      dialog: DialogAPI
      url: UrlAPI
      terminal: TerminalAPI
      search: SearchAPI
      shortcut: ShortcutAPI
      changelog: ChangelogAPI
      mcp: MCPAPI
      skills: SkillsAPI
      ai: AIAPI
      task: TaskAPI
      wiki: WikiAPI
      events: EventsAPI
      shell: ShellAPI
      collector: CollectorAPI
    }
  }
}
