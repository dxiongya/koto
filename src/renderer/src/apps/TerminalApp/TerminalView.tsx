import { useCallback, useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { SerializeAddon } from '@xterm/addon-serialize'
import '@xterm/xterm/css/xterm.css'
import { buildXtermTheme } from './xterm-theme'
import { getResourcePayload, hasResourceType } from '../../layouts/resourceDrag'

/** POSIX single-quote escape: `wrap in '…'` and replace any `'` with `'\''`. */
function shellEscape(s: string): string {
  if (!s) return "''"
  if (/^[A-Za-z0-9_\-./:@+=]+$/.test(s)) return s
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

interface TerminalViewProps {
  terminalId: string
  replayBuffer?: string
}

export interface TerminalViewHandle {
  serialize: () => string | null
  focus: () => void
  fit: () => void
  /** Force re-render all visible content (fixes garbled display after display:none) */
  refresh: () => void
}

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(
  ({ terminalId, replayBuffer }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const termRef = useRef<Terminal | null>(null)
    const fitAddonRef = useRef<FitAddon | null>(null)
    const serializeAddonRef = useRef<SerializeAddon | null>(null)
    const replayBufferRef = useRef(replayBuffer)
    const replayedRef = useRef(false)

    useImperativeHandle(ref, () => ({
      serialize: () => {
        if (!termRef.current || !serializeAddonRef.current) return null
        try { return serializeAddonRef.current.serialize() } catch { return null }
      },
      focus: () => { termRef.current?.focus() },
      refresh: () => {
        if (termRef.current) {
          termRef.current.refresh(0, termRef.current.rows - 1)
        }
      },
      fit: () => {
        const el = containerRef.current
        if (!el) return
        const { width, height } = el.getBoundingClientRect()
        if (width < 2 || height < 2) return
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
        // NO allowTransparency — it disables WebGL renderer
        scrollback: 5000,
        // Performance: faster rendering
        fastScrollModifier: 'alt',
        smoothScrollDuration: 0, // disable smooth scroll for speed
      })

      const fitAddon = new FitAddon()
      const serializeAddon = new SerializeAddon()
      term.loadAddon(fitAddon)
      term.loadAddon(serializeAddon)

      term.open(containerRef.current)

      // Enable WebGL renderer — 5-10x faster than canvas 2D
      try {
        const webglAddon = new WebglAddon()
        webglAddon.onContextLoss(() => {
          webglAddon.dispose() // fallback to canvas on context loss
        })
        term.loadAddon(webglAddon)
      } catch {
        // WebGL not available, canvas fallback is fine
      }

      termRef.current = term
      fitAddonRef.current = fitAddon
      serializeAddonRef.current = serializeAddon

      // Initial fit
      try {
        fitAddon.fit()
        if (term.cols > 1 && term.rows > 1) {
          window.api.terminal.resize(terminalId, term.cols, term.rows)
        }
      } catch { /* container not visible yet */ }

      // User input → PTY
      term.onData((data) => {
        window.api.terminal.write(terminalId, data)
      })

      // Intercept Cmd+V for notes metadata
      term.attachCustomKeyEventHandler((e) => {
        if (e.type === 'keydown' && e.metaKey && e.key === 'v') {
          const sourceFile = (window as any).__liteClipboardSource as string | undefined
          if (sourceFile) {
            navigator.clipboard.readText().then((text) => {
              if (text) {
                const quotedPath = sourceFile.includes(' ') ? `"${sourceFile}"` : sourceFile
                window.api.terminal.write(terminalId, `# from: ${quotedPath}\n${text}`)
              }
              ;(window as any).__liteClipboardSource = undefined
            })
            return false
          }
        }
        return true
      })

      // PTY output → terminal (per-ID multiplexed, O(1) dispatch)
      const unsubData = window.api.terminal.onDataForId(terminalId, (data) => {
        term.write(data)
      })

      const unsubExit = window.api.terminal.onExitForId(terminalId, (exitCode) => {
        term.write(`\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`)
      })

      // Theme sync on app theme change
      const themeObserver = new MutationObserver(() => {
        term.options.theme = buildXtermTheme()
      })
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })

      // Resize observer — skip hidden containers
      let resizeRaf = 0
      const container = containerRef.current!
      const resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(resizeRaf)
        resizeRaf = requestAnimationFrame(() => {
          const { width, height } = container.getBoundingClientRect()
          if (width < 2 || height < 2) return
          try {
            fitAddon.fit()
            window.api.terminal.resize(terminalId, term.cols, term.rows)
            // Replay buffer after first successful fit
            if (!replayedRef.current && replayBufferRef.current) {
              replayedRef.current = true
              term.write(replayBufferRef.current + '\x1b[?25h')
              replayBufferRef.current = undefined
            }
          } catch { /* ignore */ }
        })
      })
      resizeObserver.observe(container)

      return () => {
        cancelAnimationFrame(resizeRaf)
        resizeObserver.disconnect()
        themeObserver.disconnect()
        unsubData()
        unsubExit()
        term.dispose()
      }
    }, [terminalId])

    const [isDragOver, setIsDragOver] = useState(false)

    const handleDragOver = useCallback((e: React.DragEvent) => {
      if (!hasResourceType(e.dataTransfer.types)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setIsDragOver(true)
    }, [])

    const handleDragLeave = useCallback((e: React.DragEvent) => {
      const related = e.relatedTarget as Node | null
      if (!containerRef.current?.contains(related)) setIsDragOver(false)
    }, [])

    const handleDrop = useCallback(
      (e: React.DragEvent) => {
        const r = getResourcePayload(e.dataTransfer)
        // Plain-text fallback (e.g., text files from OS)
        if (!r) {
          const path =
            e.dataTransfer.getData('text/uri-list') ||
            e.dataTransfer.getData('text/plain')
          if (path) {
            e.preventDefault()
            setIsDragOver(false)
            window.api.terminal.write(terminalId, shellEscape(path.trim()) + ' ')
            termRef.current?.focus()
          }
          return
        }
        e.preventDefault()
        setIsDragOver(false)

        let text = ''
        if (r.kind === 'file') {
          text = shellEscape(r.path) + ' '
        } else if (r.kind === 'terminal') {
          // Inserting a terminal ref into a terminal = just its title as a comment hint.
          text = `# ${r.title || 'terminal'} (${r.sessionId})`
        } else if (r.kind === 'collector-item') {
          if (r.url) {
            text = shellEscape(r.url) + ' '
          } else if (r.assetPath) {
            text = shellEscape(`collected/${r.assetPath}`) + ' '
          } else if (r.note) {
            text = shellEscape(r.note) + ' '
          } else {
            text = shellEscape(r.title || r.itemId) + ' '
          }
        }
        if (text) {
          window.api.terminal.write(terminalId, text)
          termRef.current?.focus()
        }
      },
      [terminalId],
    )

    return (
      <div
        ref={containerRef}
        className={`w-full h-full relative ${
          isDragOver ? 'ring-1 ring-inset ring-accent-main/40' : ''
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      />
    )
  },
)

TerminalView.displayName = 'TerminalView'
