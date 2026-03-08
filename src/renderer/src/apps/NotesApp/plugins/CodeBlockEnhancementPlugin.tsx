import { useEffect, useRef, useState, useCallback, type JSX } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $isParagraphNode,
  KEY_ENTER_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_TAB_COMMAND,
  KEY_ESCAPE_COMMAND,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_CRITICAL,
  type NodeKey
} from 'lexical'
import {
  registerCodeHighlighting,
  $isCodeNode,
  $createCodeNode,
  CodeNode,
  getCodeLanguageOptions,
  normalizeCodeLang
} from '@lexical/code'
import { createPortal } from 'react-dom'
import { Copy, Check, ChevronDown, Code2 } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'

const CODE_FENCE_RE = /^```(\w+)?$/
const CODE_FENCE_PARTIAL_RE = /^```(\w+)$/

const LANGUAGE_OPTIONS = getCodeLanguageOptions()

interface CodeBlockInfo {
  nodeKey: NodeKey
  element: HTMLElement
}

export function CodeBlockEnhancementPlugin(): JSX.Element {
  const [editor] = useLexicalComposerContext()
  const [codeBlocks, setCodeBlocks] = useState<CodeBlockInfo[]>([])

  useEffect(() => {
    return registerCodeHighlighting(editor)
  }, [editor])

  // ``` + Enter -> create code block
  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      () => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false
        const node = selection.anchor.getNode()
        const parent = node.getTopLevelElementOrThrow()
        if (!$isParagraphNode(parent)) return false
        const text = parent.getTextContent()
        const match = text.match(CODE_FENCE_RE)
        if (!match) return false
        const codeNode = $createCodeNode(match[1])
        parent.replace(codeNode)
        codeNode.select()
        return true
      },
      COMMAND_PRIORITY_HIGH
    )
  }, [editor])

  // Track code blocks
  useEffect(() => {
    return editor.registerMutationListener(CodeNode, (mutations) => {
      setCodeBlocks((prev) => {
        const next = new Map(prev.map((b) => [b.nodeKey, b]))
        for (const [key, type] of mutations) {
          if (type === 'destroyed') {
            next.delete(key)
          } else {
            const elem = editor.getElementByKey(key)
            if (elem) next.set(key, { nodeKey: key, element: elem })
          }
        }
        return Array.from(next.values())
      })
    })
  }, [editor])

  // Sync language badge data attributes
  useEffect(() => {
    const sync = (): void => {
      editor.getEditorState().read(() => {
        const keys = editor._editorState._nodeMap
        for (const [key, node] of keys) {
          if ($isCodeNode(node)) {
            const elem = editor.getElementByKey(key)
            if (!elem) continue
            const lang = normalizeCodeLang(node.getLanguage() || 'javascript')
            const label = LANGUAGE_OPTIONS.find(([v]) => v === lang)?.[1] ?? lang
            elem.dataset.langLabel = label
          }
        }
      })
    }
    sync()
    return editor.registerUpdateListener(sync)
  }, [editor])

  return (
    <>
      <CodeFenceLangSuggestion editor={editor} />
      {codeBlocks.map((block) => (
        <CodeBlockHoverToolbar
          key={block.nodeKey}
          nodeKey={block.nodeKey}
          element={block.element}
          editor={editor}
        />
      ))}
    </>
  )
}

// Language suggestion popup when typing ```lang
interface SuggestionState {
  query: string
  matches: Array<[string, string]>
  position: { top: number; left: number }
}

function CodeFenceLangSuggestion({
  editor
}: {
  editor: ReturnType<typeof useLexicalComposerContext>[0]
}): JSX.Element | null {
  const [suggestion, setSuggestion] = useState<SuggestionState | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          setSuggestion(null)
          return
        }
        const node = selection.anchor.getNode()
        const parent = $isTextNode(node) ? node.getParent() : node
        if (!parent || !$isParagraphNode(parent)) {
          setSuggestion(null)
          return
        }
        const text = parent.getTextContent()
        const match = text.match(CODE_FENCE_PARTIAL_RE)
        if (!match || !match[1]) {
          setSuggestion(null)
          return
        }
        const query = match[1].toLowerCase()
        const matches = LANGUAGE_OPTIONS.filter(
          ([value, label]) =>
            value.toLowerCase().startsWith(query) ||
            label.toLowerCase().startsWith(query)
        ).slice(0, 8)
        if (matches.length === 0) {
          setSuggestion(null)
          return
        }
        const domSelection = window.getSelection()
        if (!domSelection || domSelection.rangeCount === 0) {
          setSuggestion(null)
          return
        }
        const range = domSelection.getRangeAt(0)
        const rect = range.getBoundingClientRect()
        setSuggestion({
          query,
          matches,
          position: { top: rect.bottom + 4, left: rect.left }
        })
        setActiveIndex(0)
      })
    })
  }, [editor])

  const createCodeBlock = useCallback(
    (language: string) => {
      editor.update(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return
        const node = selection.anchor.getNode()
        const parent = $isTextNode(node) ? node.getParent() : node
        if (!parent || !$isParagraphNode(parent)) return
        const codeNode = $createCodeNode(language)
        parent.replace(codeNode)
        codeNode.select()
      })
      setSuggestion(null)
    },
    [editor]
  )

  useEffect(() => {
    if (!suggestion) return
    const unregEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      () => {
        if (!suggestion) return false
        const selected = suggestion.matches[activeIndex]
        if (selected) {
          createCodeBlock(selected[0])
          return true
        }
        return false
      },
      COMMAND_PRIORITY_CRITICAL
    )
    const unregTab = editor.registerCommand(
      KEY_TAB_COMMAND,
      () => {
        if (!suggestion) return false
        const selected = suggestion.matches[activeIndex]
        if (selected) {
          createCodeBlock(selected[0])
          return true
        }
        return false
      },
      COMMAND_PRIORITY_CRITICAL
    )
    const unregDown = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      () => {
        if (!suggestion) return false
        setActiveIndex((i) => Math.min(i + 1, suggestion.matches.length - 1))
        return true
      },
      COMMAND_PRIORITY_CRITICAL
    )
    const unregUp = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      () => {
        if (!suggestion) return false
        setActiveIndex((i) => Math.max(i - 1, 0))
        return true
      },
      COMMAND_PRIORITY_CRITICAL
    )
    const unregEsc = editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        if (!suggestion) return false
        setSuggestion(null)
        return true
      },
      COMMAND_PRIORITY_CRITICAL
    )
    return () => {
      unregEnter()
      unregTab()
      unregDown()
      unregUp()
      unregEsc()
    }
  }, [editor, suggestion, activeIndex, createCodeBlock])

  useEffect(() => {
    if (!listRef.current) return
    const activeEl = listRef.current.children[activeIndex] as HTMLElement | undefined
    activeEl?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (!suggestion) return null

  return createPortal(
    <div
      ref={listRef}
      className="fixed z-50 rounded-lg py-1 min-w-[180px] max-h-[240px] overflow-y-auto bg-bg-popover border border-border-subtle shadow-[0_4px_16px_rgba(0,0,0,0.1)]"
      style={{
        top: suggestion.position.top,
        left: suggestion.position.left
      }}
    >
      {suggestion.matches.map(([value, label], index) => (
        <button
          key={value}
          type="button"
          className={`w-full text-left px-3 h-8 flex items-center gap-2 text-xs transition-colors ${
            index === activeIndex
              ? 'bg-bg-active text-tx-main'
              : 'text-tx-muted hover:bg-bg-hover'
          }`}
          onMouseEnter={() => setActiveIndex(index)}
          onMouseDown={(e) => {
            e.preventDefault()
            createCodeBlock(value)
          }}
        >
          <Code2 className="w-3.5 h-3.5 shrink-0 text-accent-main/60" />
          <span>{label}</span>
          <span className="text-tx-faint ml-auto">{value}</span>
        </button>
      ))}
    </div>,
    document.body
  )
}

// Hover toolbar for code blocks
function CodeBlockHoverToolbar({
  nodeKey,
  element,
  editor
}: {
  nodeKey: NodeKey
  element: HTMLElement
  editor: ReturnType<typeof useLexicalComposerContext>[0]
}): JSX.Element {
  const [isHovered, setIsHovered] = useState(false)
  const [language, setLanguage] = useState('javascript')
  const [copied, setCopied] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    editor.getEditorState().read(() => {
      const node = $getNodeByKey(nodeKey)
      if ($isCodeNode(node)) {
        setLanguage(normalizeCodeLang(node.getLanguage() || 'javascript'))
      }
    })
  }, [editor, nodeKey])

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const node = $getNodeByKey(nodeKey)
        if ($isCodeNode(node)) {
          setLanguage(normalizeCodeLang(node.getLanguage() || 'javascript'))
        }
      })
    })
  }, [editor, nodeKey])

  const visible = isHovered || menuOpen

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      const toolbar = toolbarRef.current
      if (toolbar?.matches(':hover')) return
      if (element.matches(':hover')) return
      setIsHovered(false)
    }, 300)
  }, [element])

  const cancelHide = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current)
      hideTimer.current = undefined
    }
  }, [])

  useEffect(() => {
    const enter = (): void => {
      cancelHide()
      setIsHovered(true)
    }
    const leave = (): void => {
      scheduleHide()
    }
    element.addEventListener('mouseenter', enter)
    element.addEventListener('mouseleave', leave)
    return () => {
      element.removeEventListener('mouseenter', enter)
      element.removeEventListener('mouseleave', leave)
      cancelHide()
    }
  }, [element, scheduleHide, cancelHide])

  const handleCopy = useCallback(() => {
    editor.getEditorState().read(() => {
      const node = $getNodeByKey(nodeKey)
      if ($isCodeNode(node)) {
        navigator.clipboard.writeText(node.getTextContent())
        setCopied(true)
        if (copiedTimer.current) clearTimeout(copiedTimer.current)
        copiedTimer.current = setTimeout(() => setCopied(false), 2000)
      }
    })
  }, [editor, nodeKey])

  const handleLanguageChange = useCallback(
    (lang: string) => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey)
        if ($isCodeNode(node)) {
          node.setLanguage(lang)
        }
      })
    },
    [editor, nodeKey]
  )

  const friendlyName = LANGUAGE_OPTIONS.find(([v]) => v === language)?.[1] ?? language

  const rect = element.getBoundingClientRect()
  const posTop = rect.top + 8
  const posRight = window.innerWidth - rect.right + 8

  return createPortal(
    <div
      ref={toolbarRef}
      className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-opacity duration-150 ${
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      style={{
        position: 'fixed',
        top: posTop,
        right: posRight,
        zIndex: 50,
        backgroundColor: 'var(--color-bg-popover)',
        border: '1px solid var(--color-border-subtle)'
      }}
      onMouseEnter={cancelHide}
      onMouseLeave={scheduleHide}
    >
      <div className="flex items-center gap-1 px-1 text-[11px] text-accent-main/70">
        <Code2 className="w-3 h-3" />
        <span>{friendlyName}</span>
      </div>

      <div className="w-[1px] h-3.5 bg-bg-active mx-0.5" />

      <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="w-6 h-6 flex items-center justify-center rounded text-tx-muted hover:text-tx-main hover:bg-bg-hover"
            title="Change language"
          >
            <ChevronDown className="w-3 h-3" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="bottom"
            align="end"
            sideOffset={6}
            className="z-50 min-w-[140px] max-h-[240px] overflow-y-auto rounded-lg py-1 bg-bg-popover border border-border-subtle shadow-[0_4px_16px_rgba(0,0,0,0.1)]"
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            {LANGUAGE_OPTIONS.map(([value, label]) => (
              <DropdownMenu.Item
                key={value}
          className={`px-3 py-1.5 text-xs outline-none cursor-pointer transition-colors ${
                  value === language
                    ? 'text-accent-main bg-bg-hover'
                    : 'text-tx-muted hover:text-tx-main hover:bg-bg-hover'
                }`}
                onSelect={() => handleLanguageChange(value)}
              >
                {label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <button
        type="button"
        className="w-6 h-6 flex items-center justify-center rounded text-tx-muted hover:text-tx-main hover:bg-bg-hover"
        onClick={handleCopy}
        title={copied ? 'Copied!' : 'Copy code'}
      >
        {copied ? <Check className="w-3.5 h-3.5 text-accent-main" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>,
    document.body
  )
}
