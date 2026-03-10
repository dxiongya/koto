import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SerializeAddon } from '@xterm/addon-serialize'
import '@xterm/xterm/css/xterm.css'
import { xtermTheme } from './xterm-theme'

interface TerminalViewProps {
  terminalId: string
  initialBuffer?: string
}

export interface TerminalViewHandle {
  serialize: () => string | null
}

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(
  ({ terminalId, initialBuffer }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const termRef = useRef<Terminal | null>(null)
    const serializeAddonRef = useRef<SerializeAddon | null>(null)

    useImperativeHandle(ref, () => ({
      serialize: () => {
        if (!termRef.current || !serializeAddonRef.current) return null
        try {
          return serializeAddonRef.current.serialize()
        } catch {
          return null
        }
      },
    }))

    useEffect(() => {
      if (!containerRef.current) return

      const term = new Terminal({
        theme: xtermTheme,
        fontSize: 13,
        fontFamily: "'SF Mono', 'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
        cursorBlink: true,
        cursorStyle: 'bar',
        allowTransparency: true,
        scrollback: 5000,
      })

      const fitAddon = new FitAddon()
      const serializeAddon = new SerializeAddon()
      term.loadAddon(fitAddon)
      term.loadAddon(serializeAddon)

      term.open(containerRef.current)
      fitAddon.fit()

      termRef.current = term
      serializeAddonRef.current = serializeAddon

      // Restore saved buffer if available
      if (initialBuffer) {
        term.write(initialBuffer)
      }

      // Send initial size
      window.api.terminal.resize(terminalId, term.cols, term.rows)

      // User input → PTY
      term.onData((data) => {
        window.api.terminal.write(terminalId, data)
      })

      // PTY output → terminal
      const unsubData = window.api.terminal.onData((id, data) => {
        if (id === terminalId) {
          term.write(data)
        }
      })

      // Handle exit
      const unsubExit = window.api.terminal.onExit((id, exitCode) => {
        if (id === terminalId) {
          term.write(`\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`)
        }
      })

      // Resize observer
      const resizeObserver = new ResizeObserver(() => {
        try {
          fitAddon.fit()
          window.api.terminal.resize(terminalId, term.cols, term.rows)
        } catch {
          // ignore fit errors during transitions
        }
      })
      resizeObserver.observe(containerRef.current)

      return () => {
        resizeObserver.disconnect()
        unsubData()
        unsubExit()
        term.dispose()
      }
    }, [terminalId, initialBuffer])

    return <div ref={containerRef} className="w-full h-full" />
  },
)

TerminalView.displayName = 'TerminalView'
