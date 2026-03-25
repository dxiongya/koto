import type { ThemeDefinition } from './types'

export const darkTheme: ThemeDefinition = {
  id: 'dark',
  name: 'Dark',
  group: 'Lite',
  isDark: true,
  colors: {
    'bg-app': '#111111',
    'bg-sidebar': '#161616',
    'bg-hover': '#1a1a1a',
    'bg-active': '#222222',
    'bg-popover': '#1e1e1e',
    'bg-input': 'transparent',
    'tx-main': '#e0e0e0',
    'tx-muted': '#999999',
    'tx-faint': '#666666',
    'border-subtle': 'rgba(255, 255, 255, 0.08)',
    'border-strong': '#333333',
    'tx-active': '#5eead4',
    'accent-main': '#5eead4',
    'accent-bg': '#2d3748',
    'status-success': '#4ade80',
    'status-error': '#f87171',
    'status-warning': '#fbbf24',
  },
}
