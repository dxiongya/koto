import * as pty from 'node-pty'
import { execSync } from 'child_process'
import { BrowserWindow } from 'electron'
import { IpcChannels } from '../../shared/types'

/** Build clean env that inherits user's full shell environment */
function cleanEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>
  // Remove vars that prevent nested CLI tools (e.g. Claude Code)
  delete env['CLAUDECODE']
  delete env['CLAUDE_CODE']
  // Don't override TERM_PROGRAM — user's .zshrc may conditionally load
  // plugins (syntax highlighting, etc.) based on it matching iTerm.app
  return env
}

/** Max raw output to keep per terminal (128KB) */
const MAX_REPLAY_BUFFER = 128 * 1024

interface PtySession {
  id: string
  process: pty.IPty
  initialCwd: string
  /** Ring buffer of raw PTY output for replay on restart */
  replayBuffer: string[]
  replaySize: number
  /** True after PTY process exits — replay buffer still accessible */
  exited?: boolean
}

export class PtyManager {
  private sessions = new Map<string, PtySession>()

  create(cwd: string): string {
    const id = crypto.randomUUID()
    const shell =
      process.platform === 'win32'
        ? 'powershell.exe'
        : process.env.SHELL || '/bin/zsh'

    // Launch as login interactive shell — loads user's full config
    // (.zshrc, .zprofile, oh-my-zsh, syntax highlighting, etc.)
    const args = process.platform !== 'win32' ? ['--login', '-i'] : []
    const proc = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: cleanEnv(),
    })

    const session: PtySession = { id, process: proc, initialCwd: cwd, replayBuffer: [], replaySize: 0 }

    proc.onData((data) => {
      // Record raw output for replay
      session.replayBuffer.push(data)
      session.replaySize += data.length
      // Trim oldest chunks when over limit
      while (session.replaySize > MAX_REPLAY_BUFFER && session.replayBuffer.length > 1) {
        session.replaySize -= session.replayBuffer.shift()!.length
      }

      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IpcChannels.TERMINAL_DATA, id, data)
      }
    })

    proc.onExit(({ exitCode }) => {
      // Keep session in map (preserves replay buffer for persistence).
      // Mark as exited so write/resize skip it, but getReplayBuffer still works.
      session.exited = true
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IpcChannels.TERMINAL_EXIT, id, exitCode)
      }
    })

    this.sessions.set(id, session)
    return id
  }

  /** Get raw replay buffer for a terminal (for persistence across restarts) */
  getReplayBuffer(id: string): string | null {
    const session = this.sessions.get(id)
    if (!session || session.replayBuffer.length === 0) return null
    return session.replayBuffer.join('')
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
    const s = this.sessions.get(id)
    if (s && !s.exited) s.process.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id)
    if (s && !s.exited) s.process.resize(cols, rows)
  }

  close(id: string): void {
    const session = this.sessions.get(id)
    if (session && !session.exited) {
      session.process.kill()
      // Don't delete — onExit marks as exited, replay buffer preserved
    }
  }

  closeAll(): void {
    for (const [id] of this.sessions) {
      this.close(id)
    }
  }
}

export const ptyManager = new PtyManager()
