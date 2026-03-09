import type { ThemeDefinition } from './types'

export const lightTheme: ThemeDefinition = {
  id: 'light',
  name: 'Light',
  isDark: false,
  colors: {
    'bg-app': '#FCFBF9',
    'bg-sidebar': '#F7F6F3',
    'bg-hover': 'rgba(0, 0, 0, 0.05)',
    'bg-active': '#E8F4F2',
    'bg-popover': '#FFFFFF',
    'bg-input': 'rgba(0, 0, 0, 0.03)',
    'tx-main': '#2b2b2b',
    'tx-muted': '#666666',
    'tx-faint': '#888888',
    'border-subtle': 'rgba(0, 0, 0, 0.08)',
    'border-strong': 'rgba(0, 0, 0, 0.16)',
    'accent-main': '#2b8a73',
    'accent-bg': '#E8F4F2',
  },
}
