import type { AppDefinition } from '../../../../shared/app-interface'
import { TerminalApp } from './index'
import { useUIStore } from '../../store/useUIStore'

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
  component: TerminalApp,
  sidebar: {
    expandable: true,
  },
  onRegister: (api) => {
    api.bus.provideTool({
      name: 'terminal.search',
      appId: 'terminal.app',
      description: 'Search terminal sessions by title or working directory.',
      parameters: {
        query: { type: 'string', description: 'Search query', required: true },
      },
      handler: async (params) => {
        const query = (params.query as string)?.toLowerCase()
        if (!query) return []
        const { terminalSessions } = useUIStore.getState()
        return terminalSessions
          .filter((s) => s.title.toLowerCase().includes(query) || (s.cwd || '').toLowerCase().includes(query))
          .map((s) => ({ id: s.id, title: s.title, cwd: s.cwd }))
      },
    })
  },
}
