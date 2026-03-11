import { ElectronAPI } from '@electron-toolkit/preload'
import type { FileNode, FileStat, FsWatchEvent, IpcResult, LiteConfig } from '../shared/types'

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

export interface DialogAPI {
  selectImages: () => Promise<IpcResult<string[]>>
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

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      lite: LiteAPI
      project: ProjectAPI
      state: StateAPI
      fs: FileSystemAPI
      image: ImageAPI
      dialog: DialogAPI
      url: UrlAPI
      terminal: TerminalAPI
      search: SearchAPI
      shortcut: ShortcutAPI
    }
  }
}
