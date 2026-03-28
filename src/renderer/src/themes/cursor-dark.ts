import type { ThemeDefinition } from './types'

// Based on Cursor's "Anysphere Dark" theme
// Uses alpha-channel whites for a cohesive transparent feel
export const cursorDarkTheme: ThemeDefinition = {
  id: 'cursor-dark',
  name: 'Dark',
  group: 'Cursor',
  isDark: true,
  colors: {
    'bg-app': '#181818',
    'bg-sidebar': '#141414',
    'bg-hover': 'rgba(228, 228, 228, 0.07)',
    'bg-active': 'rgba(228, 228, 228, 0.12)',
    'bg-popover': '#141414',
    'bg-input': 'rgba(228, 228, 228, 0.04)',
    'tx-main': 'rgba(228, 228, 228, 0.92)',
    'tx-muted': 'rgba(228, 228, 228, 0.55)',
    'tx-faint': 'rgba(228, 228, 228, 0.26)',
    'tx-active': 'rgba(228, 228, 228, 0.92)',
    'border-subtle': 'rgba(228, 228, 228, 0.07)',
    'border-strong': 'rgba(228, 228, 228, 0.12)',
    'accent-main': '#88C0D0',
    'accent-bg': 'rgba(136, 192, 208, 0.12)',
    'status-success': '#3FA266',
    'status-error': '#E34671',
    'status-warning': '#F1B467',
  },
}
