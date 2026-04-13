/**
 * useMarkdownTheme — injects the active markdown theme CSS into the editor container.
 *
 * Built-in themes are bundled via ?raw imports.
 * User themes are loaded from {liteHome}/themes/md/{filename}.
 */
import { useEffect, useRef } from 'react'
import { useUIStore } from '../../../store/useUIStore'
import { builtinMdThemes } from '../themes'

export function useMarkdownTheme(containerRef: React.RefObject<HTMLElement | null>) {
  const themeId = useUIStore((s) => s.markdownTheme)
  const liteHome = useUIStore((s) => s.liteHome)
  const styleRef = useRef<HTMLStyleElement | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Create <style> tag on first use
    if (!styleRef.current) {
      styleRef.current = document.createElement('style')
      styleRef.current.setAttribute('data-md-theme', 'true')
      container.prepend(styleRef.current)
    }

    const styleEl = styleRef.current

    // Built-in theme?
    const builtin = builtinMdThemes.find((t) => t.id === themeId)
    if (builtin) {
      styleEl.textContent = builtin.css
      return
    }

    // User theme — read from disk
    if (liteHome && themeId) {
      const themePath = `${liteHome}/themes/md/${themeId}`
      window.api.fs.readFile(themePath).then((res) => {
        if (res.ok && styleEl) {
          styleEl.textContent = res.data
        }
      }).catch(() => {
        // Fallback to empty (uses variable defaults)
        styleEl.textContent = ''
      })
    } else {
      styleEl.textContent = ''
    }
  }, [themeId, liteHome, containerRef])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (styleRef.current?.parentNode) {
        styleRef.current.parentNode.removeChild(styleRef.current)
        styleRef.current = null
      }
    }
  }, [])
}
