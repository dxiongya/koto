import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $isTextNode,
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  $isParagraphNode,
  KEY_TAB_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  COMMAND_PRIORITY_LOW
} from 'lexical'
import { $isQuoteNode, QuoteNode } from '@lexical/rich-text'
import { $createCalloutNode, $isCalloutNode, type CalloutType } from '../nodes/CalloutNode'

const CALLOUT_RE = /^\[!(note|warning|tip|important)\]\s*/i

export function CalloutPlugin(): null {
  const [editor] = useLexicalComposerContext()

  // Use registerNodeTransform — only runs when QuoteNodes change, not on every keystroke
  useEffect(() => {
    return editor.registerNodeTransform(QuoteNode, (node) => {
      if (!$isQuoteNode(node)) return

      const firstChild = node.getFirstChild()
      if (!firstChild || !$isTextNode(firstChild)) return

      const text = firstChild.getTextContent()
      const match = CALLOUT_RE.exec(text)
      if (!match) return

      const type = match[1].toLowerCase() as CalloutType
      const callout = $createCalloutNode(type)

      firstChild.setTextContent(text.slice(match[0].length))
      if (firstChild.getTextContent() === '') {
        firstChild.remove()
      }

      const children = node.getChildren()
      children.forEach((c) => callout.append(c))
      node.replace(callout)
      callout.selectEnd()
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
