/**
 * CopyMetadataPlugin — Stores source file path on copy for terminal paste.
 *
 * When text is copied from the notes editor, the source file path is stored
 * in window.__liteClipboardSource. Terminal.app checks this on Cmd+V and
 * prepends the file path as context. The variable is cleared after one paste.
 *
 * Other apps' paste behavior is unaffected — they don't check this variable.
 */
import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useUIStore } from '../../../store/useUIStore'

export function CopyMetadataPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    const root = editor.getRootElement()
    if (!root) return

    const handleCopy = () => {
      const filePath = useUIStore.getState().getActiveFilePath()
      if (filePath) {
        // Store source path globally — terminal paste handler reads this
        ;(window as any).__liteClipboardSource = filePath
      }
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
