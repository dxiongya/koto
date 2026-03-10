import type { ThemeDefinition } from './types'

export const cursorLightTheme: ThemeDefinition = {
  id: 'cursor-light',
  name: 'Light',
  group: 'Cursor',
  isDark: false,
  colors: {
    'bg-app': '#ffffff',
    'bg-sidebar': '#f3f3f3',
    'bg-hover': '#e8e8e8',
    'bg-active': '#d6ebff',
    'bg-popover': '#ffffff',
    'bg-input': '#ffffff',
    'tx-main': '#333333',
    'tx-muted': '#717171',
    'tx-faint': '#999999',
    'border-subtle': 'rgba(0, 0, 0, 0.08)',
    'border-strong': '#d4d4d4',
    'accent-main': '#007acc',
    'accent-bg': '#d6ebff',
  },
}
