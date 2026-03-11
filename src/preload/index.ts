import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IpcChannels } from '../shared/types'

const api = {
  lite: {
    getHome: () => ipcRenderer.invoke(IpcChannels.LITE_GET_HOME),
  },
  project: {
    open: () => ipcRenderer.invoke(IpcChannels.PROJECT_OPEN),
    get: () => ipcRenderer.invoke(IpcChannels.PROJECT_GET),
  },
  state: {
    get: () => ipcRenderer.invoke(IpcChannels.STATE_GET),
    update: (patch: Record<string, unknown>) =>
      ipcRenderer.invoke(IpcChannels.STATE_UPDATE, patch),
  },
  fs: {
    readDir: (path: string) => ipcRenderer.invoke(IpcChannels.FS_READ_DIR, path),
    readFile: (path: string) => ipcRenderer.invoke(IpcChannels.FS_READ_FILE, path),
    writeFile: (path: string, content: string) =>
      ipcRenderer.invoke(IpcChannels.FS_WRITE_FILE, path, content),
    createFile: (path: string) => ipcRenderer.invoke(IpcChannels.FS_CREATE_FILE, path),
    createDir: (path: string) => ipcRenderer.invoke(IpcChannels.FS_CREATE_DIR, path),
    rename: (oldPath: string, newPath: string) =>
      ipcRenderer.invoke(IpcChannels.FS_RENAME, oldPath, newPath),
    delete: (path: string) => ipcRenderer.invoke(IpcChannels.FS_DELETE, path),
    stat: (path: string) => ipcRenderer.invoke(IpcChannels.FS_STAT, path),
    onWatchEvent: (callback: (event: { type: string; path: string }) => void) => {
      const handler = (_: unknown, event: { type: string; path: string }): void => callback(event)
      ipcRenderer.on(IpcChannels.FS_WATCH_EVENT, handler)
      return () => {
        ipcRenderer.removeListener(IpcChannels.FS_WATCH_EVENT, handler)
      }
    },
  },
  image: {
    save: (data: ArrayBuffer, mimeType: string) =>
      ipcRenderer.invoke(IpcChannels.IMAGE_SAVE, data, mimeType),
    saveFromUrl: (imageUrl: string) =>
      ipcRenderer.invoke(IpcChannels.IMAGE_SAVE_FROM_URL, imageUrl),
    saveFromPath: (localPath: string) =>
      ipcRenderer.invoke(IpcChannels.IMAGE_SAVE_FROM_PATH, localPath),
    delete: (filename: string) =>
      ipcRenderer.invoke(IpcChannels.IMAGE_DELETE, filename),
  },
  dialog: {
    selectImages: () => ipcRenderer.invoke(IpcChannels.DIALOG_SELECT_IMAGES),
  },
  url: {
    fetchMeta: (url: string) =>
      ipcRenderer.invoke(IpcChannels.URL_FETCH_META, url),
  },
  terminal: {
    create: (cwd?: string) => ipcRenderer.invoke(IpcChannels.TERMINAL_CREATE, cwd),
    write: (id: string, data: string) =>
      ipcRenderer.invoke(IpcChannels.TERMINAL_WRITE, id, data),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IpcChannels.TERMINAL_RESIZE, id, cols, rows),
    close: (id: string) => ipcRenderer.invoke(IpcChannels.TERMINAL_CLOSE, id),
    getCwd: (id: string) => ipcRenderer.invoke(IpcChannels.TERMINAL_GET_CWD, id),
    saveBuffer: (sessionKey: string, buffer: string) =>
      ipcRenderer.invoke(IpcChannels.TERMINAL_SAVE_BUFFER, sessionKey, buffer),
    loadBuffer: (sessionKey: string) =>
      ipcRenderer.invoke(IpcChannels.TERMINAL_LOAD_BUFFER, sessionKey),
    onData: (callback: (id: string, data: string) => void) => {
      const handler = (_: unknown, id: string, data: string): void => callback(id, data)
      ipcRenderer.on(IpcChannels.TERMINAL_DATA, handler)
      return () => {
        ipcRenderer.removeListener(IpcChannels.TERMINAL_DATA, handler)
      }
    },
    onExit: (callback: (id: string, exitCode: number) => void) => {
      const handler = (_: unknown, id: string, exitCode: number): void =>
        callback(id, exitCode)
      ipcRenderer.on(IpcChannels.TERMINAL_EXIT, handler)
      return () => {
        ipcRenderer.removeListener(IpcChannels.TERMINAL_EXIT, handler)
      }
    },
  },
  search: {
    content: (query: string, dirs: string[], maxResults?: number) =>
      ipcRenderer.invoke(IpcChannels.SEARCH_CONTENT, query, dirs, maxResults),
  },
  ai: {
    chat: (
      providerId: string,
      messages: Array<{ role: string; content: string }>,
      temperature?: number,
      maxTokens?: number
    ) => ipcRenderer.invoke(IpcChannels.AI_CHAT, providerId, messages, temperature, maxTokens),
    testConnection: (provider: Record<string, unknown>) =>
      ipcRenderer.invoke(IpcChannels.AI_TEST_CONNECTION, provider),
  },
  shortcut: {
    onShortcut: (callback: (shortcut: string) => void) => {
      const handler = (_: unknown, shortcut: string): void => callback(shortcut)
      ipcRenderer.on(IpcChannels.SHORTCUT, handler)
      return () => {
        ipcRenderer.removeListener(IpcChannels.SHORTCUT, handler)
      }
    },
    fileSwitcherState: (open: boolean) => ipcRenderer.send('file-switcher:state', open),
  },
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
