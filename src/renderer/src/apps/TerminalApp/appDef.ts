import type { AppDefinition } from '../../../../shared/app-interface'
import { TerminalApp } from './index'

export const terminalAppDefinition: AppDefinition = {
  manifest: {
    id: 'terminal.app',
    name: 'Terminal',
    icon: 'terminal',
    version: '1.0.0',
    description: 'Integrated terminal with PTY',
    permissions: ['fs', 'shell'],
    builtin: true,
  },
  component: TerminalApp as React.FC<{ api: any }>,
  sidebar: {
    expandable: true,
  },
}
