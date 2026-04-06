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
  component: NotesApp,
  sidebar: {
    expandable: true,
  },
  onRegister: (api) => {
    const getLiteHome = () => api.dataDir.replace('/apps/notes.app/data', '')

    // ── Legacy capabilities (backward compat) ──
    api.bus.provide('notes.list', async () => {
      const res = await api.fs.readDir(`${getLiteHome()}/notes`)
      return res
    })

    // ── MCP-ready tools (provideTool with metadata) ──

    api.bus.provideTool({
      name: 'notes.search',
      appId: 'notes.app',
      description: 'Search notes by content. Returns matching lines with file paths.',
      parameters: {
        query: { type: 'string', description: 'Search query (supports Chinese, English, etc.)', required: true },
      },
      handler: async (params) => {
        const query = params.query as string
        if (!query) return []
        const liteHome = getLiteHome()
        const res = await window.api.search.content(query, [`${liteHome}/notes`], 20)
        if (!res.ok) return []
        return res.data.map((match: any) => ({
          file: match.filePath.replace(`${liteHome}/notes/`, ''),
          path: match.filePath,
          line: match.line,
          content: match.content,
        }))
      },
    })

    api.bus.provideTool({
      name: 'notes.read',
      appId: 'notes.app',
      description: 'Read the full content of a note file.',
      parameters: {
        path: { type: 'string', description: 'File path (relative to notes/ or absolute)', required: true },
      },
      handler: async (params) => {
        let filePath = params.path as string
        if (!filePath.startsWith('/')) filePath = `${getLiteHome()}/notes/${filePath}`
        const content = await api.fs.readFile(filePath)
        return { path: filePath, content }
      },
    })

    api.bus.provideTool({
      name: 'notes.write',
      appId: 'notes.app',
      description: 'Write or update content of a note file. Creates the file if it does not exist.',
      parameters: {
        path: { type: 'string', description: 'File path (relative to notes/ or absolute)', required: true },
        content: { type: 'string', description: 'Full markdown content to write', required: true },
      },
      handler: async (params) => {
        let filePath = params.path as string
        if (!filePath.startsWith('/')) filePath = `${getLiteHome()}/notes/${filePath}`
        await api.fs.writeFile(filePath, params.content as string)
        return { path: filePath, success: true }
      },
    })

    api.bus.provideTool({
      name: 'notes.create',
      appId: 'notes.app',
      description: 'Create a new note with the given title and optional content.',
      parameters: {
        title: { type: 'string', description: 'Note title (becomes filename)', required: true },
        content: { type: 'string', description: 'Initial markdown content (optional)' },
        folder: { type: 'string', description: 'Subfolder within notes/ (optional)' },
      },
      handler: async (params) => {
        const title = params.title as string
        const content = (params.content as string) || `# ${title}\n\n`
        const folder = params.folder ? `${params.folder}/` : ''
        const filePath = `${getLiteHome()}/notes/${folder}${title}.md`
        await api.fs.writeFile(filePath, content)
        return { path: filePath, success: true }
      },
    })

    api.bus.provideTool({
      name: 'notes.listFiles',
      appId: 'notes.app',
      description: 'List all note files and folders.',
      parameters: {
        folder: { type: 'string', description: 'Subfolder to list (optional, defaults to root)' },
      },
      handler: async (params) => {
        const folder = (params.folder as string) || ''
        const dir = `${getLiteHome()}/notes${folder ? '/' + folder : ''}`
        const files = await api.fs.readDir(dir)
        return files.map((f: any) => ({ name: f.name, path: f.path, isDirectory: f.isDirectory }))
      },
    })
  },
}
