import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection,
  $isRangeSelection,
  $setSelection,
  $createParagraphNode,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
  COMMAND_PRIORITY_LOW,
  type LexicalNode,
  type RangeSelection
} from 'lexical'
import { $isHeadingNode, $createHeadingNode, type HeadingTagType } from '@lexical/rich-text'
import { $setBlocksType } from '@lexical/selection'
import { $isLinkNode, $toggleLink } from '@lexical/link'
import {
  Bold,
  Italic,
  Strikethrough,
  Highlighter,
  Code,
  Link2,
  Heading1,
  Heading2,
  Heading3,
  ArrowLeft,
  Check
} from 'lucide-react'
import { mergeRegister } from '@lexical/utils'

interface ToolbarState {
  bold: boolean
  italic: boolean
  strikethrough: boolean
  highlight: boolean
  code: boolean
  link: boolean
  blockType: string
}

const EMPTY_STATE: ToolbarState = {
  bold: false,
  italic: false,
  strikethrough: false,
  highlight: false,
  code: false,
  link: false,
  blockType: 'paragraph'
}

export function FloatingToolbarPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const [isVisible, setIsVisible] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [state, setState] = useState<ToolbarState>(EMPTY_STATE)
  const [linkMode, setLinkMode] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const toolbarRef = useRef<HTMLDivElement>(null)
  const linkModeRef = useRef(false)
  const savedSelectionRef = useRef<RangeSelection | null>(null)

  const updateToolbar = useCallback(() => {
    if (linkModeRef.current) return

    const selection = $getSelection()
    if (!$isRangeSelection(selection) || selection.isCollapsed()) {
      setIsVisible(false)
      return
    }

    const nativeSel = window.getSelection()
    if (!nativeSel || nativeSel.rangeCount === 0) {
      setIsVisible(false)
      return
    }
    const range = nativeSel.getRangeAt(0)
    const root = editor.getRootElement()
    if (!root || !root.contains(range.commonAncestorContainer)) {
      setIsVisible(false)
      return
    }

    let isLink = false
    let current: LexicalNode | null = selection.anchor.getNode()
    while (current) {
      if ($isLinkNode(current)) {
        isLink = true
        break
      }
      current = current.getParent()
    }

    let blockType = 'paragraph'
    try {
      const element = selection.anchor.getNode().getTopLevelElementOrThrow()
      if ($isHeadingNode(element)) blockType = element.getTag()
    } catch {
      /* inside table or nested structure */
    }

    setState({
      bold: selection.hasFormat('bold'),
      italic: selection.hasFormat('italic'),
      strikethrough: selection.hasFormat('strikethrough'),
      highlight: selection.hasFormat('highlight'),
      code: selection.hasFormat('code'),
      link: isLink,
      blockType
    })

    const rect = range.getBoundingClientRect()
    const toolbarH = 36
    const gap = 8
    let top = rect.top - toolbarH - gap
    if (top < 8) top = rect.bottom + gap

    setPosition({
      top,
      left: Math.max(160, Math.min(rect.left + rect.width / 2, window.innerWidth - 160))
    })
    setIsVisible(true)
  }, [editor])

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          updateToolbar()
          return false
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          updateToolbar()
        })
      })
    )
  }, [editor, updateToolbar])

  useEffect(() => {
    if (!linkMode) return
    const handler = (e: MouseEvent): void => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setLinkMode(false)
        linkModeRef.current = false
        savedSelectionRef.current = null
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [linkMode])

  const formatText = useCallback(
    (format: 'bold' | 'italic' | 'strikethrough' | 'highlight' | 'code') => {
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)
    },
    [editor]
  )

  const toggleHeading = useCallback(
    (tag: HeadingTagType) => {
      editor.update(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return
        try {
          const element = selection.anchor.getNode().getTopLevelElementOrThrow()
          const isAlready = $isHeadingNode(element) && element.getTag() === tag
          $setBlocksType(selection, () =>
            isAlready ? $createParagraphNode() : $createHeadingNode(tag)
          )
        } catch {
          /* ignore */
        }
      })
    },
    [editor]
  )

  const enterLinkMode = useCallback(() => {
    editor.getEditorState().read(() => {
      const sel = $getSelection()
      if ($isRangeSelection(sel)) {
        savedSelectionRef.current = sel.clone()
      }
    })
    setLinkUrl('')
    setLinkMode(true)
    linkModeRef.current = true
  }, [editor])

  const submitLink = useCallback(() => {
    const url = linkUrl.trim()
    setLinkMode(false)
    linkModeRef.current = false
    if (!url) {
      savedSelectionRef.current = null
      editor.focus()
      return
    }
    editor.update(() => {
      const saved = savedSelectionRef.current
      if (saved) $setSelection(saved.clone())
      $toggleLink(url)
    })
    savedSelectionRef.current = null
    editor.focus()
  }, [editor, linkUrl])

  const cancelLink = useCallback(() => {
    setLinkMode(false)
    linkModeRef.current = false
    savedSelectionRef.current = null
    editor.focus()
  }, [editor])

  const handleLinkClick = useCallback(() => {
    if (state.link) {
      editor.update(() => {
        $toggleLink(null)
      })
    } else {
      enterLinkMode()
    }
  }, [editor, state.link, enterLinkMode])

  if (!isVisible) return null

  return (
    <div
      ref={toolbarRef}
      className="fixed z-50 animate-in fade-in duration-150"
      style={{
        top: position.top,
        left: position.left,
        transform: 'translateX(-50%)'
      }}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault()
      }}
    >
      <div className="flex items-center gap-0.5 rounded-lg px-1.5 py-1 bg-bg-popover border border-border-subtle shadow-[0_4px_16px_rgba(0,0,0,0.1)]">
        {linkMode ? (
          <>
            <TBtn onClick={cancelLink} active={false} title="Cancel">
              <ArrowLeft className="w-3.5 h-3.5" />
            </TBtn>
            <input
              type="text"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitLink()
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  cancelLink()
                }
              }}
              placeholder="Enter URL..."
              className="w-44 h-7 px-2 text-xs outline-none bg-transparent text-tx-main placeholder-tx-muted"
              autoFocus
            />
            <TBtn onClick={submitLink} active={false} title="Confirm">
              <Check className="w-3.5 h-3.5" />
            </TBtn>
          </>
        ) : (
          <>
            <TBtn onClick={() => formatText('bold')} active={state.bold} title="Bold ⌘B">
              <Bold className="w-3.5 h-3.5" />
            </TBtn>
            <TBtn onClick={() => formatText('italic')} active={state.italic} title="Italic ⌘I">
              <Italic className="w-3.5 h-3.5" />
            </TBtn>
            <TBtn
              onClick={() => formatText('strikethrough')}
              active={state.strikethrough}
              title="Strikethrough ⌘⇧S"
            >
              <Strikethrough className="w-3.5 h-3.5" />
            </TBtn>
            <TBtn
              onClick={() => formatText('highlight')}
              active={state.highlight}
              title="Highlight ⌘⇧H"
            >
              <Highlighter className="w-3.5 h-3.5" />
            </TBtn>
            <TBtn onClick={() => formatText('code')} active={state.code} title="Code ⌘⇧C">
              <Code className="w-3.5 h-3.5" />
            </TBtn>
            <Sep />
            <TBtn onClick={handleLinkClick} active={state.link} title="Link ⌘K">
              <Link2 className="w-3.5 h-3.5" />
            </TBtn>
            <Sep />
            <TBtn
              onClick={() => toggleHeading('h1')}
              active={state.blockType === 'h1'}
              title="Heading 1 ⌘⇧1"
            >
              <Heading1 className="w-3.5 h-3.5" />
            </TBtn>
            <TBtn
              onClick={() => toggleHeading('h2')}
              active={state.blockType === 'h2'}
              title="Heading 2 ⌘⇧2"
            >
              <Heading2 className="w-3.5 h-3.5" />
            </TBtn>
            <TBtn
              onClick={() => toggleHeading('h3')}
              active={state.blockType === 'h3'}
              title="Heading 3 ⌘⇧3"
            >
              <Heading3 className="w-3.5 h-3.5" />
            </TBtn>
          </>
        )}
      </div>
    </div>
  )
}

function TBtn({
  onClick,
  active,
  title,
  children
}: {
  onClick: () => void
  active: boolean
  title: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onClick={onClick}
      className={`w-7 h-7 flex items-center justify-center rounded transition-colors duration-150 ${
        active
          ? 'text-accent-main bg-bg-active'
          : 'text-tx-muted hover:text-tx-main hover:bg-bg-hover'
      }`}
    >
      {children}
    </button>
  )
}

function Sep(): JSX.Element {
  return <div className="w-[1px] h-4 mx-0.5 bg-bg-active" />
}
