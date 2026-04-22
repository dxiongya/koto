import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useUIStore } from '../../store/useUIStore'
import { usePaneActiveFile } from '../../layouts/PaneContext'
import { LexicalEditor } from './LexicalEditor'
import { FileText } from 'lucide-react'

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
    (markdown: string) => {
      if (activeFilePath) {
        lastEditorWriteRef.current = Date.now()
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
