import React, { useEffect, useState, useCallback } from 'react'
import { useUIStore } from '../../store/useUIStore'
import { CodeMirrorEditor } from './CodeMirrorEditor'

export const CodeApp: React.FC = () => {
  const showCommandPalette = useUIStore((s) => s.showCommandPalette)
  const activeFilePath = useUIStore((s) => s.appStates['code.app'].activeFilePath)
  const [content, setContent] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!activeFilePath) {
      setContent('')
      setError(null)
      return
    }
    setLoading(true)
    window.api.fs.readFile(activeFilePath).then((res) => {
      if (res.ok) {
        setContent(res.data)
        setError(null)
      } else {
        setContent('')
        setError(res.error)
      }
      setLoading(false)
    })
  }, [activeFilePath])

  const handleSave = useCallback(
    (doc: string) => {
      if (activeFilePath) {
        window.api.fs.writeFile(activeFilePath, doc)
      }
    },
    [activeFilePath],
  )

  const blurClass = showCommandPalette
    ? 'opacity-50 transition-opacity duration-200'
    : 'transition-opacity duration-200'

  if (!activeFilePath) {
    return (
      <div className={`flex-1 flex items-center justify-center text-tx-faint text-sm ${blurClass}`}>
        Select a file from the sidebar
      </div>
    )
  }

  if (loading) {
    return (
      <div className={`flex-1 flex items-center justify-center text-tx-faint text-sm ${blurClass}`}>
        Loading...
      </div>
    )
  }

  if (error) {
    return (
      <div className={`flex-1 flex items-center justify-center text-status-error/70 text-sm ${blurClass}`}>
        {error}
      </div>
    )
  }

  return (
    <div className={`flex-1 overflow-hidden ${blurClass}`}>
      <CodeMirrorEditor filePath={activeFilePath} content={content} onSave={handleSave} />
    </div>
  )
}
