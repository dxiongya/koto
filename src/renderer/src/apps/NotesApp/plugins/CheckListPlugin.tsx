import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $isParagraphNode,
  $createTextNode
} from 'lexical'
import {
  registerCheckList,
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode
} from '@lexical/list'

const CHECKBOX_MARKER_ONLY = /^\[( |x)\]\s/i
const CHECKBOX_LINE_WITH_BULLET = /^[-*+]\s\[( |x)\]\s(.*)$/i

export function CheckListPlugin(): null {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    return registerCheckList(editor)
  }, [editor])
  return null
}

export function AutoCheckListMarkdownPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      let needsTransform: 'case-a' | 'case-b' | null = null

      editorState.read(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return

        const anchorNode = selection.anchor.getNode()
        if (!$isTextNode(anchorNode)) return

        const parent = anchorNode.getParent()
        if (parent == null) return

        if ($isListItemNode(parent)) {
          if (CHECKBOX_MARKER_ONLY.test(anchorNode.getTextContent())) {
            const list = parent.getParent()
            if ($isListNode(list)) needsTransform = 'case-a'
          }
        } else if ($isParagraphNode(parent)) {
          if (CHECKBOX_LINE_WITH_BULLET.test(anchorNode.getTextContent())) {
            needsTransform = 'case-b'
          }
        }
      })

      if (!needsTransform) return

      editor.update(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return

        const anchorNode = selection.anchor.getNode()
        if (!$isTextNode(anchorNode)) return

        const parent = anchorNode.getParent()
        if (parent == null) return

        if (needsTransform === 'case-a' && $isListItemNode(parent)) {
          const markerMatch = anchorNode.getTextContent().match(CHECKBOX_MARKER_ONLY)
          if (!markerMatch) return

          const list = parent.getParent()
          if (!$isListNode(list)) return

          if (list.getListType() !== 'check') {
            list.setListType('check')
          }
          parent.setChecked(markerMatch[1].toLowerCase() === 'x')
          anchorNode.setTextContent(anchorNode.getTextContent().slice(markerMatch[0].length))
          parent.selectEnd()
          return
        }

        if (needsTransform === 'case-b' && $isParagraphNode(parent)) {
          const lineMatch = anchorNode.getTextContent().match(CHECKBOX_LINE_WITH_BULLET)
          if (!lineMatch) return

          const checked = lineMatch[1].toLowerCase() === 'x'
          const content = lineMatch[2]

          const list = $createListNode('check')
          const listItem = $createListItemNode(checked)
          if (content.length > 0) {
            listItem.append($createTextNode(content))
          }
          list.append(listItem)
          parent.replace(list)
          listItem.selectEnd()
        }
      })
    })
  }, [editor])

  return null
}
