/**
 * CopyMetadataPlugin — Attaches file path metadata to clipboard on copy.
 *
 * When text is copied from the notes editor, a custom MIME type
 * (text/x-lite-source) is added to the clipboard containing the
 * source file path. Terminal.app can detect this on paste and
 * prepend the file path as context.
 */
import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useUIStore } from '../../../store/useUIStore'

export function CopyMetadataPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    const root = editor.getRootElement()
    if (!root) return

    const handleCopy = (e: ClipboardEvent) => {
      const filePath = useUIStore.getState().appStates['notes.app']?.activeFilePath
      if (!filePath || !e.clipboardData) return
      // Attach source file path as custom MIME type
      e.clipboardData.setData('text/x-lite-source', filePath)
    }

    root.addEventListener('copy', handleCopy)
    root.addEventListener('cut', handleCopy)
    return () => {
      root.removeEventListener('copy', handleCopy)
      root.removeEventListener('cut', handleCopy)
    }
  }, [editor])

  return null
}
