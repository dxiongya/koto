import React, { useEffect, useState, useCallback } from 'react'
import { FolderOpen, FileCode } from 'lucide-react'
import { useUIStore } from '../../store/useUIStore'
import { CodeMirrorEditor } from './CodeMirrorEditor'

export const CodeApp: React.FC = () => {
  const showCommandPalette = useUIStore((s) => s.showCommandPalette)
  const activeFilePath = useUIStore((s) => s.appStates['code.app'].activeFilePath)
  const codeProjectPath = useUIStore((s) => s.codeProjectPath)
  const [content, setContent] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleOpenProject = useCallback(async () => {
    const res = await window.api.project.open()
    if (res.ok && res.data) {
      useUIStore.getState().setCodeProjectPath(res.data)
    }
  }, [])

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
    // No file open. If there's also no project, show "Open Folder" CTA.
    // Otherwise hint that the user should pick from the sidebar.
    if (!codeProjectPath) {
      return (
        <div className={`flex-1 flex flex-col items-center justify-center gap-4 text-tx-faint ${blurClass}`}>
          <FolderOpen size={32} className="text-tx-faint" />
          <div className="text-sm">No project open</div>
          <button
            onClick={handleOpenProject}
            className="flex items-center gap-1.5 px-4 py-1.5 text-[13px] text-tx-muted border border-border-strong rounded-md hover:border-tx-faint hover:text-tx-main transition-colors"
          >
            <FolderOpen size={13} />
            Open Folder
          </button>
          <div className="text-xs text-tx-faint mt-2">
            Pick a directory to start editing code files
          </div>
        </div>
      )
    }
    return (
      <div className={`flex-1 flex flex-col items-center justify-center gap-3 text-tx-faint ${blurClass}`}>
        <FileCode size={32} className="text-tx-faint" />
        <div className="text-sm">No file selected</div>
        <div className="text-xs text-tx-faint">
          Pick a file from the sidebar to start editing
        </div>
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
