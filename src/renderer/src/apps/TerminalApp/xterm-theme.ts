import type { ITheme } from '@xterm/xterm'

// ── Terminal Color Schemes ──

export type TerminalThemeId = 'snazzy' | 'tokyo-night' | 'dracula' | 'catppuccin' | 'one-dark'

export interface TerminalThemeOption {
  id: TerminalThemeId
  name: string
  colors: Omit<ITheme, 'background' | 'foreground' | 'cursor' | 'cursorAccent' | 'selectionBackground'>
}

const schemes: Record<TerminalThemeId, TerminalThemeOption> = {
  'snazzy': {
    id: 'snazzy',
    name: 'Snazzy',
    colors: {
      black: '#282a36',
      red: '#ff5c57',
      green: '#5af78e',
      yellow: '#f3f99d',
      blue: '#57c7ff',
      magenta: '#ff6ac1',
      cyan: '#9aedfe',
      white: '#f1f1f0',
      brightBlack: '#686868',
      brightRed: '#ff5c57',
      brightGreen: '#5af78e',
      brightYellow: '#f3f99d',
      brightBlue: '#57c7ff',
      brightMagenta: '#ff6ac1',
      brightCyan: '#9aedfe',
      brightWhite: '#eff0eb',
    },
  },
  'tokyo-night': {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    colors: {
      black: '#15161e',
      red: '#f7768e',
      green: '#9ece6a',
      yellow: '#e0af68',
      blue: '#7aa2f7',
      magenta: '#bb9af7',
      cyan: '#7dcfff',
      white: '#a9b1d6',
      brightBlack: '#414868',
      brightRed: '#ff899d',
      brightGreen: '#9fe044',
      brightYellow: '#faba4a',
      brightBlue: '#8db0ff',
      brightMagenta: '#c7a9ff',
      brightCyan: '#a4daff',
      brightWhite: '#c0caf5',
    },
  },
  'dracula': {
    id: 'dracula',
    name: 'Dracula',
    colors: {
      black: '#000000',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#bfbfbf',
      brightBlack: '#4d4d4d',
      brightRed: '#ff6e67',
      brightGreen: '#5af78e',
      brightYellow: '#f4f99d',
      brightBlue: '#caa9fa',
      brightMagenta: '#ff92d0',
      brightCyan: '#9aedfe',
      brightWhite: '#e6e6e6',
    },
  },
  'catppuccin': {
    id: 'catppuccin',
    name: 'Catppuccin',
    colors: {
      black: '#45475a',
      red: '#f38ba8',
      green: '#a6e3a1',
      yellow: '#f9e2af',
      blue: '#89b4fa',
      magenta: '#f5c2e7',
      cyan: '#94e2d5',
      white: '#bac2de',
      brightBlack: '#585b70',
      brightRed: '#f38ba8',
      brightGreen: '#a6e3a1',
      brightYellow: '#f9e2af',
      brightBlue: '#89b4fa',
      brightMagenta: '#f5c2e7',
      brightCyan: '#94e2d5',
      brightWhite: '#a6adc8',
    },
  },
  'one-dark': {
    id: 'one-dark',
    name: 'One Dark',
    colors: {
      black: '#3f4451',
      red: '#e05561',
      green: '#8cc265',
      yellow: '#d18f52',
      blue: '#4aa5f0',
      magenta: '#c162de',
      cyan: '#42b3c2',
      white: '#d7dae0',
      brightBlack: '#4f5666',
      brightRed: '#ff616e',
      brightGreen: '#a5e075',
      brightYellow: '#f0a45d',
      brightBlue: '#4dc4ff',
      brightMagenta: '#de73ff',
      brightCyan: '#4cd1e0',
      brightWhite: '#e6e6e6',
    },
  },
}

export const terminalThemes = Object.values(schemes)
export const DEFAULT_TERMINAL_THEME: TerminalThemeId = 'snazzy'

/** ANSI colors for light backgrounds — readable contrast on white/cream */
const lightAnsiColors: Omit<ITheme, 'background' | 'foreground' | 'cursor' | 'cursorAccent' | 'selectionBackground'> = {
  black: '#3c3836',
  red: '#cc241d',
  green: '#157a3e',
  yellow: '#b57614',
  blue: '#076678',
  magenta: '#8f3f71',
  cyan: '#427b58',
  white: '#7c6f64',
  brightBlack: '#928374',
  brightRed: '#9d0006',
  brightGreen: '#79740e',
  brightYellow: '#b57614',
  brightBlue: '#076678',
  brightMagenta: '#8f3f71',
  brightCyan: '#427b58',
  brightWhite: '#3c3836',
}

/** Read a CSS custom property from :root, with fallback */
function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()
  return value || fallback
}

/** Detect if the current theme is dark by checking the :root class */
function isCurrentThemeDark(): boolean {
  return document.documentElement.classList.contains('dark')
}

/** Build xterm theme: app colors (bg/fg/cursor) + selected ANSI color scheme */
export function buildXtermTheme(schemeId?: TerminalThemeId): ITheme {
  const isDark = isCurrentThemeDark()
  const bg = cssVar('bg-app', isDark ? '#111111' : '#FCFBF9')
  const fg = cssVar('tx-main', isDark ? '#e0e0e0' : '#2b2b2b')
  const accent = cssVar('accent-main', isDark ? '#5eead4' : '#2b8a73')

  // Use light-friendly ANSI colors when on light background
  const ansiColors = isDark
    ? (schemes[schemeId ?? DEFAULT_TERMINAL_THEME] ?? schemes[DEFAULT_TERMINAL_THEME]).colors
    : lightAnsiColors

  return {
    background: bg,
    foreground: fg,
    cursor: accent,
    cursorAccent: bg,
    selectionBackground: isDark ? 'rgba(91,164,164,0.35)' : 'rgba(43,138,115,0.20)',
    ...ansiColors,
  }
}
