import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useUIStore } from '../../store/useUIStore'
import { usePaneActiveFile } from '../../layouts/PaneContext'
import { LexicalEditor } from './LexicalEditor'
import { FileText } from 'lucide-react'

// ── Auto-rename helpers ───────────────────────────────────────────────
// Pull a human title out of the first H1 heading (preferred), else the
// first non-blank, non-meta line. Returns null if nothing usable yet —
// caller skips the rename.
function deriveTitleFromMarkdown(md: string): string | null {
  const lines = md.split('\n')
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    // Skip frontmatter fences and rule-only lines.
    if (line === '---') continue
    if (/^-{3,}$/.test(line) || /^_{3,}$/.test(line) || /^\*{3,}$/.test(line)) continue
    // Skip image-only lines and unfinished heading markers (`#`, `##` with
    // no text after) — those happen mid-edit and would otherwise produce
    // garbage filenames like "#.md".
    if (/^!\[/.test(line)) continue
    if (/^#+\s*$/.test(line)) continue

    // First proper H1 wins.
    const h1 = line.match(/^#\s+(.+)$/)
    if (h1) return h1[1].trim()
    // H2/H3/... accepted as a fallback.
    const h = line.match(/^#{2,6}\s+(.+)$/)
    if (h) return h[1].trim()
    // Plain text fallback: strip leading bullet/number prefixes, inline
    // formatting markers, and link wrappers. Then return.
    const cleaned = line
      .replace(/^#+\s*/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+\.\s+/, '')
      .replace(/^>\s*/, '')
      .replace(/\[(.*?)\]\([^)]*\)/g, '$1')
      .replace(/[*_`~]/g, '')
      .trim()
    return cleaned || null
  }
  return null
}

// Returns true if the candidate filename has at least one "word" character
// (latin letter, digit, or CJK ideograph) — guards against renaming a file
// to pure punctuation like "#" or "...".
function hasMeaningfulCharacter(s: string): boolean {
  return /[\p{L}\p{N}一-鿿]/u.test(s)
}

// Strip filesystem-illegal characters and tidy whitespace.
function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/^[#>\-*+]+\s*/, '')
    .replace(/\.+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export const NotesApp: React.FC = () => {
  const showCommandPalette = useUIStore((s) => s.showCommandPalette)
  // Read from the pane's own state — each notes pane shows an independent file.
  const [activeFilePath, setPaneActiveFile] = usePaneActiveFile()
  const liteHome = useUIStore((s) => s.liteHome)
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [editorKey, setEditorKey] = useState(0)
  const lastEditorWriteRef = useRef(0) // timestamp of last editor save — to ignore own writes

  // Load file content
  useEffect(() => {
    if (!activeFilePath) {
      setContent(null)
      return
    }
    setLoading(true)
    window.api.fs.readFile(activeFilePath).then((res) => {
      if (res.ok) {
        setContent(res.data)
      } else {
        setContent('')
      }
      setLoading(false)
      setEditorKey((k) => k + 1)
    })
  }, [activeFilePath])

  // Reload editor when the active file is externally modified (e.g., by manual edit outside app)
  useEffect(() => {
    if (!activeFilePath) return
    const unsub = window.api.fs.onWatchEvent((event) => {
      if (event.type !== 'update' || event.path !== activeFilePath) return
      // Ignore if the change was likely caused by our own editor save (within 2 seconds)
      if (Date.now() - lastEditorWriteRef.current < 2000) return

      window.api.fs.readFile(activeFilePath).then((res) => {
        if (res.ok) {
          setContent(res.data)
          setEditorKey((k) => k + 1)
        }
      })
    })
    return unsub
  }, [activeFilePath])

  // Force reload when an automation completes on the active file
  useEffect(() => {
    if (!activeFilePath) return
    const unsub = window.api.automation.onRunEvent((event) => {
      if (event.status !== 'completed') return
      // Small delay to let the file write settle
      setTimeout(() => {
        window.api.fs.readFile(activeFilePath).then((res) => {
          if (res.ok) {
            setContent(res.data)
            setEditorKey((k) => k + 1)
          }
        })
      }, 300)
    })
    return unsub
  }, [activeFilePath])

  const handleSave = useCallback(
    async (markdown: string) => {
      if (!activeFilePath) return
      lastEditorWriteRef.current = Date.now()
      await window.api.fs.writeFile(activeFilePath, markdown)

      // Auto-rename "Untitled" / "Untitled N" notes once the user has
      // written real content. Pulls the title from the first H1 heading,
      // else the first non-empty line. Runs at most once per file (the
      // rename changes the basename so subsequent saves no longer match).
      const basename = activeFilePath.split('/').pop() ?? ''
      if (!/^Untitled( \d+)?\.md$/i.test(basename)) return
      const dir = activeFilePath.slice(0, -basename.length - 1)
      const title = deriveTitleFromMarkdown(markdown)
      if (!title) return
      const safe = sanitizeFilename(title).slice(0, 60)
      if (!safe) return
      if (/^untitled( \d+)?$/i.test(safe)) return
      // Reject all-punctuation candidates ("#", "...", "—", etc.) — those
      // are mid-edit artefacts, not a real title.
      if (!hasMeaningfulCharacter(safe)) return
      // Pick a unique target name in the same directory.
      const dirRes = await window.api.fs.readDir(dir)
      const taken = new Set(dirRes.ok ? dirRes.data.map((f) => f.name) : [])
      let candidate = `${safe}.md`
      if (taken.has(candidate) && candidate !== basename) {
        for (let i = 2; i < 100; i++) {
          const next = `${safe} ${i}.md`
          if (!taken.has(next)) { candidate = next; break }
        }
      }
      if (candidate === basename) return
      const newPath = `${dir}/${candidate}`
      const renameRes = await window.api.fs.rename(activeFilePath, newPath)
      if (renameRes.ok) {
        // Point the active tab at the renamed file. The watcher will pick
        // up the rename event but we don't want to wait for it.
        setPaneActiveFile(newPath)
      }
    },
    [activeFilePath, setPaneActiveFile],
  )

  const handleQuickCreate = useCallback(async () => {
    if (!liteHome) return
    const notesDir = `${liteHome}/notes`
    const res = await window.api.fs.readDir(notesDir)
    const existing = res.ok ? res.data.map((f) => f.name) : []
    let name = 'Untitled'
    if (existing.includes('Untitled.md')) {
      let i = 2
      while (existing.includes(`Untitled ${i}.md`)) i++
      name = `Untitled ${i}`
    }
    const filePath = `${notesDir}/${name}.md`
    await window.api.fs.createFile(filePath)
    await window.api.fs.writeFile(filePath, `# ${name}\n\n`)
    // Open in this pane
    setPaneActiveFile(filePath)
  }, [liteHome, setPaneActiveFile])

  const blurClass = showCommandPalette
    ? 'opacity-50 transition-opacity duration-200'
    : 'transition-opacity duration-200'

  if (!activeFilePath) {
    return (
      <div className={`flex-1 flex flex-col items-center justify-center gap-4 text-tx-faint ${blurClass}`}>
        <FileText size={32} className="text-tx-faint" />
        <div className="text-sm">No note selected</div>
        {liteHome && (
          <button
            onClick={handleQuickCreate}
            className="px-4 py-1.5 text-[13px] text-tx-muted border border-border-strong rounded-md hover:border-tx-faint hover:text-tx-main transition-colors"
          >
            Create new note
          </button>
        )}
        <div className="text-xs text-tx-faint mt-2">
          Or click the + in the sidebar to create a note
        </div>
      </div>
    )
  }

  if (loading || content === null) {
    return (
      <div className={`flex-1 flex items-center justify-center text-tx-faint text-sm ${blurClass}`}>
        Loading...
      </div>
    )
  }

  return (
    <div className={`flex-1 overflow-hidden ${blurClass}`}>
      <LexicalEditor key={editorKey} initialContent={content} onSave={handleSave} />
    </div>
  )
}
