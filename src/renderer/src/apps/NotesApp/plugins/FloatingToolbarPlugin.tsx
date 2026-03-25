import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
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
import { $isCodeNode } from '@lexical/code'
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
  Check,
  Copy,
  Search,
  Sparkles
} from 'lucide-react'
import { useUIStore } from '../../../store/useUIStore'
import { FloatingAIPanel } from './FloatingAIPanel'

// ── Toolbar state ──

interface ToolbarState {
  bold: boolean
  italic: boolean
  strikethrough: boolean
  highlight: boolean
  code: boolean
  link: boolean
  blockType: string
  isCodeBlock: boolean
}

const EMPTY_STATE: ToolbarState = {
  bold: false,
  italic: false,
  strikethrough: false,
  highlight: false,
  code: false,
  link: false,
  blockType: 'paragraph',
  isCodeBlock: false
}

export function FloatingToolbarPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const [isVisible, setIsVisible] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [state, setState] = useState<ToolbarState>(EMPTY_STATE)
  const [linkMode, setLinkMode] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [aiMode, setAiMode] = useState(false)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const linkModeRef = useRef(false)
  const aiModeRef = useRef(false)
  const savedSelectionRef = useRef<RangeSelection | null>(null)

  const updateToolbar = useCallback(() => {
    if (linkModeRef.current || aiModeRef.current) return

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
    let isCodeBlock = false

    let n: LexicalNode | null = selection.anchor.getNode()
    while (n) {
      if ($isCodeNode(n)) {
        isCodeBlock = true
        break
      }
      n = n.getParent()
    }

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
      blockType,
      isCodeBlock
    })

    // Use first client rect for focused positioning (not the full bounding box)
    const rects = range.getClientRects()
    const firstRect = rects.length > 0 ? rects[0] : range.getBoundingClientRect()
    const fullRect = range.getBoundingClientRect()
    const toolbarH = 36
    const gap = 8

    let top = fullRect.top - toolbarH - gap
    let left = Math.max(80, Math.min(firstRect.left + firstRect.width / 2, window.innerWidth - 160))

    if (top < 32 || isCodeBlock) {
      top = fullRect.bottom + gap
    }

    setPosition({ top, left })
    setIsVisible(true)
  }, [editor])

  const rafRef = useRef(0)
  useEffect(() => {
    return editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(() => updateToolbar())
        return false
      },
      COMMAND_PRIORITY_LOW
    )
  }, [editor, updateToolbar])

  // Close link mode on outside click
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

  const handleCopyCodeSelection = useCallback(() => {
    editor.getEditorState().read(() => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) {
        navigator.clipboard.writeText(selection.getTextContent())
      }
    })
    setIsVisible(false)
  }, [editor])

  const handleSearchCodeSelection = useCallback(() => {
    editor.getEditorState().read(() => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) {
        const text = selection.getTextContent()
        window.open(`https://google.com/search?q=${encodeURIComponent(text)}`, '_blank')
      }
    })
    setIsVisible(false)
  }, [editor])

  // ── AI mode ──
  const enterAiMode = useCallback(() => {
    editor.getEditorState().read(() => {
      const sel = $getSelection()
      if ($isRangeSelection(sel)) {
        savedSelectionRef.current = sel.clone()
      }
    })
    setAiMode(true)
    aiModeRef.current = true
  }, [editor])

  const cancelAi = useCallback(() => {
    // Save scroll position before focus (focus triggers scroll jump)
    const rootEl = editor.getRootElement()
    const scroller = rootEl?.closest('.overflow-y-auto') as HTMLElement | null
    const savedScroll = scroller?.scrollTop ?? 0

    setAiMode(false)
    aiModeRef.current = false
    savedSelectionRef.current = null
    editor.focus()

    // Restore scroll position after focus
    if (scroller) {
      scroller.scrollTop = savedScroll
      requestAnimationFrame(() => { scroller.scrollTop = savedScroll })
    }
  }, [editor])

  // Get current file path for changelog
  const filePath = useUIStore.getState().appStates?.['notes.app']?.activeFilePath ?? null

  const toolbar = (isVisible && !aiMode) ? createPortal(
    <div
      ref={toolbarRef}
      className="fixed z-50 animate-in fade-in duration-150"
      style={{
        top: position.top,
        left: position.left,
        transform: 'translateX(-50%)'
      }}
      onMouseDown={(e) => {
        const tag = (e.target as HTMLElement).tagName
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') e.preventDefault()
      }}
    >
      <div className="rounded-lg bg-bg-popover border border-border-subtle shadow-[0_4px_16px_rgba(0,0,0,0.1)]">
        <div className="flex items-center gap-0.5 px-1.5 py-1">
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
          ) : state.isCodeBlock ? (
            <>
              <TBtn onClick={handleCopyCodeSelection} active={false} title="Copy selection">
                <Copy className="w-3.5 h-3.5" />
              </TBtn>
              <TBtn onClick={handleSearchCodeSelection} active={false} title="Search selection">
                <Search className="w-3.5 h-3.5" />
              </TBtn>
              <Sep />
              <TBtn onClick={enterAiMode} active={aiMode} title="AI Generate">
                <Sparkles className="w-3.5 h-3.5" />
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
              <Sep />
              <TBtn onClick={enterAiMode} active={aiMode} title="AI Generate">
                <Sparkles className="w-3.5 h-3.5" />
              </TBtn>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  ) : null

  return (
    <>
      {toolbar}
      {aiMode && (
        <FloatingAIPanel
          editor={editor}
          savedSelectionRef={savedSelectionRef}
          onClose={cancelAi}
          filePath={filePath}
        />
      )}
    </>
  )
}

// ── Shared components ──

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
