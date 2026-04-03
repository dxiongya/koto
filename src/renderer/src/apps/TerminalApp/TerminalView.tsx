import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SerializeAddon } from '@xterm/addon-serialize'
import '@xterm/xterm/css/xterm.css'
import { buildXtermTheme } from './xterm-theme'

interface TerminalViewProps {
  terminalId: string
  initialBuffer?: string
}

export interface TerminalViewHandle {
  serialize: () => string | null
  focus: () => void
}

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(
  ({ terminalId, initialBuffer }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const termRef = useRef<Terminal | null>(null)
    const serializeAddonRef = useRef<SerializeAddon | null>(null)
    // Store initialBuffer in ref so it doesn't trigger re-mount
    const initialBufferRef = useRef(initialBuffer)

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
      fitAddon.fit()

      termRef.current = term
      serializeAddonRef.current = serializeAddon

      // Restore saved buffer if available
      if (initialBufferRef.current) {
        term.write(initialBufferRef.current)
      }

      // Send initial size
      window.api.terminal.resize(terminalId, term.cols, term.rows)

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

      // Debounced resize observer
      let resizeRaf = 0
      const resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(resizeRaf)
        resizeRaf = requestAnimationFrame(() => {
          try {
            fitAddon.fit()
            window.api.terminal.resize(terminalId, term.cols, term.rows)
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
