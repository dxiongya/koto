/**
 * ImagePlugin — Handles image paste and drag-drop in the editor.
 *
 * Priority:
 *   1. Image file in clipboard → save via IPC, insert ImageNode
 *   2. HTML with <img src>    → download via IPC, insert ImageNode
 */
import { useEffect, type JSX } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $insertNodes,
  $createParagraphNode,
  type RangeSelection
} from 'lexical'
import { $createImageNode } from '../nodes/ImageNode'

const HTML_IMG_RE = /<img[^>]+src=["']([^"']+)["']/i

function filenameToSrc(filename: string): string {
  return `lite-asset://images/${filename}`
}

export function ImagePlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    const ensureSelection = (cb: (sel: RangeSelection) => void): void => {
      const sel = $getSelection()
      if ($isRangeSelection(sel)) {
        cb(sel)
        return
      }
      $getRoot().selectEnd()
      const fallback = $getSelection()
      if ($isRangeSelection(fallback)) cb(fallback)
    }

    const insertImage = (src: string): void => {
      const img = $createImageNode({ src })
      const p = $createParagraphNode()
      $insertNodes([img, p])
      p.selectStart()
    }

    function handleImageFile(data: DataTransfer): boolean {
      let file: File | null = null
      for (const item of Array.from(data.items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          file = item.getAsFile()
          break
        }
      }
      if (!file) return false

      const captured = file
      void captured.arrayBuffer().then(async (buffer) => {
        try {
          const result = await window.api.image.save(buffer, captured.type)
          if (result.ok) {
            editor.update(() => ensureSelection(() => insertImage(filenameToSrc(result.data))))
          }
        } catch (err) {
          console.error('[ImagePlugin] save failed:', err)
        }
      })

      return true
    }

    function handleHtmlImage(data: DataTransfer): boolean {
      const html = data.getData('text/html')
      if (!html) return false

      const match = html.match(HTML_IMG_RE)
      const imgUrl = match?.[1]
      if (!imgUrl || !/^https?:\/\//i.test(imgUrl)) return false

      void (async () => {
        try {
          const result = await window.api.image.saveFromUrl(imgUrl)
          if (result.ok) {
            editor.update(() => ensureSelection(() => insertImage(filenameToSrc(result.data))))
          }
        } catch (err) {
          console.error('[ImagePlugin] URL download failed:', err)
        }
      })()

      return true
    }

    const onPaste = (e: Event): void => {
      const event = e as ClipboardEvent
      if (event.defaultPrevented) return
      const data = event.clipboardData
      if (!data) return

      const handled = handleImageFile(data) || handleHtmlImage(data)

      if (handled) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }

    return editor.registerRootListener((next, prev) => {
      prev?.removeEventListener('paste', onPaste, true)
      next?.addEventListener('paste', onPaste, true)
    })
  }, [editor])

  return null
}
