import React, { useEffect, useState, useCallback } from 'react'
import { useUIStore } from '../../store/useUIStore'
import { LexicalEditor } from './LexicalEditor'
import { FileText } from 'lucide-react'

export const NotesApp: React.FC = () => {
  const showCommandPalette = useUIStore((s) => s.showCommandPalette)
  const activeFilePath = useUIStore((s) => s.appStates['notes.app'].activeFilePath)
  const liteHome = useUIStore((s) => s.liteHome)
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [editorKey, setEditorKey] = useState(0)

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

  const handleSave = useCallback(
    (markdown: string) => {
      if (activeFilePath) {
        window.api.fs.writeFile(activeFilePath, markdown)
      }
    },
    [activeFilePath],
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
    // Set active file for notes.app
    useUIStore.getState().setActiveFilePath(filePath)
  }, [liteHome])

  const blurClass = showCommandPalette
    ? 'filter blur-[3px] opacity-50 transition-all duration-300'
    : 'transition-all duration-300'

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
