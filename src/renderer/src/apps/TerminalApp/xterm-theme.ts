import type { ITheme } from '@xterm/xterm'

/** ANSI colors shared across all themes — these don't change with theme */
const ansiColors = {
  red: '#ff6b6b',
  green: '#5eead4',
  yellow: '#fde047',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#5BA4A4',
  brightRed: '#ff8787',
  brightGreen: '#7ef4e4',
  brightYellow: '#fef08a',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#7ec8c8',
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
  const fg = cssVar('tx-main', '#cccccc')
  const accent = cssVar('accent-main', '#5eead4')
  const faint = cssVar('tx-faint', '#666666')

  return {
    background: bg,
    foreground: fg,
    cursor: accent,
    cursorAccent: bg,
    selectionBackground: 'rgba(91,164,164,0.3)',
    black: faint,
    white: fg,
    brightBlack: faint,
    brightWhite: '#ffffff',
    ...ansiColors,
  }
}

/** Static fallback for initial render before CSS vars are available */
export const xtermTheme: ITheme = {
  background: '#111111',
  foreground: '#cccccc',
  cursor: '#5eead4',
  cursorAccent: '#111111',
  selectionBackground: 'rgba(91,164,164,0.3)',
  black: '#1a1a1a',
  white: '#cccccc',
  brightBlack: '#555555',
  brightWhite: '#ffffff',
  ...ansiColors,
}
