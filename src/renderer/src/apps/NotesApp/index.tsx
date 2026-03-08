import React, { useEffect, useState, useCallback } from 'react'
import { useUIStore } from '../../store/useUIStore'
import { LexicalEditor } from './LexicalEditor'
import { FileText } from 'lucide-react'

export const NotesApp: React.FC = () => {
  const showCommandPalette = useUIStore((s) => s.showCommandPalette)
  const activeFilePath = useUIStore((s) => s.activeFilePath)
  const workspacePath = useUIStore((s) => s.workspacePath)
  const setActiveFilePath = useUIStore((s) => s.setActiveFilePath)
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
      // Force re-mount LexicalEditor on file switch
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
    if (!workspacePath) return
    const notesDir = `${workspacePath}/notes`
    await window.api.fs.createDir(notesDir)
    const fileName = `untitled-${Date.now()}.md`
    const filePath = `${notesDir}/${fileName}`
    await window.api.fs.createFile(filePath)
    await window.api.fs.writeFile(filePath, '# Untitled\n\n')
    setActiveFilePath(filePath)
  }, [workspacePath, setActiveFilePath])

  const blurClass = showCommandPalette
    ? 'filter blur-[3px] opacity-50 transition-all duration-300'
    : 'transition-all duration-300'

  if (!activeFilePath) {
    return (
      <div className={`flex-1 flex flex-col items-center justify-center gap-4 text-[#555] ${blurClass}`}>
        <FileText size={32} className="text-[#333]" />
        <div className="text-sm">No note selected</div>
        {workspacePath && (
          <button
            onClick={handleQuickCreate}
            className="px-4 py-1.5 text-[13px] text-[#999] border border-[#333] rounded-md hover:border-[#555] hover:text-[#ccc] transition-colors"
          >
            Create new note
          </button>
        )}
        <div className="text-xs text-[#444] mt-2">
          Or click the + in the sidebar to create a note
        </div>
      </div>
    )
  }

  if (loading || content === null) {
    return (
      <div className={`flex-1 flex items-center justify-center text-[#555] text-sm ${blurClass}`}>
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
