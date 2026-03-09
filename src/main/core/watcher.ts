import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { BrowserWindow } from 'electron'
import { IpcChannels } from '../../shared/types'
import type { FsWatchEvent } from '../../shared/types'

const IGNORE = new Set([
  'node_modules', '.git', '.DS_Store', '.data',
  'dist', 'out', '.next', '__pycache__', '.venv',
  '.cache', '.turbo', 'coverage',
])

export class FileWatcher {
  private watchers = new Map<string, fs.FSWatcher>()
  private debounceMap = new Map<string, ReturnType<typeof setTimeout>>()

  /** Watch liteHome/notes/ — always active */
  watchNotes(notesDir: string): void {
    this.startWatch('notes', notesDir)
  }

  /** Watch a code project directory — replaces previous project watch */
  watchProject(projectPath: string): void {
    this.stopWatch('project')
    this.startWatch('project', projectPath)
  }

  stopAll(): void {
    for (const [key] of this.watchers) {
      this.stopWatch(key)
    }
    for (const t of this.debounceMap.values()) clearTimeout(t)
    this.debounceMap.clear()
  }

  private startWatch(key: string, dirPath: string): void {
    this.stopWatch(key)
    try {
      const watcher = fs.watch(dirPath, { recursive: true }, (_eventType, filename) => {
        if (!filename) return
        const parts = filename.split(path.sep)
        if (parts.some((p) => p.startsWith('.') || IGNORE.has(p))) return

        const fullPath = path.join(dirPath, filename)
        const existing = this.debounceMap.get(fullPath)
        if (existing) clearTimeout(existing)

        this.debounceMap.set(
          fullPath,
          setTimeout(() => {
            this.debounceMap.delete(fullPath)
            this.resolveAndEmit(fullPath)
          }, 150),
        )
      })
      this.watchers.set(key, watcher)
    } catch (err) {
      console.error(`FileWatcher: failed to start watch for ${key}`, err)
    }
  }

  private stopWatch(key: string): void {
    const watcher = this.watchers.get(key)
    if (watcher) {
      watcher.close()
      this.watchers.delete(key)
    }
  }

  private async resolveAndEmit(fullPath: string): Promise<void> {
    let event: FsWatchEvent
    try {
      await fsp.access(fullPath)
      event = { type: 'update', path: fullPath }
    } catch {
      event = { type: 'delete', path: fullPath }
    }
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannels.FS_WATCH_EVENT, event)
    }
  }
}

// Singleton
export const fileWatcher = new FileWatcher()
