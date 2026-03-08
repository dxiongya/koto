import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  FORMAT_TEXT_COMMAND
} from 'lexical'
import { $isHeadingNode, $createHeadingNode, type HeadingTagType } from '@lexical/rich-text'
import { $setBlocksType } from '@lexical/selection'
import { $isLinkNode, $toggleLink } from '@lexical/link'

export function KeyboardShortcutsPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    const root = editor.getRootElement()
    if (!root) return

    const handler = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return

      if (e.shiftKey && e.code === 'KeyS') {
        e.preventDefault()
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough')
        return
      }

      if (e.shiftKey && e.code === 'KeyH') {
        e.preventDefault()
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'highlight')
        return
      }

      if (e.shiftKey && e.code === 'KeyC') {
        e.preventDefault()
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'code')
        return
      }

      if (!e.shiftKey && e.code === 'KeyK') {
        e.preventDefault()

        let isInLink = false
        editor.getEditorState().read(() => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection)) return
          let current = selection.anchor.getNode()
          while (current) {
            if ($isLinkNode(current)) {
              isInLink = true
              break
            }
            const parent = current.getParent()
            if (!parent) break
            current = parent
          }
        })

        if (isInLink) {
          editor.update(() => {
            $toggleLink(null)
          })
        } else {
          const url = window.prompt('Enter link URL:')
          if (url && url.trim()) {
            editor.update(() => {
              $toggleLink(url.trim())
            })
          }
        }
        return
      }

      if (e.shiftKey) {
        let tag: HeadingTagType | null = null
        if (e.code === 'Digit1') tag = 'h1'
        else if (e.code === 'Digit2') tag = 'h2'
        else if (e.code === 'Digit3') tag = 'h3'

        if (tag) {
          e.preventDefault()
          const targetTag = tag
          editor.update(() => {
            const selection = $getSelection()
            if (!$isRangeSelection(selection)) return
            const element = selection.anchor.getNode().getTopLevelElementOrThrow()
            const isAlready = $isHeadingNode(element) && element.getTag() === targetTag
            $setBlocksType(selection, () =>
              isAlready ? $createParagraphNode() : $createHeadingNode(targetTag)
            )
          })
        }
      }
    }

    root.addEventListener('keydown', handler)
    return () => root.removeEventListener('keydown', handler)
  }, [editor])

  return null
}
