import { ipcMain, dialog, BrowserWindow } from 'electron'
import { IpcChannels } from '../../shared/types'
import type { WorkspaceState } from '../../shared/types'
import { FileSystemCore, setWorkspacePath, getWorkspacePath } from './fs'
import { loadState, saveState, addRecentWorkspace } from './workspace-store'
import { fileWatcher } from './watcher'
import { ptyManager } from './pty-manager'
import { saveImage, saveImageFromUrl, saveImageFromPath, deleteImage } from './image-storage'

export function setupIpcHandlers(): void {
  // ── Workspace ──

  ipcMain.handle(IpcChannels.WORKSPACE_OPEN, async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return { ok: false, error: 'No focused window' }

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Open Workspace Folder',
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, error: 'cancelled' }
    }

    const selected = result.filePaths[0]
    setWorkspacePath(selected)
    addRecentWorkspace(selected)
    saveState({ lastWorkspacePath: selected })
    fileWatcher.start(selected)
    return { ok: true, data: selected }
  })

  ipcMain.handle(IpcChannels.WORKSPACE_GET, () => {
    const p = getWorkspacePath()
    return p ? { ok: true, data: p } : { ok: false, error: 'No workspace opened' }
  })

  // ── State Persistence ──

  ipcMain.handle(IpcChannels.STATE_GET, () => {
    return { ok: true, data: loadState() }
  })

  ipcMain.handle(IpcChannels.STATE_UPDATE, (_, patch: Partial<WorkspaceState>) => {
    saveState(patch)
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
    const workingDir = cwd || getWorkspacePath() || process.env.HOME || '/'
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
      const title = getMetaContent('og:title') || titleMatch?.[1]?.trim() || ''
      const description = getMetaContent('og:description') || getMetaContent('description') || ''
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
}
