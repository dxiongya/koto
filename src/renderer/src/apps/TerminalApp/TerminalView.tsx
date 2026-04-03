import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SerializeAddon } from '@xterm/addon-serialize'
import '@xterm/xterm/css/xterm.css'
import { buildXtermTheme } from './xterm-theme'

interface TerminalViewProps {
  terminalId: string
}

export interface TerminalViewHandle {
  serialize: () => string | null
  focus: () => void
  /** Re-fit terminal to container size — call after display:none → visible transition */
  fit: () => void
}

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(
  ({ terminalId }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const termRef = useRef<Terminal | null>(null)
    const fitAddonRef = useRef<FitAddon | null>(null)
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
      focus: () => {
        termRef.current?.focus()
      },
      fit: () => {
        try {
          fitAddonRef.current?.fit()
          if (termRef.current) {
            window.api.terminal.resize(terminalId, termRef.current.cols, termRef.current.rows)
          }
        } catch { /* ignore */ }
      },
    }))

    useEffect(() => {
      if (!containerRef.current) return

      const term = new Terminal({
        theme: buildXtermTheme(),
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

      termRef.current = term
      fitAddonRef.current = fitAddon
      serializeAddonRef.current = serializeAddon

      // Only fit + resize PTY if container has real dimensions.
      // If display:none, skip — PTY keeps default 80x24.
      // ResizeObserver will send correct size when container becomes visible.
      try {
        fitAddon.fit()
        if (term.cols > 1 && term.rows > 1) {
          window.api.terminal.resize(terminalId, term.cols, term.rows)
        }
      } catch { /* container not visible yet, ignore */ }

      // User input → PTY
      term.onData((data) => {
        window.api.terminal.write(terminalId, data)
      })

      // PTY output → terminal (per-ID multiplexed listener, O(1) dispatch)
      const unsubData = window.api.terminal.onDataForId(terminalId, (data) => {
        term.write(data)
      })

      // Handle exit
      const unsubExit = window.api.terminal.onExitForId(terminalId, (exitCode) => {
        term.write(`\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`)
      })

      // Sync xterm theme when app theme changes (CSS custom properties on :root)
      const themeObserver = new MutationObserver(() => {
        term.options.theme = buildXtermTheme()
      })
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })

      // Debounced resize observer — only send valid sizes to PTY
      let resizeRaf = 0
      const resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(resizeRaf)
        resizeRaf = requestAnimationFrame(() => {
          try {
            fitAddon.fit()
            if (term.cols > 1 && term.rows > 1) {
              window.api.terminal.resize(terminalId, term.cols, term.rows)
            }
          } catch {
            // ignore fit errors during transitions
          }
        })
      })
      resizeObserver.observe(containerRef.current)

      return () => {
        cancelAnimationFrame(resizeRaf)
        resizeObserver.disconnect()
        themeObserver.disconnect()
        unsubData()
        unsubExit()
        term.dispose()
      }
    }, [terminalId]) // Only re-mount when terminalId changes

    return <div ref={containerRef} className="w-full h-full" />
  },
)

TerminalView.displayName = 'TerminalView'
