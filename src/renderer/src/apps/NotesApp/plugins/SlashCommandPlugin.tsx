import { useEffect, useState, useCallback, useRef, type JSX } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $insertNodes,
  $createParagraphNode
} from 'lexical'
import { $createCodeNode } from '@lexical/code'
import { INSERT_CHECK_LIST_COMMAND } from '@lexical/list'
import { $createTableNodeWithDimensions } from '@lexical/table'
import { $createCalloutNode, type CalloutType } from '../nodes/CalloutNode'
import {
  Code,
  CheckSquare,
  Table,
  Minus,
  Info,
  AlertTriangle,
  Lightbulb,
  AlertCircle,
  ImageIcon
} from 'lucide-react'
import { $createHorizontalRuleNode } from '../nodes/HorizontalRuleNode'
import { $createImageNode } from '../nodes/ImageNode'

const BUILTIN_ITEMS: Array<{
  id: string
  name: string
  description: string
  keywords: string[]
  icon: typeof Code
}> = [
  {
    id: 'code',
    name: 'Code Block',
    description: 'Insert code block',
    keywords: ['code', '```'],
    icon: Code
  },
  {
    id: 'todo',
    name: 'Todo List',
    description: 'Insert checklist',
    keywords: ['todo', 'checkbox', 'check', 'task'],
    icon: CheckSquare
  },
  {
    id: 'table',
    name: 'Table',
    description: 'Insert 3x3 table',
    keywords: ['table', 'grid'],
    icon: Table
  },
  {
    id: 'hr',
    name: 'Divider',
    description: 'Insert horizontal rule',
    keywords: ['hr', 'divider', 'line', '---'],
    icon: Minus
  },
  {
    id: 'callout-note',
    name: 'Note',
    description: 'Insert info callout',
    keywords: ['callout', 'note', 'info'],
    icon: Info
  },
  {
    id: 'callout-warning',
    name: 'Warning',
    description: 'Insert warning callout',
    keywords: ['callout', 'warning'],
    icon: AlertTriangle
  },
  {
    id: 'callout-tip',
    name: 'Tip',
    description: 'Insert tip callout',
    keywords: ['callout', 'tip'],
    icon: Lightbulb
  },
  {
    id: 'callout-important',
    name: 'Important',
    description: 'Insert important callout',
    keywords: ['callout', 'important'],
    icon: AlertCircle
  },
  {
    id: 'image',
    name: 'Image',
    description: 'Import images',
    keywords: ['image', 'img', 'photo', 'picture'],
    icon: ImageIcon
  }
]

export function SlashCommandPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [selectedIndex, setSelectedIndex] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)

  const filtered = BUILTIN_ITEMS.filter(
    (b) =>
      b.name.toLowerCase().includes(query.toLowerCase()) ||
      b.description.toLowerCase().includes(query.toLowerCase()) ||
      b.keywords.some((k) => k.toLowerCase().includes(query.toLowerCase()))
  )

  // Keep refs in sync so the keydown handler always reads fresh values
  const isOpenRef = useRef(isOpen)
  isOpenRef.current = isOpen
  const filteredRef = useRef(filtered)
  filteredRef.current = filtered
  const selectedIndexRef = useRef(selectedIndex)
  selectedIndexRef.current = selectedIndex

  const closePanel = useCallback(() => {
    setIsOpen(false)
    setQuery('')
    setSelectedIndex(0)
  }, [])

  const removeSlashText = useCallback(() => {
    editor.update(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return
      const anchor = selection.anchor
      const node = anchor.getNode()
      if (!$isTextNode(node)) return
      const text = node.getTextContent()
      const slashIdx = text.lastIndexOf('/')
      if (slashIdx >= 0) {
        const before = text.slice(0, slashIdx)
        const after = text.slice(anchor.offset)
        node.setTextContent(before + after)
        selection.anchor.offset = before.length
        selection.focus.offset = before.length
      }
    })
  }, [editor])

  const executeBuiltin = useCallback(
    (id: string) => {
      removeSlashText()
      closePanel()

      if (id === 'code') {
        editor.update(() => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection)) return
          const codeNode = $createCodeNode()
          const paragraph = $createParagraphNode()
          $insertNodes([codeNode, paragraph])
          paragraph.selectStart()
        })
        return
      }

      if (id === 'todo') {
        // Delay to ensure removeSlashText's editor.update() has fully reconciled
        setTimeout(() => {
          editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined)
        }, 0)
        return
      }

      if (id === 'table') {
        editor.update(() => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection)) return
          const tableNode = $createTableNodeWithDimensions(3, 3, true)
          const paragraph = $createParagraphNode()
          $insertNodes([tableNode, paragraph])
          paragraph.selectStart()
        })
        return
      }

      if (id === 'hr') {
        editor.update(() => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection)) return
          const hrNode = $createHorizontalRuleNode()
          const paragraph = $createParagraphNode()
          $insertNodes([hrNode, paragraph])
          paragraph.selectStart()
        })
        return
      }

      if (id.startsWith('callout-')) {
        const calloutType = id.replace('callout-', '') as CalloutType
        editor.update(() => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection)) return
          const callout = $createCalloutNode(calloutType)
          const innerP = $createParagraphNode()
          callout.append(innerP)
          const afterP = $createParagraphNode()
          $insertNodes([callout, afterP])
          innerP.selectStart()
        })
        return
      }

      if (id === 'image') {
        void (async () => {
          try {
            const result = await window.api.dialog.selectImages()
            if (!result.ok) return
            for (const filePath of result.data) {
              const saveResult = await window.api.image.saveFromPath(filePath)
              if (saveResult.ok) {
                const src = `lite-asset://images/${saveResult.data}`
                editor.update(() => {
                  const selection = $getSelection()
                  if (!$isRangeSelection(selection)) return
                  const imgNode = $createImageNode({ src })
                  const paragraph = $createParagraphNode()
                  $insertNodes([imgNode, paragraph])
                  paragraph.selectStart()
                })
              }
            }
          } catch (err) {
            console.error('[SlashCommand] image import failed:', err)
          }
        })()
        return
      }
    },
    [editor, removeSlashText, closePanel]
  )

  const executeBuiltinRef = useRef(executeBuiltin)
  executeBuiltinRef.current = executeBuiltin
  const closePanelRef = useRef(closePanel)
  closePanelRef.current = closePanel

  // Detect '/' trigger
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          if (isOpenRef.current) closePanelRef.current()
          return
        }

        const anchor = selection.anchor
        const node = anchor.getNode()
        if (!$isTextNode(node)) {
          if (isOpenRef.current) closePanelRef.current()
          return
        }

        const textBefore = node.getTextContent().slice(0, anchor.offset)
        const slashMatch = textBefore.match(/\/([^\s/]*)$/)

        if (slashMatch) {
          setQuery(slashMatch[1])
          setSelectedIndex(0)

          const nativeSelection = window.getSelection()
          if (nativeSelection && nativeSelection.rangeCount > 0) {
            const range = nativeSelection.getRangeAt(0)
            const rect = range.getBoundingClientRect()
            setPosition({ top: rect.bottom + 4, left: rect.left })
          }

          if (!isOpenRef.current) setIsOpen(true)
        } else if (isOpenRef.current) {
          closePanelRef.current()
        }
      })
    })
  }, [editor])

  // Native DOM keydown handler in capture phase — runs BEFORE Lexical sees the event
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (!isOpenRef.current) return

      const items = filteredRef.current
      const idx = selectedIndexRef.current

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          e.stopPropagation()
          setSelectedIndex((prev) => {
            const nextIdx = prev < items.length - 1 ? prev + 1 : 0
            requestAnimationFrame(() => {
              const el = panelRef.current?.querySelector(`[data-index="${nextIdx}"]`)
              if (el) el.scrollIntoView({ block: 'nearest' })
            })
            return nextIdx
          })
          break
        case 'ArrowUp':
          e.preventDefault()
          e.stopPropagation()
          setSelectedIndex((prev) => {
            const nextIdx = prev > 0 ? prev - 1 : items.length - 1
            requestAnimationFrame(() => {
              const el = panelRef.current?.querySelector(`[data-index="${nextIdx}"]`)
              if (el) el.scrollIntoView({ block: 'nearest' })
            })
            return nextIdx
          })
          break
        case 'Enter': {
          e.preventDefault()
          e.stopPropagation()
          const item = items[idx]
          if (item) executeBuiltinRef.current(item.id)
          break
        }
        case 'Escape':
          e.preventDefault()
          e.stopPropagation()
          closePanelRef.current()
          break
      }
    }

    // Capture phase ensures we intercept BEFORE Lexical's keydown handler
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  if (!isOpen || filtered.length === 0) return null

  return (
    <div
      ref={panelRef}
      className="fixed z-50 rounded-lg py-1.5 min-w-[220px] max-h-[280px] overflow-y-auto bg-[#1e1e1e] border border-white/10 shadow-[0_4px_20px_rgba(0,0,0,0.5)]"
      style={{ top: position.top, left: position.left }}
    >
      {filtered.map((item, index) => {
        const Icon = item.icon
        return (
          <button
            key={item.id}
            data-index={index}
            className={`w-full text-left px-3 h-9 flex items-center gap-2.5 text-sm transition-colors duration-75 ${
              index === selectedIndex
                ? 'bg-white/8 text-[#ccc]'
                : 'text-[#888] hover:bg-white/5 hover:text-[#ccc]'
            }`}
            onMouseDown={(e) => {
              e.preventDefault()
              executeBuiltin(item.id)
            }}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <Icon className="w-4 h-4 text-[#5eead4] shrink-0" />
            <span className="font-medium text-[#ccc]">{item.name}</span>
            <span className="text-xs text-[#555] truncate">{item.description}</span>
          </button>
        )
      })}
    </div>
  )
}
