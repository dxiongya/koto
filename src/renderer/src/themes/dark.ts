import type { ThemeDefinition } from './types'

export const darkTheme: ThemeDefinition = {
  id: 'dark',
  name: 'Dark',
  isDark: true,
  colors: {
    'bg-app': '#111111',
    'bg-sidebar': '#161616',
    'bg-hover': '#1a1a1a',
    'bg-active': '#222222',
    'bg-popover': '#1e1e1e',
    'bg-input': 'transparent',
    'tx-main': '#cccccc',
    'tx-muted': '#888888',
    'tx-faint': '#555555',
    'border-subtle': 'rgba(255, 255, 255, 0.08)',
    'border-strong': '#333333',
    'accent-main': '#5eead4',
    'accent-bg': '#2d3748',
  },
}
