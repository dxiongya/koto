import React, { useEffect, useState, useCallback } from 'react'
import { useUIStore } from '../../store/useUIStore'
import { LexicalEditor } from './LexicalEditor'

export const NotesApp: React.FC = () => {
  const showCommandPalette = useUIStore((s) => s.showCommandPalette)
  const activeFilePath = useUIStore((s) => s.activeFilePath)
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

  const blurClass = showCommandPalette
    ? 'filter blur-[3px] opacity-50 transition-all duration-300'
    : 'transition-all duration-300'

  if (!activeFilePath) {
    return (
      <div className={`flex-1 flex items-center justify-center text-[#555] text-sm ${blurClass}`}>
        Select a file from the sidebar to edit
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
