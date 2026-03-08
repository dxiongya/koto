import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  $isTextNode,
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  $isParagraphNode,
  KEY_TAB_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  COMMAND_PRIORITY_LOW
} from 'lexical'
import { $isQuoteNode } from '@lexical/rich-text'
import { $createCalloutNode, $isCalloutNode, type CalloutType } from '../nodes/CalloutNode'

const CALLOUT_RE = /^\[!(note|warning|tip|important)\]\s*/i

export function CalloutPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState, prevEditorState }) => {
      if (editorState === prevEditorState) return

      editor.update(
        () => {
          const root = $getRoot()
          for (const child of root.getChildren()) {
            if (!$isQuoteNode(child)) continue

            const firstChild = child.getFirstChild()
            if (!firstChild || !$isTextNode(firstChild)) continue

            const text = firstChild.getTextContent()
            const match = CALLOUT_RE.exec(text)
            if (!match) continue

            const type = match[1].toLowerCase() as CalloutType
            const callout = $createCalloutNode(type)

            firstChild.setTextContent(text.slice(match[0].length))
            if (firstChild.getTextContent() === '') {
              firstChild.remove()
            }

            const children = child.getChildren()
            children.forEach((c) => callout.append(c))
            child.replace(callout)
            callout.selectEnd()
          }
        },
        { tag: 'callout-transform', discrete: true }
      )
    })
  }, [editor])

  useEffect(() => {
    const unTab = editor.registerCommand(
      KEY_TAB_COMMAND,
      (event: KeyboardEvent) => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false

        const anchorNode = selection.anchor.getNode()
        const element = anchorNode.getType() === 'paragraph' ? anchorNode : anchorNode.getParent()
        if (!element || !$isParagraphNode(element)) return false

        const calloutNode = element.getParent()
        if (!$isCalloutNode(calloutNode)) return false

        // Prevent default tab behavior (like indenting)
        event.preventDefault()
        
        editor.update(() => {
          const nextSibling = calloutNode.getNextSibling()
          if (nextSibling) {
            nextSibling.selectStart()
          } else {
            const newPara = $createParagraphNode()
            calloutNode.insertAfter(newPara)
            newPara.select()
          }
        })
        return true
      },
      COMMAND_PRIORITY_LOW
    )

    const unDown = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      () => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false

        const anchorNode = selection.anchor.getNode()
        const element = anchorNode.getType() === 'paragraph' ? anchorNode : anchorNode.getParent()
        if (!element || !$isParagraphNode(element)) return false

        const calloutNode = element.getParent()
        if (!$isCalloutNode(calloutNode)) return false

        const isLast = element === calloutNode.getLastChild()
        if (isLast) {
          // Check if cursor is at the end of the paragraph
          const textContentSize = element.getTextContentSize()
          let isAtEnd = false
          if (anchorNode.getType() === 'paragraph') {
            isAtEnd = selection.anchor.offset === 0 && textContentSize === 0
          } else {
            isAtEnd = selection.anchor.offset === anchorNode.getTextContentSize() && anchorNode === element.getLastChild()
          }

          if (isAtEnd) {
            editor.update(() => {
              const nextSibling = calloutNode.getNextSibling()
              if (nextSibling) {
                nextSibling.selectStart()
              } else {
                const newPara = $createParagraphNode()
                calloutNode.insertAfter(newPara)
                newPara.select()
              }
            })
            return true
          }
        }
        return false
      },
      COMMAND_PRIORITY_LOW
    )

    return () => {
      unTab()
      unDown()
    }
  }, [editor])

  return null
}
