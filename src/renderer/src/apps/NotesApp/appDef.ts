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

    // Walk notes/ recursively, return every file + folder so the search
    // handler below can match against names, not just contents.
    const walkNotesTree = async (
      dir: string,
    ): Promise<Array<{ name: string; path: string; isDirectory: boolean }>> => {
      const out: Array<{ name: string; path: string; isDirectory: boolean }> = []
      const stack = [dir]
      while (stack.length) {
        const current = stack.pop()!
        const children = await api.fs.readDir(current)
        for (const node of children) {
          out.push({ name: node.name, path: node.path, isDirectory: node.isDirectory })
          if (node.isDirectory) stack.push(node.path)
        }
      }
      return out
    }

    api.bus.provideTool({
      name: 'notes.search',
      appId: 'notes.app',
      description: 'Search notes by content, file name, and folder name. Returns matching lines plus name matches.',
      parameters: {
        query: { type: 'string', description: 'Search query (supports Chinese, English, etc.)', required: true },
      },
      handler: async (params) => {
        const query = params.query as string
        if (!query) return []
        const liteHome = getLiteHome()
        const notesRoot = `${liteHome}/notes`
        const ql = query.toLowerCase()

        // Run content search and tree walk in parallel — folder/file name
        // matches surface alongside line matches so prefixes like `n goduck`
        // can find a folder named "goduck" even when no file *contents*
        // mention it.
        const [contentRes, allEntries] = await Promise.all([
          window.api.search.content(query, [notesRoot], 20),
          walkNotesTree(notesRoot).catch(() => []),
        ])

        const out: any[] = []
        const seenPaths = new Set<string>()

        if (contentRes.ok) {
          contentRes.data.forEach((match: any, i: number) => {
            const relPath = match.filePath.replace(`${notesRoot}/`, '')
            const fileName = relPath.split('/').pop() || relPath
            const snippet = (match.content || '').trim().slice(0, 200)
            seenPaths.add(match.filePath)
            out.push({
              id: `note:${match.filePath}:${match.line}`,
              title: fileName,
              subtitle: relPath !== fileName ? relPath : `Line ${match.line}`,
              snippet,
              score: 100 - i,
              source: 'notes.app',
              icon: 'file-text',
              action: { type: 'open-file', path: match.filePath, line: match.line },
              file: relPath,
              path: match.filePath,
              line: match.line,
              content: match.content,
            })
          })
        }

        // Name matches — folder hits expand the group in the sidebar; file
        // hits open the file. Score below content matches so contents-first
        // ordering is preserved.
        let nameRank = 0
        for (const entry of allEntries) {
          if (seenPaths.has(entry.path)) continue
          // For files, only consider .md (notes are markdown); for folders,
          // include everything since groups can be arbitrary directories.
          if (!entry.isDirectory && !entry.name.endsWith('.md')) continue
          const rel = entry.path.replace(`${notesRoot}/`, '')
          if (!rel.toLowerCase().includes(ql) && !entry.name.toLowerCase().includes(ql)) continue
          seenPaths.add(entry.path)
          const displayName = entry.isDirectory ? entry.name : entry.name.replace(/\.md$/, '')
          out.push({
            id: `note-name:${entry.path}`,
            title: displayName,
            subtitle: entry.isDirectory ? `${rel}/` : rel,
            score: 50 - nameRank,
            source: 'notes.app',
            icon: entry.isDirectory ? 'folder' : 'file-text',
            action: entry.isDirectory
              ? { type: 'navigate', app: 'notes.app' }
              : { type: 'open-file', path: entry.path },
            file: rel,
            path: entry.path,
          })
          nameRank++
        }

        return out
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
