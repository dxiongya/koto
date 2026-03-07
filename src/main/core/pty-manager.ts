import * as pty from 'node-pty'
import { BrowserWindow } from 'electron'
import { IpcChannels } from '../../shared/types'

interface PtySession {
  id: string
  process: pty.IPty
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
      env: process.env as Record<string, string>,
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

    this.sessions.set(id, { id, process: proc })
    return id
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
