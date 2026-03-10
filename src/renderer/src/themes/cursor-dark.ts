import type { ThemeDefinition } from './types'

export const cursorDarkTheme: ThemeDefinition = {
  id: 'cursor-dark',
  name: 'Dark',
  group: 'Cursor',
  isDark: true,
  colors: {
    'bg-app': '#1e1e1e',
    'bg-sidebar': '#181818',
    'bg-hover': '#2a2a2a',
    'bg-active': '#37373d',
    'bg-popover': '#252526',
    'bg-input': '#3c3c3c',
    'tx-main': '#d4d4d4',
    'tx-muted': '#858585',
    'tx-faint': '#5a5a5a',
    'border-subtle': 'rgba(255, 255, 255, 0.06)',
    'border-strong': '#3c3c3c',
    'accent-main': '#007acc',
    'accent-bg': '#264f78',
  },
}
