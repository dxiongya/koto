import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IpcChannels } from '../shared/types'

// ── Terminal multiplexed dispatchers ──
// One IPC listener → Map lookup → direct callback. O(1) per message instead of O(N).
const terminalDataListeners = new Map<string, (data: string) => void>()
const terminalExitListeners = new Map<string, (exitCode: number) => void>()
const terminalDataDispatcher = (_: unknown, id: string, data: string): void => {
  terminalDataListeners.get(id)?.(data)
}
const terminalExitDispatcher = (_: unknown, id: string, exitCode: number): void => {
  terminalExitListeners.get(id)?.(exitCode)
}

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
  video: {
    save: (data: ArrayBuffer, mimeType: string) =>
      ipcRenderer.invoke(IpcChannels.VIDEO_SAVE, data, mimeType),
    saveFromPath: (localPath: string) =>
      ipcRenderer.invoke(IpcChannels.VIDEO_SAVE_FROM_PATH, localPath),
    delete: (filename: string) =>
      ipcRenderer.invoke(IpcChannels.VIDEO_DELETE, filename),
  },
  dialog: {
    selectImages: () => ipcRenderer.invoke(IpcChannels.DIALOG_SELECT_IMAGES),
    selectVideos: () => ipcRenderer.invoke(IpcChannels.DIALOG_SELECT_VIDEOS),
    selectFolder: () => ipcRenderer.invoke(IpcChannels.DIALOG_SELECT_FOLDER),
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
    getReplayBuffer: (id: string) =>
      ipcRenderer.invoke(IpcChannels.TERMINAL_GET_REPLAY_BUFFER, id),
    close: (id: string) => ipcRenderer.invoke(IpcChannels.TERMINAL_CLOSE, id),
    getCwd: (id: string) => ipcRenderer.invoke(IpcChannels.TERMINAL_GET_CWD, id),
    saveBuffer: (sessionKey: string, buffer: string) =>
      ipcRenderer.invoke(IpcChannels.TERMINAL_SAVE_BUFFER, sessionKey, buffer),
    loadBuffer: (sessionKey: string) =>
      ipcRenderer.invoke(IpcChannels.TERMINAL_LOAD_BUFFER, sessionKey),
    // ── Multiplexed data/exit listeners ──
    // Single IPC listener dispatches to per-terminal callbacks via Map.
    // Eliminates O(N) listener registrations and MaxListenersExceededWarning.
    onDataForId: (id: string, callback: (data: string) => void) => {
      if (!terminalDataListeners.size) {
        ipcRenderer.on(IpcChannels.TERMINAL_DATA, terminalDataDispatcher)
      }
      terminalDataListeners.set(id, callback)
      return () => {
        terminalDataListeners.delete(id)
        if (!terminalDataListeners.size) {
          ipcRenderer.removeListener(IpcChannels.TERMINAL_DATA, terminalDataDispatcher)
        }
      }
    },
    onExitForId: (id: string, callback: (exitCode: number) => void) => {
      if (!terminalExitListeners.size) {
        ipcRenderer.on(IpcChannels.TERMINAL_EXIT, terminalExitDispatcher)
      }
      terminalExitListeners.set(id, callback)
      return () => {
        terminalExitListeners.delete(id)
        if (!terminalExitListeners.size) {
          ipcRenderer.removeListener(IpcChannels.TERMINAL_EXIT, terminalExitDispatcher)
        }
      }
    },
    // Synchronous save — MUST complete before window closes
    saveAllSync: (buffers: { key: string; data: string }[], config: Record<string, unknown>) =>
      ipcRenderer.sendSync(IpcChannels.TERMINAL_SAVE_ALL_SYNC, { buffers, config }),
    // Keep legacy broadcast API for backward compat
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
  memory: {
    store: (wing: string, room: string, content: string, opts?: Record<string, unknown>) =>
      ipcRenderer.invoke(IpcChannels.MEMORY_STORE, wing, room, content, opts),
    search: (query: string, wing?: string, room?: string, limit?: number) =>
      ipcRenderer.invoke(IpcChannels.MEMORY_SEARCH, query, wing, room, limit),
    list: (wing?: string, room?: string, limit?: number, offset?: number) =>
      ipcRenderer.invoke(IpcChannels.MEMORY_LIST, wing, room, limit, offset),
    delete: (id: string) => ipcRenderer.invoke(IpcChannels.MEMORY_DELETE, id),
    status: () => ipcRenderer.invoke(IpcChannels.MEMORY_STATUS),
    taxonomy: () => ipcRenderer.invoke(IpcChannels.MEMORY_TAXONOMY),
    getContext: (wing?: string, room?: string) => ipcRenderer.invoke(IpcChannels.MEMORY_GET_CONTEXT, wing, room),
    setIdentity: (content: string) => ipcRenderer.invoke(IpcChannels.MEMORY_SET_IDENTITY, content),
    kgAdd: (subject: string, predicate: string, object: string, opts?: Record<string, unknown>) =>
      ipcRenderer.invoke(IpcChannels.MEMORY_KG_ADD, subject, predicate, object, opts),
    kgInvalidate: (subject: string, predicate: string, object: string, ended?: string) =>
      ipcRenderer.invoke(IpcChannels.MEMORY_KG_INVALIDATE, subject, predicate, object, ended),
    kgQuery: (entity: string, opts?: Record<string, unknown>) =>
      ipcRenderer.invoke(IpcChannels.MEMORY_KG_QUERY, entity, opts),
    kgStats: () => ipcRenderer.invoke(IpcChannels.MEMORY_KG_STATS),
  },
  search: {
    content: (query: string, dirs: string[], maxResults?: number) =>
      ipcRenderer.invoke(IpcChannels.SEARCH_CONTENT, query, dirs, maxResults),
  },
  bus: {
    // Renderer responds to main process requests for Bus tool info/calls
    onListTools: (callback: () => { name: string; description: string; parameters: Record<string, unknown>; appId: string }[]) => {
      ipcRenderer.on(IpcChannels.BUS_LIST_TOOLS, async (event) => {
        const tools = callback()
        event.sender.send(IpcChannels.BUS_LIST_TOOLS + ':response', tools)
      })
    },
    notifyToolsReady: () => ipcRenderer.invoke(IpcChannels.BUS_TOOLS_READY),
    startServer: (port?: number) => ipcRenderer.invoke(IpcChannels.MCP_SERVER_START, port),
    stopServer: () => ipcRenderer.invoke(IpcChannels.MCP_SERVER_STOP),
    serverStatus: () => ipcRenderer.invoke(IpcChannels.MCP_SERVER_STATUS),
    onCallTool: (callback: (name: string, params: Record<string, unknown>) => Promise<unknown>) => {
      ipcRenderer.on(IpcChannels.BUS_CALL_TOOL, async (event, name: string, params: Record<string, unknown>, requestId: string) => {
        try {
          const result = await callback(name, params)
          event.sender.send(IpcChannels.BUS_CALL_TOOL + ':response', requestId, { ok: true, data: result })
        } catch (e) {
          event.sender.send(IpcChannels.BUS_CALL_TOOL + ':response', requestId, { ok: false, error: String(e) })
        }
      })
    },
  },
  changelog: {
    append: (entry: Record<string, unknown>) =>
      ipcRenderer.invoke(IpcChannels.CHANGELOG_APPEND, entry),
    read: (filePath: string) =>
      ipcRenderer.invoke(IpcChannels.CHANGELOG_READ, filePath),
  },
  mcp: {
    listTools: () => ipcRenderer.invoke(IpcChannels.MCP_LIST_TOOLS),
    refresh: () => ipcRenderer.invoke(IpcChannels.MCP_REFRESH),
  },
  skills: {
    list: () => ipcRenderer.invoke(IpcChannels.SKILLS_LIST),
    toggle: (name: string, enabled: boolean) =>
      ipcRenderer.invoke(IpcChannels.SKILLS_TOGGLE, name, enabled),
    create: (name: string, description: string, content: string) =>
      ipcRenderer.invoke(IpcChannels.SKILLS_CREATE, name, description, content),
    delete: (name: string) =>
      ipcRenderer.invoke(IpcChannels.SKILLS_DELETE, name),
    importUrl: (url: string) =>
      ipcRenderer.invoke(IpcChannels.SKILLS_IMPORT_URL, url),
  },
  ai: {
    chat: (
      providerId: string,
      messages: Array<{ role: string; content: string }>,
      temperature?: number,
      maxTokens?: number,
      enableTools?: boolean
    ) => ipcRenderer.invoke(IpcChannels.AI_CHAT, providerId, messages, temperature, maxTokens, enableTools),
    testConnection: (provider: Record<string, unknown>) =>
      ipcRenderer.invoke(IpcChannels.AI_TEST_CONNECTION, provider),
    onToolEvent: (callback: (event: { type: string; toolName: string; toolInput?: Record<string, unknown>; result?: string; durationMs?: number }) => void) => {
      const handler = (_: unknown, event: { type: string; toolName: string; toolInput?: Record<string, unknown>; result?: string; durationMs?: number }): void => callback(event)
      ipcRenderer.on(IpcChannels.AI_CHAT_TOOL_EVENT, handler)
      return () => {
        ipcRenderer.removeListener(IpcChannels.AI_CHAT_TOOL_EVENT, handler)
      }
    },
  },
  automation: {
    list: () => ipcRenderer.invoke(IpcChannels.AUTOMATION_LIST),
    create: (input: Record<string, unknown>) =>
      ipcRenderer.invoke(IpcChannels.AUTOMATION_CREATE, input),
    update: (id: string, patch: Record<string, unknown>) =>
      ipcRenderer.invoke(IpcChannels.AUTOMATION_UPDATE, id, patch),
    delete: (id: string) =>
      ipcRenderer.invoke(IpcChannels.AUTOMATION_DELETE, id),
    runNow: (id: string) =>
      ipcRenderer.invoke(IpcChannels.AUTOMATION_RUN_NOW, id),
    getSnapshots: (automationId: string) =>
      ipcRenderer.invoke(IpcChannels.AUTOMATION_GET_SNAPSHOTS, automationId),
    restoreSnapshot: (automationId: string, timestamp: number) =>
      ipcRenderer.invoke(IpcChannels.AUTOMATION_RESTORE_SNAPSHOT, automationId, timestamp),
    getExperience: (automationId: string) =>
      ipcRenderer.invoke(IpcChannels.AUTOMATION_GET_EXPERIENCE, automationId),
    onRunEvent: (callback: (event: { automationId: string; status: string; timestamp: number; message?: string }) => void) => {
      const handler = (_: unknown, event: { automationId: string; status: string; timestamp: number; message?: string }): void => callback(event)
      ipcRenderer.on(IpcChannels.AUTOMATION_RUN_EVENT, handler)
      return () => {
        ipcRenderer.removeListener(IpcChannels.AUTOMATION_RUN_EVENT, handler)
      }
    },
  },
  collector: {
    list: (limit?: number, offset?: number, group?: string) => ipcRenderer.invoke(IpcChannels.COLLECTOR_LIST, limit, offset, group),
    count: (group?: string) => ipcRenderer.invoke(IpcChannels.COLLECTOR_COUNT, group),
    checkDuplicate: (url: string) => ipcRenderer.invoke(IpcChannels.COLLECTOR_CHECK_DUPLICATE, url),
    checkDuplicateHash: (data: ArrayBuffer) => ipcRenderer.invoke(IpcChannels.COLLECTOR_CHECK_DUPLICATE_HASH, data),
    getEmbeddingKey: () => ipcRenderer.invoke(IpcChannels.EMBEDDING_GET_API_KEY),
    setEmbeddingKey: (key: string) => ipcRenderer.invoke(IpcChannels.EMBEDDING_SET_API_KEY, key),
    testEmbedding: (apiKey: string) => ipcRenderer.invoke(IpcChannels.EMBEDDING_TEST, apiKey),
    add: (input: Record<string, unknown>) =>
      ipcRenderer.invoke(IpcChannels.COLLECTOR_ADD, input),
    update: (id: string, patch: Record<string, unknown>) =>
      ipcRenderer.invoke(IpcChannels.COLLECTOR_UPDATE, id, patch),
    delete: (id: string) =>
      ipcRenderer.invoke(IpcChannels.COLLECTOR_DELETE, id),
    search: (query: string) =>
      ipcRenderer.invoke(IpcChannels.COLLECTOR_SEARCH, query),
    getMarkdown: (itemId: string) =>
      ipcRenderer.invoke(IpcChannels.COLLECTOR_GET_MARKDOWN, itemId),
    embedItem: (itemId: string) =>
      ipcRenderer.invoke(IpcChannels.COLLECTOR_EMBED_ITEM, itemId),
    embedAll: () =>
      ipcRenderer.invoke(IpcChannels.COLLECTOR_EMBED_ALL),
    fetchMarkdown: (itemId: string, url: string) =>
      ipcRenderer.invoke(IpcChannels.COLLECTOR_FETCH_MARKDOWN, itemId, url),
    groups: () => ipcRenderer.invoke(IpcChannels.COLLECTOR_GROUPS),
    addGroup: (name: string) =>
      ipcRenderer.invoke(IpcChannels.COLLECTOR_ADD_GROUP, name),
    renameGroup: (oldName: string, newName: string) =>
      ipcRenderer.invoke(IpcChannels.COLLECTOR_RENAME_GROUP, oldName, newName),
    deleteGroup: (name: string) =>
      ipcRenderer.invoke(IpcChannels.COLLECTOR_DELETE_GROUP, name),
  },
  apps: {
    discover: () => ipcRenderer.invoke(IpcChannels.APPS_DISCOVER),
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke(IpcChannels.SHELL_OPEN_EXTERNAL, url),
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
