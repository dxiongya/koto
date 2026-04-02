import type { AppDefinition } from '../../../../shared/app-interface'
import { NotesApp } from './index'

export const notesAppDefinition: AppDefinition = {
  manifest: {
    id: 'notes.app',
    name: 'Notes',
    icon: 'file-text',
    version: '1.0.0',
    description: 'Rich text notes with Lexical editor',
    permissions: ['fs', 'state'],
    builtin: true,
  },
  component: NotesApp as React.FC<{ api: any }>,
  sidebar: {
    expandable: true,
  },
  onRegister: (api) => {
    // Provide capabilities on the bus
    api.bus.provide('notes.list', async () => {
      const liteHome = api.dataDir.replace('/apps/notes.app/data', '')
      const res = await api.fs.readDir(`${liteHome}/notes`)
      return res
    })
  },
}
