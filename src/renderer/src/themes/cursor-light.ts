import type { ThemeDefinition } from './types'

// Based on Cursor's "Cursor Light" theme
// Uses alpha-channel blacks for a cohesive transparent feel
export const cursorLightTheme: ThemeDefinition = {
  id: 'cursor-light',
  name: 'Light',
  group: 'Cursor',
  isDark: false,
  colors: {
    'bg-app': '#FCFCFC',
    'bg-sidebar': '#F3F3F3',
    'bg-hover': 'rgba(20, 20, 20, 0.07)',
    'bg-active': 'rgba(20, 20, 20, 0.07)',
    'bg-popover': '#F3F3F3',
    'bg-input': '#FCFCFC',
    'tx-main': 'rgba(20, 20, 20, 0.92)',
    'tx-muted': 'rgba(20, 20, 20, 0.68)',
    'tx-faint': 'rgba(20, 20, 20, 0.26)',
    'tx-active': 'rgba(20, 20, 20, 0.92)',
    'border-subtle': 'rgba(20, 20, 20, 0.07)',
    'border-strong': 'rgba(20, 20, 20, 0.15)',
    'accent-main': '#3C7CAB',
    'accent-bg': 'rgba(60, 124, 171, 0.1)',
  },
}
