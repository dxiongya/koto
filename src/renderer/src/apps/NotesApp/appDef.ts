import type { AppDefinition, AppSearchResult } from '../../../../shared/app-interface'
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
  component: NotesApp,
  sidebar: {
    expandable: true,
  },
  onRegister: (api) => {
    const getLiteHome = () => api.dataDir.replace('/apps/notes.app/data', '')

    // List notes files
    api.bus.provide('notes.list', async () => {
      const res = await api.fs.readDir(`${getLiteHome()}/notes`)
      return res
    })

    // Search notes content — returns AppSearchResult[]
    api.bus.provide('notes.search', async (params: any) => {
      const query = params?.query
      if (!query) return []
      const liteHome = getLiteHome()
      const res = await window.api.search.content(query, [`${liteHome}/notes`], 20)
      if (!res.ok) return []
      return res.data.map((match: any, i: number): AppSearchResult => ({
        id: `notes-${match.filePath}-${match.line}-${i}`,
        title: match.filePath.replace(`${liteHome}/notes/`, ''),
        subtitle: `L${match.line}`,
        snippet: match.content,
        score: Math.max(10, 80 - i * 3), // position-based scoring
        source: 'notes.app',
        icon: 'file-text',
        action: { type: 'open-file', path: match.filePath, line: match.line },
      }))
    })
  },
}
