import { ipcMain, dialog, BrowserWindow } from 'electron'
import { IpcChannels } from '../../shared/types'
import type { WorkspaceState } from '../../shared/types'
import { FileSystemCore, setWorkspacePath, getWorkspacePath } from './fs'
import { loadState, saveState, addRecentWorkspace } from './workspace-store'
import { fileWatcher } from './watcher'
import { ptyManager } from './pty-manager'

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
}
