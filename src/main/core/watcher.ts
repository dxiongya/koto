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
  private watcher: fs.FSWatcher | null = null
  private debounceMap = new Map<string, ReturnType<typeof setTimeout>>()

  start(workspacePath: string): void {
    this.stop()

    try {
      this.watcher = fs.watch(workspacePath, { recursive: true }, (_eventType, filename) => {
        if (!filename) return

        // Ignore hidden files and blacklisted directories
        const parts = filename.split(path.sep)
        if (parts.some((p) => p.startsWith('.') || IGNORE.has(p))) return

        const fullPath = path.join(workspacePath, filename)

        // Debounce per path: 150ms
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
    } catch (err) {
      console.error('FileWatcher: failed to start', err)
    }
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    for (const t of this.debounceMap.values()) clearTimeout(t)
    this.debounceMap.clear()
  }

  private async resolveAndEmit(fullPath: string): Promise<void> {
    let event: FsWatchEvent

    try {
      await fsp.access(fullPath)
      // Path exists — could be create or update, we emit 'update' generically
      // (renderer treats both as "re-fetch parent directory")
      event = { type: 'update', path: fullPath }
    } catch {
      // Path doesn't exist — it was deleted
      event = { type: 'delete', path: fullPath }
    }

    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannels.FS_WATCH_EVENT, event)
    }
  }
}

// Singleton
export const fileWatcher = new FileWatcher()
