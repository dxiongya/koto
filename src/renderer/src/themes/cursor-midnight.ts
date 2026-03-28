import type { ThemeDefinition } from './types'

// Based on Cursor "Dark Midnight" theme
export const cursorMidnightTheme: ThemeDefinition = {
  id: 'cursor-midnight',
  name: 'Midnight',
  group: 'Cursor',
  isDark: true,
  colors: {
    'bg-app': '#1e2127',
    'bg-sidebar': '#191c22',
    'bg-hover': 'rgba(39, 44, 54, 0.6)',
    'bg-active': '#21242b',
    'bg-popover': '#191c22',
    'bg-input': 'rgba(39, 44, 54, 0.33)',
    'tx-main': '#7b88a1',
    'tx-muted': '#4c566a',
    'tx-faint': 'rgba(123, 136, 161, 0.26)',
    'tx-active': '#eceff4',
    'border-subtle': 'rgba(255, 255, 255, 0.05)',
    'border-strong': 'rgba(255, 255, 255, 0.1)',
    'accent-main': '#88C0D0',
    'accent-bg': 'rgba(136, 192, 208, 0.12)',
    'status-success': '#3FA266',
    'status-error': '#E34671',
    'status-warning': '#F1B467',
  },
}
