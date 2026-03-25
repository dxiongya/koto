// ── Theme Definition ──

export interface ThemeColors {
  'bg-app': string
  'bg-sidebar': string
  'bg-hover': string
  'bg-active': string
  'bg-popover': string
  'bg-input': string
  'tx-main': string
  'tx-muted': string
  'tx-faint': string
  'border-subtle': string
  'border-strong': string
  'tx-active': string
  'accent-main': string
  'accent-bg': string
  // Status colors
  'status-success': string
  'status-error': string
  'status-warning': string
}

export interface ThemeDefinition {
  id: string
  name: string
  group: string
  isDark: boolean
  colors: ThemeColors
}

// ── Font Definition ──

export type FontId = 'sf-mono' | 'geist-mono' | 'geist-sans' | 'geist-pixel'

export interface FontDefinition {
  id: FontId
  name: string
  family: string
  isMonospace: boolean
}
