import React, { useCallback, useRef } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListNode, ListItemNode } from '@lexical/list'
import { CodeNode, CodeHighlightNode } from '@lexical/code'
import { LinkNode } from '@lexical/link'
import { $convertFromMarkdownString, $convertToMarkdownString, TRANSFORMERS } from '@lexical/markdown'
import type { EditorState } from 'lexical'
import { lexicalTheme } from './lexical-theme'

interface LexicalEditorProps {
  initialContent: string
  onSave: (markdown: string) => void
}

export const LexicalEditor: React.FC<LexicalEditorProps> = ({ initialContent, onSave }) => {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const initialConfig = {
    namespace: 'NotesEditor',
    theme: lexicalTheme,
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode, CodeHighlightNode, LinkNode],
    editorState: () => {
      $convertFromMarkdownString(initialContent, TRANSFORMERS)
    },
    onError: (error: Error) => {
      console.error('Lexical error:', error)
    },
  }

  const handleChange = useCallback(
    (editorState: EditorState) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        editorState.read(() => {
          const md = $convertToMarkdownString(TRANSFORMERS)
          onSave(md)
        })
      }, 800)
    },
    [onSave],
  )

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <RichTextPlugin
            contentEditable={
              <ContentEditable className="outline-none px-8 py-6 md:px-12 md:py-8 min-h-full text-[16px] leading-[1.8]" />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
      </div>
      <HistoryPlugin />
      <ListPlugin />
      <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
      <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
    </LexicalComposer>
  )
}
