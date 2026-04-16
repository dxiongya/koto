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
        return res.data.map((match: any, i: number) => {
          const relPath = match.filePath.replace(`${liteHome}/notes/`, '')
          const fileName = relPath.split('/').pop() || relPath
          // content is the matched line — use it directly as snippet
          const snippet = (match.content || '').trim().slice(0, 200)
          return {
            id: `note:${match.filePath}:${match.line}`,
            title: fileName,
            subtitle: relPath !== fileName ? relPath : `Line ${match.line}`,
            snippet,
            score: 100 - i,
            source: 'notes.app',
            icon: 'file-text',
            action: { type: 'open-file', path: match.filePath, line: match.line },
            // MCP-only fields:
            file: relPath,
            path: match.filePath,
            line: match.line,
            content: match.content,
          }
        })
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

    api.bus.provideTool({
      name: 'notes.setMarkdownTheme',
      appId: 'notes.app',
      description: 'Set the markdown rendering theme for the notes editor. Can apply a built-in theme or create a custom theme from CSS. Built-in themes: default, github, serif, compact. CSS should override .markdown-body { --md-* } variables.',
      parameters: {
        themeId: { type: 'string', description: 'Built-in theme id (default/github/serif/compact) or existing custom theme filename' },
        css: { type: 'string', description: 'Raw CSS content for a new custom theme. Saves to themes/md/ and applies. Must override --md-* variables inside .markdown-body {}' },
        name: { type: 'string', description: 'Name for the custom theme (used as filename). Required when css is provided.' },
      },
      handler: async (params) => {
        const { useUIStore } = await import('../../store/useUIStore')
        const css = params.css as string | undefined
        const name = params.name as string | undefined
        const themeId = params.themeId as string | undefined

        if (css && name) {
          const fileName = name.endsWith('.css') ? name : `${name}.css`
          const themePath = `${getLiteHome()}/themes/md/${fileName}`
          await api.fs.writeFile(themePath, css)
          useUIStore.getState().setMarkdownTheme(fileName)
          return { success: true, themeId: fileName, path: themePath }
        }
        if (themeId) {
          useUIStore.getState().setMarkdownTheme(themeId)
          return { success: true, themeId }
        }
        return { success: false, error: 'Provide themeId or css+name' }
      },
    })
  },
}
