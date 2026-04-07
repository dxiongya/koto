import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { IpcChannels } from '../../shared/types'
import type { LiteConfig } from '../../shared/types'
import { FileSystemCore, setProjectPath, getProjectPath } from './fs'
import { getLiteHome, loadConfig, saveConfig, addRecentProject } from './lite-home'
import { fileWatcher } from './watcher'
import { ptyManager } from './pty-manager'
import { saveImage, saveImageFromUrl, saveImageFromPath, deleteImage } from './image-storage'
import { saveVideo, saveVideoFromPath, deleteVideo } from './video-storage'
import { searchFilesContent } from './search'
import { aiChat, aiTestConnection } from './ai-service'
import { appendChangelog, readChangelog } from './changelog'
import { mcpManager } from './mcp-manager'
import { getAllToolDefinitions } from './ai-tools'
import { loadSkills, toggleSkill, createSkill, deleteSkill, importSkillFromUrl } from './skills-loader'
import { listAutomations, createAutomation, updateAutomation, deleteAutomation } from './automation-store'
import { readSnapshots, restoreSnapshot } from './automation-snapshots'
import { loadExperience } from './automation-runner'
import { automationScheduler } from './automation-scheduler'
import { listCollectedItems, countCollectedItems, findDuplicateByUrl, findDuplicateByHash, computeContentHash, addCollectedItem, updateCollectedItem, deleteCollectedItem, getCollectorGroups, addCollectorGroup, renameCollectorGroup, deleteCollectorGroup, fetchAndSaveMarkdown, ftsSearch, readItemMarkdown } from './collector-store'
import { hybridSearch, embedAllPending, embedAndSave } from './collector-embedding'
import type { AIProviderConfig, AIChatMessage, ChangelogEntry, Automation, CollectorAddInput, CollectedItem } from '../../shared/types'

/** Decode common HTML entities */
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

export function setupIpcHandlers(): void {
  // ── Bus Tools Bridge ──
  ipcMain.handle(IpcChannels.BUS_TOOLS_READY, async () => {
    const { refreshBusTools } = await import('./ai-tools')
    await refreshBusTools()
    console.log('[Bus] App tools refreshed for AI')
    return { ok: true }
  })

  // ── MCP Server (expose Bus tools to external AI) ──
  ipcMain.handle(IpcChannels.MCP_SERVER_START, async (_, port?: number) => {
    try {
      const { startMCPServer } = await import('./mcp-server')
      const result = await startMCPServer(port || 3899)
      return { ok: true, data: result }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle(IpcChannels.MCP_SERVER_STOP, async () => {
    try {
      const { stopMCPServer } = await import('./mcp-server')
      await stopMCPServer()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle(IpcChannels.MCP_SERVER_STATUS, async () => {
    try {
      const { isMCPServerRunning, getMCPServerPort } = await import('./mcp-server')
      return { ok: true, data: { running: isMCPServerRunning(), port: getMCPServerPort() } }
    } catch {
      return { ok: true, data: { running: false, port: null } }
    }
  })

  // ── Lite Home ──

  ipcMain.handle(IpcChannels.LITE_GET_HOME, () => {
    return { ok: true, data: getLiteHome() }
  })

  // ── Project (code.app) ──

  ipcMain.handle(IpcChannels.PROJECT_OPEN, async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return { ok: false, error: 'No focused window' }

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Open Project Folder',
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, error: 'cancelled' }
    }

    const selected = result.filePaths[0]
    setProjectPath(selected)
    addRecentProject(selected)
    saveConfig({ codeProjectPath: selected })
    fileWatcher.watchProject(selected)
    return { ok: true, data: selected }
  })

  ipcMain.handle(IpcChannels.PROJECT_GET, () => {
    const p = getProjectPath()
    return p ? { ok: true, data: p } : { ok: false, error: 'No project opened' }
  })

  // ── State Persistence ──

  ipcMain.handle(IpcChannels.STATE_GET, () => {
    return { ok: true, data: loadConfig() }
  })

  ipcMain.handle(IpcChannels.STATE_UPDATE, (_, patch: Partial<LiteConfig>) => {
    saveConfig(patch)
    return { ok: true, data: undefined }
  })

  // ── File System ──

  ipcMain.handle(IpcChannels.FS_READ_DIR, (_, targetPath: string) => {
    return FileSystemCore.readDir(targetPath)
  })

  ipcMain.handle(IpcChannels.FS_READ_FILE, (_, targetPath: string) => {
    return FileSystemCore.readFile(targetPath)
  })

  ipcMain.handle(IpcChannels.FS_WRITE_FILE, (_, targetPath: string, content: string) => {
    return FileSystemCore.writeFile(targetPath, content)
  })

  ipcMain.handle(IpcChannels.FS_CREATE_FILE, (_, targetPath: string) => {
    return FileSystemCore.createFile(targetPath)
  })

  ipcMain.handle(IpcChannels.FS_CREATE_DIR, (_, targetPath: string) => {
    return FileSystemCore.createDir(targetPath)
  })

  ipcMain.handle(IpcChannels.FS_RENAME, (_, oldPath: string, newPath: string) => {
    return FileSystemCore.rename(oldPath, newPath)
  })

  ipcMain.handle(IpcChannels.FS_DELETE, (_, targetPath: string) => {
    return FileSystemCore.delete(targetPath)
  })

  ipcMain.handle(IpcChannels.FS_STAT, (_, targetPath: string) => {
    return FileSystemCore.stat(targetPath)
  })

  // ── Terminal ──

  ipcMain.handle(IpcChannels.TERMINAL_CREATE, (_, cwd?: string) => {
    const workingDir = cwd || getProjectPath() || process.env.HOME || '/'
    const id = ptyManager.create(workingDir)
    return { ok: true, data: id }
  })

  ipcMain.handle(IpcChannels.TERMINAL_WRITE, (_, id: string, data: string) => {
    ptyManager.write(id, data)
  })

  ipcMain.handle(IpcChannels.TERMINAL_RESIZE, (_, id: string, cols: number, rows: number) => {
    ptyManager.resize(id, cols, rows)
  })

  ipcMain.handle(IpcChannels.TERMINAL_CLOSE, (_, id: string) => {
    ptyManager.close(id)
  })

  ipcMain.handle(IpcChannels.TERMINAL_GET_CWD, (_, id: string) => {
    const cwd = ptyManager.getCwd(id)
    return { ok: true, data: cwd }
  })

  ipcMain.handle(IpcChannels.TERMINAL_GET_REPLAY_BUFFER, (_, id: string) => {
    const buffer = ptyManager.getReplayBuffer(id)
    return { ok: true, data: buffer }
  })

  ipcMain.handle(IpcChannels.TERMINAL_SAVE_BUFFER, (_, sessionKey: string, buffer: string) => {
    try {
      const dir = path.join(getLiteHome(), 'terminals')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, `${sessionKey}.txt`), buffer, 'utf-8')
      return { ok: true, data: undefined }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle(IpcChannels.TERMINAL_LOAD_BUFFER, (_, sessionKey: string) => {
    try {
      const filePath = path.join(getLiteHome(), 'terminals', `${sessionKey}.txt`)
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf-8')
        return { ok: true, data }
      }
      return { ok: false, error: 'not found' }
    } catch {
      return { ok: false, error: 'read failed' }
    }
  })

  // Synchronous save of all terminal buffers + state — used in beforeunload
  // Config includes terminalSessions with {persistKey, id} so we can fetch
  // the latest replay buffer directly from PtyManager (same process, no IPC needed).
  ipcMain.on(IpcChannels.TERMINAL_SAVE_ALL_SYNC, (event, payload: { buffers: { key: string; data: string }[]; config: Record<string, unknown> }) => {
    try {
      const dir = path.join(getLiteHome(), 'terminals')
      fs.mkdirSync(dir, { recursive: true })

      // Fetch latest replay buffers directly from PtyManager (same process, synchronous)
      // Each session has {id (PTY id), persistKey (stable file key)}
      const sessions = (payload.config.terminalSessions ?? []) as { id: string; persistKey: string }[]
      const activeKeys = new Set<string>()

      for (const session of sessions) {
        activeKeys.add(`${session.persistKey}.txt`)
        const buffer = ptyManager.getReplayBuffer(session.id)
        if (buffer) {
          // Only overwrite if new buffer has meaningful content,
          // or if no previous file exists (first save)
          const filePath = path.join(dir, `${session.persistKey}.txt`)
          const prevExists = fs.existsSync(filePath)
          if (buffer.length > 1024 || !prevExists) {
            fs.writeFileSync(filePath, buffer, 'utf-8')
          }
        }
      }

      // Also save any buffers passed from renderer (fallback)
      for (const { key, data } of payload.buffers) {
        activeKeys.add(`${key}.txt`)
        fs.writeFileSync(path.join(dir, `${key}.txt`), data, 'utf-8')
      }

      // Clean up stale buffer files
      try {
        for (const f of fs.readdirSync(dir)) {
          if (f.endsWith('.txt') && !activeKeys.has(f)) {
            fs.unlinkSync(path.join(dir, f))
          }
        }
      } catch { /* ignore */ }

      // Save config
      const configPath = path.join(getLiteHome(), 'config.json')
      let existing: Record<string, unknown> = {}
      try { existing = JSON.parse(fs.readFileSync(configPath, 'utf-8')) } catch {}
      Object.assign(existing, payload.config)
      fs.writeFileSync(configPath, JSON.stringify(existing, null, 2), 'utf-8')
      event.returnValue = { ok: true }
    } catch (e) {
      event.returnValue = { ok: false, error: String(e) }
    }
  })

  // ── Image Storage ──

  ipcMain.handle(IpcChannels.IMAGE_SAVE, async (_, data: ArrayBuffer, mimeType: string) => {
    try {
      const filename = await saveImage(data, mimeType)
      return { ok: true, data: filename }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle(IpcChannels.IMAGE_SAVE_FROM_URL, async (_, imageUrl: string) => {
    try {
      const filename = await saveImageFromUrl(imageUrl)
      return { ok: true, data: filename }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle(IpcChannels.IMAGE_SAVE_FROM_PATH, async (_, localPath: string) => {
    try {
      const filename = await saveImageFromPath(localPath)
      return { ok: true, data: filename }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle(IpcChannels.IMAGE_DELETE, async (_, filename: string) => {
    try {
      await deleteImage(filename)
      return { ok: true, data: undefined }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // ── Video Storage ──

  ipcMain.handle(IpcChannels.VIDEO_SAVE, async (_, data: ArrayBuffer, mimeType: string) => {
    try {
      const filename = await saveVideo(data, mimeType)
      return { ok: true, data: filename }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle(IpcChannels.VIDEO_SAVE_FROM_PATH, async (_, localPath: string) => {
    try {
      const filename = await saveVideoFromPath(localPath)
      return { ok: true, data: filename }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle(IpcChannels.VIDEO_DELETE, async (_, filename: string) => {
    try {
      await deleteVideo(filename)
      return { ok: true, data: undefined }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // ── Dialog ──

  // ── URL Metadata ──

  ipcMain.handle(IpcChannels.URL_FETCH_META, async (_, url: string) => {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LiteBot/1.0)' },
        signal: AbortSignal.timeout(8000),
        redirect: 'follow',
      })
      if (!response.ok) return { ok: true, data: { title: '', description: '', image: '' } }

      const html = await response.text()
      const getMetaContent = (name: string): string => {
        const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i')
        const altRe = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`, 'i')
        return re.exec(html)?.[1] || altRe.exec(html)?.[1] || ''
      }
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
      const title = decodeHtmlEntities(getMetaContent('og:title') || titleMatch?.[1]?.trim() || '')
      const description = decodeHtmlEntities(getMetaContent('og:description') || getMetaContent('description') || '')
      const image = getMetaContent('og:image') || ''

      return { ok: true, data: { title, description, image } }
    } catch {
      return { ok: true, data: { title: '', description: '', image: '' } }
    }
  })

  ipcMain.handle(IpcChannels.DIALOG_SELECT_IMAGES, async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return { ok: false, error: 'No focused window' }

    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] },
      ],
    })

    if (result.canceled) {
      return { ok: false, error: 'cancelled' }
    }
    return { ok: true, data: result.filePaths }
  })

  ipcMain.handle(IpcChannels.DIALOG_SELECT_VIDEOS, async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return { ok: false, error: 'No focused window' }

    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Videos', extensions: ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'] },
      ],
    })

    if (result.canceled) {
      return { ok: false, error: 'cancelled' }
    }
    return { ok: true, data: result.filePaths }
  })

  ipcMain.handle(IpcChannels.DIALOG_SELECT_FOLDER, async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return { ok: false, error: 'No focused window' }

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Open Folder',
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, error: 'cancelled' }
    }
    return { ok: true, data: result.filePaths[0] }
  })

  // ── AI ──

  ipcMain.handle(
    IpcChannels.AI_CHAT,
    async (
      event,
      providerId: string,
      messages: AIChatMessage[],
      temperature?: number,
      maxTokens?: number,
      enableTools?: boolean
    ) => {
      const onToolEvent = enableTools
        ? (toolEvent: import('../../shared/types').AIToolEvent) => {
            event.sender.send(IpcChannels.AI_CHAT_TOOL_EVENT, toolEvent)
          }
        : undefined
      return aiChat(providerId, messages, temperature, maxTokens, enableTools, onToolEvent)
    }
  )

  ipcMain.handle(
    IpcChannels.AI_TEST_CONNECTION,
    async (_, provider: AIProviderConfig) => {
      return aiTestConnection(provider)
    }
  )

  // ── AI Changelog ──

  ipcMain.handle(IpcChannels.CHANGELOG_APPEND, (_, entry: ChangelogEntry) => {
    return appendChangelog(entry)
  })

  ipcMain.handle(IpcChannels.CHANGELOG_READ, (_, filePath: string) => {
    return readChangelog(filePath)
  })

  // ── Content Search ──

  ipcMain.handle(
    IpcChannels.SEARCH_CONTENT,
    async (_, query: string, dirs: string[], maxResults: number = 50) => {
      try {
        const results = searchFilesContent(query, dirs, maxResults)
        return { ok: true, data: results }
      } catch (e) {
        return { ok: false, error: String(e) }
      }
    },
  )

  // ── MCP ──

  ipcMain.handle(IpcChannels.MCP_LIST_TOOLS, () => {
    return { ok: true, data: getAllToolDefinitions() }
  })

  ipcMain.handle(IpcChannels.MCP_REFRESH, async () => {
    try {
      const config = loadConfig()
      await mcpManager.initFromConfig(config.mcpServers ?? [])
      return { ok: true, data: mcpManager.getAllTools() }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // ── Skills ──

  ipcMain.handle(IpcChannels.SKILLS_LIST, () => {
    try {
      return { ok: true, data: loadSkills() }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle(IpcChannels.SKILLS_TOGGLE, (_, name: string, enabled: boolean) => {
    try {
      const success = toggleSkill(name, enabled)
      return success ? { ok: true, data: undefined } : { ok: false, error: 'Skill not found' }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle(IpcChannels.SKILLS_CREATE, (_, name: string, description: string, content: string) => {
    try {
      const success = createSkill(name, description, content)
      return success ? { ok: true, data: undefined } : { ok: false, error: 'Failed to create skill' }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle(IpcChannels.SKILLS_DELETE, (_, name: string) => {
    try {
      const success = deleteSkill(name)
      return success ? { ok: true, data: undefined } : { ok: false, error: 'Skill not found' }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle(IpcChannels.SKILLS_IMPORT_URL, async (_, url: string) => {
    return importSkillFromUrl(url)
  })

  // ── Automation ──

  ipcMain.handle(IpcChannels.AUTOMATION_LIST, () => {
    return listAutomations()
  })

  ipcMain.handle(IpcChannels.AUTOMATION_CREATE, (_, input: Omit<Automation, 'id' | 'createdAt' | 'lastRunAt' | 'lastRunStatus' | 'lastRunError' | 'runCount'>) => {
    return createAutomation(input)
  })

  ipcMain.handle(IpcChannels.AUTOMATION_UPDATE, (_, id: string, patch: Partial<Automation>) => {
    return updateAutomation(id, patch)
  })

  ipcMain.handle(IpcChannels.AUTOMATION_DELETE, (_, id: string) => {
    return deleteAutomation(id)
  })

  ipcMain.handle(IpcChannels.AUTOMATION_RUN_NOW, async (_, id: string) => {
    try {
      await automationScheduler.runNow(id)
      return { ok: true, data: undefined }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle(IpcChannels.AUTOMATION_GET_SNAPSHOTS, (_, automationId: string) => {
    return readSnapshots(automationId)
  })

  ipcMain.handle(IpcChannels.AUTOMATION_RESTORE_SNAPSHOT, (_, automationId: string, timestamp: number) => {
    return restoreSnapshot(automationId, timestamp)
  })

  ipcMain.handle(IpcChannels.AUTOMATION_GET_EXPERIENCE, (_, automationId: string) => {
    const exp = loadExperience(automationId)
    return exp ? { ok: true, data: exp } : { ok: true, data: null }
  })

  // ── Collector ──

  ipcMain.handle(IpcChannels.COLLECTOR_LIST, (_, limit?: number, offset?: number, group?: string) => {
    try {
      return { ok: true, data: listCollectedItems(limit || 0, offset || 0, group) }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle(IpcChannels.COLLECTOR_COUNT, (_, group?: string) => {
    try {
      return { ok: true, data: countCollectedItems(group) }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle(IpcChannels.COLLECTOR_CHECK_DUPLICATE, (_, url: string) => {
    try {
      const dup = findDuplicateByUrl(url)
      return { ok: true, data: dup }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle(IpcChannels.COLLECTOR_CHECK_DUPLICATE_HASH, (_, data: ArrayBuffer) => {
    try {
      const hash = computeContentHash(Buffer.from(data))
      const dup = findDuplicateByHash(hash)
      return { ok: true, data: dup }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle(IpcChannels.COLLECTOR_ADD, (_, input: CollectorAddInput) => {
    try {
      const item = addCollectedItem(input)
      return { ok: true, data: item }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle(IpcChannels.COLLECTOR_UPDATE, (_, id: string, patch: Partial<CollectedItem>) => {
    try {
      const item = updateCollectedItem(id, patch)
      return item ? { ok: true, data: item } : { ok: false, error: 'Item not found' }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle(IpcChannels.COLLECTOR_DELETE, (_, id: string) => {
    try {
      const ok = deleteCollectedItem(id)
      return ok ? { ok: true, data: undefined } : { ok: false, error: 'Item not found' }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle(IpcChannels.EMBEDDING_GET_API_KEY, () => {
    const config = loadConfig()
    const key = config.embeddingGeminiApiKey || ''
    return { ok: true, data: key }
  })

  ipcMain.handle(IpcChannels.EMBEDDING_SET_API_KEY, (_, apiKey: string) => {
    try {
      saveConfig({ embeddingGeminiApiKey: apiKey })
      return { ok: true, data: undefined }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle(IpcChannels.EMBEDDING_TEST, async (_, apiKey: string) => {
    try {
      const { GoogleGenAI } = await import('@google/genai')
      const client = new GoogleGenAI({ apiKey })
      const result = await client.models.embedContent({
        model: 'gemini-embedding-2-preview',
        contents: 'test',
        config: { outputDimensionality: 768 },
      })
      if (result.embeddings?.[0]?.values?.length) {
        return { ok: true, data: `Connected · ${result.embeddings[0].values.length}-dim vector` }
      }
      return { ok: false, error: 'No embedding returned' }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle(IpcChannels.COLLECTOR_SEARCH, async (_, query: string) => {
    try {
      // 1. FTS5 keyword search first (fast, precise)
      const ftsResults = ftsSearch(query)
      const ftsData = ftsResults.map((r) => ({ item: r.item, score: r.rank, source: 'keyword' as const }))

      // 2. If FTS found enough, return directly
      if (ftsData.length >= 5) return { ok: true, data: ftsData }

      // 3. Supplement with hybrid (keyword + semantic)
      const items = listCollectedItems(100, 0)
      const hybridResults = await hybridSearch(query, items)
      const itemMap = new Map(items.map((i) => [i.id, i]))
      const ftsIds = new Set(ftsData.map((r) => r.item.id))

      // Merge: FTS results first, then hybrid additions
      const hybridAdditions = hybridResults
        .filter((r) => !ftsIds.has(r.itemId))
        .map((r) => ({ item: itemMap.get(r.itemId)!, score: r.score, source: r.source }))
        .filter((r) => r.item)

      return { ok: true, data: [...ftsData, ...hybridAdditions] }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle(IpcChannels.COLLECTOR_GET_MARKDOWN, (_, itemId: string) => {
    const md = readItemMarkdown(itemId)
    return { ok: true, data: md }
  })

  ipcMain.handle(IpcChannels.COLLECTOR_EMBED_ITEM, async (_, itemId: string) => {
    try {
      const items = listCollectedItems()
      const item = items.find((i) => i.id === itemId)
      if (!item) return { ok: false, error: 'Item not found' }
      const ok = await embedAndSave(item)
      return ok ? { ok: true, data: undefined } : { ok: false, error: 'Embedding failed (no API key?)' }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle(IpcChannels.COLLECTOR_EMBED_ALL, async () => {
    try {
      const items = listCollectedItems()
      const result = await embedAllPending(items)
      return { ok: true, data: result }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle(IpcChannels.COLLECTOR_FETCH_MARKDOWN, async (_, itemId: string, url: string) => {
    try {
      const filePath = await fetchAndSaveMarkdown(itemId, url)
      return filePath ? { ok: true, data: filePath } : { ok: false, error: 'Failed to fetch markdown' }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle(IpcChannels.COLLECTOR_GROUPS, () => {
    try {
      return { ok: true, data: getCollectorGroups() }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle(IpcChannels.COLLECTOR_ADD_GROUP, (_, name: string) => {
    try {
      return { ok: true, data: addCollectorGroup(name) }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle(IpcChannels.COLLECTOR_RENAME_GROUP, (_, oldName: string, newName: string) => {
    try {
      return { ok: true, data: renameCollectorGroup(oldName, newName) }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle(IpcChannels.COLLECTOR_DELETE_GROUP, (_, name: string) => {
    try {
      return { ok: true, data: deleteCollectorGroup(name) }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // ── Apps ──

  ipcMain.handle(IpcChannels.APPS_DISCOVER, () => {
    try {
      const { discoverApps } = require('./app-loader')
      return { ok: true, data: discoverApps() }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // ── Shell ──

  ipcMain.handle(IpcChannels.SHELL_OPEN_EXTERNAL, (_, url: string) => {
    shell.openExternal(url)
    return { ok: true, data: undefined }
  })
}
