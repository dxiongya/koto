import React, { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, foldGutter, indentOnInput } from '@codemirror/language'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { liteTheme, liteHighlight } from './cm-theme'
import { getLanguageByPath } from './cm-languages'

interface CodeMirrorEditorProps {
  filePath: string
  content: string
  onSave: (content: string) => void
}

export const CodeMirrorEditor: React.FC<CodeMirrorEditorProps> = ({ filePath, content, onSave }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // Clean up previous editor
    viewRef.current?.destroy()

    const langSupport = getLanguageByPath(filePath)
    const extensions = [
      liteTheme,
      liteHighlight,
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      history(),
      foldGutter(),
      indentOnInput(),
      bracketMatching(),
      autocompletion(),
      highlightSelectionMatches(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...completionKeymap, indentWithTab]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const doc = update.state.doc.toString()
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
          saveTimerRef.current = setTimeout(() => onSave(doc), 800)
        }
      }),
    ]

    if (langSupport) {
      extensions.push(langSupport)
    }

    const state = EditorState.create({
      doc: content,
      extensions,
    })

    const view = new EditorView({
      state,
      parent: containerRef.current,
    })

    viewRef.current = view

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      view.destroy()
    }
    // Intentionally depend on filePath to recreate editor on file switch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath])

  return <div ref={containerRef} className="h-full overflow-auto" />
}
