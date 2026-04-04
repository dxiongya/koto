import type { ITheme } from '@xterm/xterm'

/** High-contrast ANSI palette — matches iTerm2's default vibrancy */
const ansiColors = {
  red: '#ff5f56',
  green: '#2ee6a6',
  yellow: '#ffcc00',
  blue: '#5eaeff',
  magenta: '#cf6eff',
  cyan: '#00d4d4',
  brightRed: '#ff6e67',
  brightGreen: '#5af78e',
  brightYellow: '#f4f99d',
  brightBlue: '#7cc6ff',
  brightMagenta: '#e78eff',
  brightCyan: '#65f0f0',
}

/** Read a CSS custom property from :root, with fallback */
function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()
  return value || fallback
}

/** Build xterm theme from current CSS custom properties.
 *  Call this after theme changes to keep terminal in sync. */
export function buildXtermTheme(): ITheme {
  const bg = cssVar('bg-app', '#111111')
  const fg = cssVar('tx-main', '#e0e0e0')
  const accent = cssVar('accent-main', '#5eead4')

  return {
    background: bg,
    foreground: fg,
    cursor: accent,
    cursorAccent: bg,
    selectionBackground: 'rgba(91,164,164,0.35)',
    black: '#1a1a1a',
    white: fg,
    brightBlack: '#666666',
    brightWhite: '#ffffff',
    ...ansiColors,
  }
}

/** Static fallback for initial render before CSS vars are available */
export const xtermTheme: ITheme = {
  background: '#111111',
  foreground: '#e0e0e0',
  cursor: '#5eead4',
  cursorAccent: '#111111',
  selectionBackground: 'rgba(91,164,164,0.35)',
  black: '#1a1a1a',
  white: '#e0e0e0',
  brightBlack: '#666666',
  brightWhite: '#ffffff',
  ...ansiColors,
}
