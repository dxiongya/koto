import * as pty from 'node-pty'
import { execSync } from 'child_process'
import { BrowserWindow } from 'electron'
import { IpcChannels } from '../../shared/types'

/** Strip env vars that prevent nested CLI tools (e.g. Claude Code) from launching */
function cleanEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>
  delete env['CLAUDECODE']
  delete env['CLAUDE_CODE']
  return env
}

interface PtySession {
  id: string
  process: pty.IPty
  initialCwd: string
}

export class PtyManager {
  private sessions = new Map<string, PtySession>()

  create(cwd: string): string {
    const id = crypto.randomUUID()
    const shell =
      process.platform === 'win32'
        ? 'powershell.exe'
        : process.env.SHELL || '/bin/zsh'

    const proc = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: cleanEnv(),
    })

    proc.onData((data) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IpcChannels.TERMINAL_DATA, id, data)
      }
    })

    proc.onExit(({ exitCode }) => {
      this.sessions.delete(id)
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IpcChannels.TERMINAL_EXIT, id, exitCode)
      }
    })

    this.sessions.set(id, { id, process: proc, initialCwd: cwd })
    return id
  }

  /** Get the current working directory of a PTY session */
  getCwd(id: string): string | null {
    const session = this.sessions.get(id)
    if (!session) return null
    try {
      const pid = session.process.pid
      // macOS: use lsof to find cwd
      if (process.platform === 'darwin') {
        const out = execSync(`lsof -p ${pid} -Fn 2>/dev/null | grep '^n/' | grep cwd`, {
          encoding: 'utf-8',
          timeout: 2000,
        })
        const match = out.match(/^n(.+)$/m)
        if (match) return match[1]
      }
      // Linux: read /proc symlink
      if (process.platform === 'linux') {
        const fs = require('fs')
        return fs.readlinkSync(`/proc/${pid}/cwd`)
      }
    } catch {
      // fallback
    }
    return session.initialCwd
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.process.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.process.resize(cols, rows)
  }

  close(id: string): void {
    const session = this.sessions.get(id)
    if (session) {
      session.process.kill()
      this.sessions.delete(id)
    }
  }

  closeAll(): void {
    for (const [id] of this.sessions) {
      this.close(id)
    }
  }
}

export const ptyManager = new PtyManager()
