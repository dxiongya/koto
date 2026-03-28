import type { ThemeDefinition } from './types'

// Based on Cursor "Dark High Contrast" theme
export const cursorHighContrastTheme: ThemeDefinition = {
  id: 'cursor-high-contrast',
  name: 'High Contrast',
  group: 'Cursor',
  isDark: true,
  colors: {
    'bg-app': '#0A0A0A',
    'bg-sidebar': '#0A0A0A',
    'bg-hover': 'rgba(42, 42, 42, 0.6)',
    'bg-active': '#434C5E',
    'bg-popover': '#0A0A0A',
    'bg-input': 'rgba(42, 42, 42, 0.33)',
    'tx-main': '#CCCCCC',
    'tx-muted': '#505050',
    'tx-faint': 'rgba(204, 204, 204, 0.26)',
    'tx-active': '#ECEFF4',
    'border-subtle': 'rgba(255, 255, 255, 0.1)',
    'border-strong': 'rgba(255, 255, 255, 0.2)',
    'accent-main': '#88C0D0',
    'accent-bg': 'rgba(136, 192, 208, 0.15)',
    'status-success': '#3FA266',
    'status-error': '#E34671',
    'status-warning': '#F1B467',
  },
}
