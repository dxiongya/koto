import type { AppDefinition, AppSearchResult } from '../../../../shared/app-interface'
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
    // Search terminal sessions by title and CWD
    api.bus.provide('terminal.search', async (params: any) => {
      const query = params?.query?.toLowerCase()
      if (!query) return []
      const { terminalSessions } = useUIStore.getState()
      return terminalSessions
        .filter((s) => {
          const title = s.title.toLowerCase()
          const cwd = (s.cwd || '').toLowerCase()
          return title.includes(query) || cwd.includes(query)
        })
        .map((s, i): AppSearchResult => ({
          id: `terminal-${s.id}-${i}`,
          title: s.title,
          subtitle: s.cwd?.split('/').pop() || '',
          score: 60 - i * 5,
          source: 'terminal.app',
          icon: 'terminal',
          action: { type: 'navigate', app: 'terminal.app', state: { activeTerminalId: s.id } },
        }))
    })
  },
}
