import fs from 'fs/promises'
import path from 'path'
import type { FileNode, FileStat, IpcResult } from '../../shared/types'

let workspacePath: string | null = null

export function getWorkspacePath(): string | null {
  return workspacePath
}

export function setWorkspacePath(p: string): void {
  workspacePath = p
}

/**
 * Validate that targetPath is inside the workspace root.
 * Prevents path traversal attacks (e.g. ../../etc/passwd).
 */
function assertInsideWorkspace(targetPath: string): string {
  if (!workspacePath) {
    throw new Error('No workspace opened')
  }
  const resolved = path.resolve(targetPath)
  const root = path.resolve(workspacePath)
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error('Access denied: path outside workspace')
  }
  return resolved
}

function wrapOk<T>(data: T): IpcResult<T> {
  return { ok: true, data }
}

function wrapErr(error: unknown): IpcResult<never> {
  const msg = error instanceof Error ? error.message : String(error)
  return { ok: false, error: msg }
}

export const FileSystemCore = {
  async readDir(targetPath: string): Promise<IpcResult<FileNode[]>> {
    try {
      const resolved = assertInsideWorkspace(targetPath)
      const entries = await fs.readdir(resolved, { withFileTypes: true })

      const nodes: FileNode[] = entries
        .filter((e) => !e.name.startsWith('.'))
        .map((entry) => ({
          name: entry.name,
          path: path.join(resolved, entry.name),
          isDirectory: entry.isDirectory(),
        }))

      nodes.sort((a, b) => {
        if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name)
        return a.isDirectory ? -1 : 1
      })

      return wrapOk(nodes)
    } catch (error) {
      return wrapErr(error)
    }
  },

  async readFile(targetPath: string): Promise<IpcResult<string>> {
    try {
      const resolved = assertInsideWorkspace(targetPath)
      const content = await fs.readFile(resolved, 'utf-8')
      return wrapOk(content)
    } catch (error) {
      return wrapErr(error)
    }
  },

  async writeFile(targetPath: string, content: string): Promise<IpcResult<void>> {
    try {
      const resolved = assertInsideWorkspace(targetPath)
      await fs.writeFile(resolved, content, 'utf-8')
      return wrapOk(undefined)
    } catch (error) {
      return wrapErr(error)
    }
  },

  async createFile(targetPath: string): Promise<IpcResult<void>> {
    try {
      const resolved = assertInsideWorkspace(targetPath)
      await fs.writeFile(resolved, '', 'utf-8')
      return wrapOk(undefined)
    } catch (error) {
      return wrapErr(error)
    }
  },

  async createDir(targetPath: string): Promise<IpcResult<void>> {
    try {
      const resolved = assertInsideWorkspace(targetPath)
      await fs.mkdir(resolved, { recursive: true })
      return wrapOk(undefined)
    } catch (error) {
      return wrapErr(error)
    }
  },

  async rename(oldPath: string, newPath: string): Promise<IpcResult<void>> {
    try {
      const resolvedOld = assertInsideWorkspace(oldPath)
      const resolvedNew = assertInsideWorkspace(newPath)
      await fs.rename(resolvedOld, resolvedNew)
      return wrapOk(undefined)
    } catch (error) {
      return wrapErr(error)
    }
  },

  async delete(targetPath: string): Promise<IpcResult<void>> {
    try {
      const resolved = assertInsideWorkspace(targetPath)
      const stat = await fs.stat(resolved)
      if (stat.isDirectory()) {
        await fs.rm(resolved, { recursive: true })
      } else {
        await fs.unlink(resolved)
      }
      return wrapOk(undefined)
    } catch (error) {
      return wrapErr(error)
    }
  },

  async stat(targetPath: string): Promise<IpcResult<FileStat>> {
    try {
      const resolved = assertInsideWorkspace(targetPath)
      const s = await fs.stat(resolved)
      return wrapOk({
        name: path.basename(resolved),
        path: resolved,
        isDirectory: s.isDirectory(),
        isFile: s.isFile(),
        size: s.size,
        modifiedAt: s.mtimeMs,
        createdAt: s.birthtimeMs,
      })
    } catch (error) {
      return wrapErr(error)
    }
  },
}
