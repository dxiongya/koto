import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  $createParagraphNode,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
  COMMAND_PRIORITY_LOW,
  type LexicalNode,
  type RangeSelection,
  type ElementNode
} from 'lexical'
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown'
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
  Sparkles,
  Send,
  X,
  Loader2,
  FileText,
  FolderOpen,
  Terminal,
  CheckCircle2,
  XCircle
} from 'lucide-react'
import { useUIStore } from '../../../store/useUIStore'
import { ALL_TRANSFORMERS } from '../LexicalEditor'

// ── Inline AI Panel types ──

interface AttachedRef {
  type: 'file' | 'folder' | 'terminal'
  path: string
  label: string
}

interface RefMenuItem {
  type: 'file' | 'folder' | 'terminal'
  path: string
  label: string
  icon: typeof FileText
}

// ── Reference resolution (shared with AICommandNode) ──

async function resolveOneRef(type: 'file' | 'folder' | 'terminal', path: string): Promise<{ type: string; path: string; content: string }> {
  try {
    let content = ''
    if (type === 'file') {
      const res = await window.api.fs.readFile(path)
      content = res.ok ? res.data : `[Error: ${res.error}]`
    } else if (type === 'folder') {
      const res = await window.api.fs.readDir(path)
      content = res.ok ? res.data.map((f) => `${f.isDirectory ? '📁' : '📄'} ${f.name}`).join('\n') : `[Error: ${res.error}]`
    } else if (type === 'terminal') {
      const res = await window.api.terminal.loadBuffer(path)
      content = res.ok ? res.data : `[Error: ${res.error}]`
    }
    return { type, path, content }
  } catch (err) {
    return { type, path, content: `[Error: ${err}]` }
  }
}

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

    const rect = range.getBoundingClientRect()
    const toolbarH = 36
    const gap = 8

    let top = rect.top - toolbarH - gap
    let left = Math.max(160, Math.min(rect.left + rect.width / 2, window.innerWidth - 160))

    if (top < 32 || isCodeBlock) {
      top = rect.bottom + gap
    }

    setPosition({ top, left })
    setIsVisible(true)
  }, [editor])

  useEffect(() => {
    return editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        updateToolbar()
        return false
      },
      COMMAND_PRIORITY_LOW
    )
  }, [editor, updateToolbar])

  // Close link/AI mode on outside click
  useEffect(() => {
    if (!linkMode && !aiMode) return
    const handler = (e: MouseEvent): void => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        if (linkMode) {
          setLinkMode(false)
          linkModeRef.current = false
        }
        if (aiMode) {
          setAiMode(false)
          aiModeRef.current = false
        }
        savedSelectionRef.current = null
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [linkMode, aiMode])

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

  // ── AI mode: floating panel instead of DecoratorNode ──
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
    setAiMode(false)
    aiModeRef.current = false
    savedSelectionRef.current = null
    editor.focus()
  }, [editor])

  if (!isVisible) return null

  return createPortal(
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

        {/* AI floating panel — expands below the toolbar buttons */}
        {aiMode && (
          <FloatingAIPanel
            editor={editor}
            savedSelectionRef={savedSelectionRef}
            onClose={cancelAi}
          />
        )}
      </div>
    </div>,
    document.body
  )
}

// ── Simple line-based diff ──

interface DiffLine {
  type: 'unchanged' | 'added' | 'removed'
  text: string
}

/** Compute a simple LCS-based line diff between two texts */
function computeLineDiff(original: string, generated: string): DiffLine[] {
  const oldLines = original.split('\n')
  const newLines = generated.split('\n')
  const m = oldLines.length
  const n = newLines.length

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Backtrack to build diff
  const result: DiffLine[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({ type: 'unchanged', text: oldLines[i - 1] })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: 'added', text: newLines[j - 1] })
      j--
    } else {
      result.push({ type: 'removed', text: oldLines[i - 1] })
      i--
    }
  }
  return result.reverse()
}

// ── Floating AI Panel (portal-based, no DecoratorNode) ──

function FloatingAIPanel({
  editor,
  savedSelectionRef,
  onClose,
}: {
  editor: ReturnType<typeof useLexicalComposerContext>[0]
  savedSelectionRef: React.MutableRefObject<RangeSelection | null>
  onClose: () => void
}): JSX.Element {
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attachedRefs, setAttachedRefs] = useState<AttachedRef[]>([])
  const [showAtMenu, setShowAtMenu] = useState(false)
  const [atQuery, setAtQuery] = useState('')
  const [atMenuIndex, setAtMenuIndex] = useState(0)
  const [isDragOver, setIsDragOver] = useState(false)
  const [availableRefs, setAvailableRefs] = useState<RefMenuItem[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const atMenuRef = useRef<HTMLDivElement>(null)

  const [diffData, setDiffData] = useState<{ original: string; generated: string; diff: DiffLine[] } | null>(null)

  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null)
  const draggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 })

  const selectedText = (() => {
    const sel = savedSelectionRef.current
    if (!sel) return ''
    let text = ''
    editor.getEditorState().read(() => {
      // Convert the full document to markdown, then extract only the
      // lines that belong to the selected top-level elements.
      const fullMd = $convertToMarkdownString(ALL_TRANSFORMERS)
      const plainText = sel.getTextContent()

      // Fast path: if plain text is short, just use it
      if (!plainText.trim()) { text = ''; return }

      // Match lines in the full markdown that contain selected text fragments
      const selFragments = plainText.split('\n').map((l) => l.trim()).filter(Boolean)
      const mdLines = fullMd.split('\n')
      const matched: string[] = []
      let fi = 0
      for (const mdLine of mdLines) {
        if (fi >= selFragments.length) break
        // Check if this md line contains the next expected text fragment
        if (mdLine.includes(selFragments[fi])) {
          matched.push(mdLine)
          fi++
        }
      }
      text = matched.length > 0 ? matched.join('\n') : plainText
    })
    return text
  })()

  // Auto-focus & highlight the selected range in the editor
  useEffect(() => {
    const markedElems: HTMLElement[] = []
    const sel = savedSelectionRef.current
    if (sel) {
      editor.getEditorState().read(() => {
        const nodes = sel.getNodes()
        for (const node of nodes) {
          const elem = editor.getElementByKey(node.getKey())
          if (!elem) continue
          // Only highlight inline text spans, not block containers
          const isInline = elem.matches('span, a, code, strong, em, b, i, u, s')
          if (isInline) {
            elem.classList.add('ai-sel-highlight')
            markedElems.push(elem)
          } else {
            // For block elements, highlight their direct text-bearing children
            elem.querySelectorAll<HTMLElement>('span[data-lexical-text]').forEach((span) => {
              span.classList.add('ai-sel-highlight')
              markedElems.push(span)
            })
          }
        }
      })
    }

    setTimeout(() => inputRef.current?.focus(), 50)

    return () => {
      markedElems.forEach((el) => el.classList.remove('ai-sel-highlight'))
    }
  }, [editor, savedSelectionRef])

  // Load available refs
  useEffect(() => {
    void (async () => {
      const result: RefMenuItem[] = []
      const storeState = useUIStore.getState()

      try {
        const notesDir = storeState.liteHome ? `${storeState.liteHome}/notes` : null
        if (notesDir) {
          const res = await window.api.fs.readDir(notesDir)
          if (res.ok) {
            for (const f of res.data) {
              if (f.isDirectory) {
                result.push({ type: 'folder', path: f.path, label: f.name, icon: FolderOpen })
                const sub = await window.api.fs.readDir(f.path)
                if (sub.ok) {
                  for (const sf of sub.data) {
                    if (!sf.isDirectory && sf.name.endsWith('.md')) {
                      result.push({ type: 'file', path: sf.path, label: `${f.name}/${sf.name.replace(/\.md$/, '')}`, icon: FileText })
                    }
                  }
                }
              } else if (f.name.endsWith('.md')) {
                result.push({ type: 'file', path: f.path, label: f.name.replace(/\.md$/, ''), icon: FileText })
              }
            }
          }
        }
        if (storeState.codeProjectPath) {
          result.push({ type: 'folder', path: storeState.codeProjectPath, label: storeState.codeProjectPath.split('/').pop() || 'workspace', icon: FolderOpen })
        }
      } catch { /* ignore */ }

      for (const t of storeState.terminalSessions) {
        result.push({ type: 'terminal', path: t.id, label: t.title || `Terminal ${t.id}`, icon: Terminal })
      }
      setAvailableRefs(result)
    })()
  }, [])

  const filteredAtItems = availableRefs.filter((item) =>
    !atQuery || item.label.toLowerCase().includes(atQuery.toLowerCase()) || item.type.includes(atQuery.toLowerCase())
  )

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() || loading) return
    setLoading(true)
    setError(null)

    try {
      const provider = useUIStore.getState().getAIProviderForFeature('chat')
      if (!provider) {
        setError('No AI provider configured. Go to Settings to add one.')
        setLoading(false)
        return
      }

      // Resolve refs
      const REF_RE = /@(file|folder|terminal)\(([^)]+)\)/g
      const inlineMatches = [...prompt.matchAll(REF_RE)]
      let resolvedPrompt = prompt

      for (const match of inlineMatches) {
        const [, type, path] = match
        const ref = await resolveOneRef(type as 'file' | 'folder' | 'terminal', path)
        resolvedPrompt = resolvedPrompt.replace(
          `@${ref.type}(${ref.path})`,
          `\n\n--- @${ref.type}(${ref.path}) ---\n${ref.content}\n--- end ---\n`
        )
      }

      // Attached refs
      for (const ar of attachedRefs) {
        if (resolvedPrompt.includes(`@${ar.type}(${ar.path})`)) continue
        const ref = await resolveOneRef(ar.type, ar.path)
        resolvedPrompt += `\n\n--- @${ref.type}(${ref.path}) ---\n${ref.content}\n--- end ---`
      }

      const systemPrompt = `You are an AI assistant embedded in a markdown notes editor. Generate markdown content based on the user's request.

Rules:
- Output ONLY the markdown content, no explanations or wrapping
- For tables, use proper markdown table syntax
- For code, use fenced code blocks with language
- For lists, use proper markdown list syntax
- For checklists, use - [ ] syntax
- Be concise and well-structured
- If the user provides context data (files, folders, terminal output), use it to generate relevant content`

      const userPrompt = selectedText
        ? `Context (selected text in editor):\n${selectedText}\n\nRequest: ${resolvedPrompt}`
        : resolvedPrompt

      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: userPrompt },
      ]

      const result = await window.api.ai.chat(provider.id, messages, 0.7, 2048)

      if (result.ok) {
        useUIStore.getState().trackAIUsage(provider.id, 'chat', result.data.usage)
      } else {
        useUIStore.getState().trackAIUsage(provider.id, 'chat', undefined, true)
      }

      if (!result.ok) {
        setError((result as { error: string }).error)
        setLoading(false)
        return
      }

      const markdown = result.data.content.trim()
      if (!markdown) {
        setError('AI returned empty response')
        setLoading(false)
        return
      }

      // Show diff view instead of directly inserting
      const diff = computeLineDiff(selectedText, markdown)
      setDiffData({ original: selectedText, generated: markdown, diff })
    } catch (err) {
      setError(String(err))
    }
    setLoading(false)
  }, [prompt, selectedText, loading, editor, savedSelectionRef, attachedRefs, onClose])

  const [isExiting, setIsExiting] = useState(false)

  // ── Accept: replace in-place, preserve scroll position ──
  const handleAccept = useCallback(() => {
    if (!diffData) return
    const markdown = diffData.generated

    // Find the scroll container and save its scroll position
    const rootEl = editor.getRootElement()
    const scroller = rootEl?.closest('.overflow-y-auto') as HTMLElement | null
    const savedScrollTop = scroller?.scrollTop ?? 0

    // Do the replacement synchronously — no delays
    const newNodeKeys: string[] = []

    editor.update(
      () => {
        const saved = savedSelectionRef.current
        if (saved) $setSelection(saved.clone())

        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return

        const nodes = selection.getNodes()
        const topLevelSet = new Set<LexicalNode>()
        for (const node of nodes) {
          const topLevel = node.getTopLevelElement()
          if (topLevel) topLevelSet.add(topLevel)
        }
        const topLevels = Array.from(topLevelSet)
        if (topLevels.length === 0) return

        const lastTopLevel = topLevels[topLevels.length - 1]

        // Parse markdown via temporary root trick
        const root = $getRoot()
        const existingChildren = root.getChildren()

        root.clear()
        $convertFromMarkdownString(markdown, ALL_TRANSFORMERS)
        const newNodes = root.getChildren()

        root.clear()
        existingChildren.forEach((child) => root.append(child))

        // Insert new nodes after the last selected top-level element
        let insertAfter: LexicalNode = lastTopLevel
        for (const node of newNodes) {
          insertAfter.insertAfter(node)
          newNodeKeys.push(node.getKey())
          insertAfter = node
        }

        // Remove the originals
        for (const topLevel of topLevels) {
          topLevel.remove()
        }
      },
      { discrete: true }
    )

    // Immediately restore scroll position to prevent any jump
    if (scroller) {
      scroller.scrollTop = savedScrollTop
    }

    // Add a subtle green glow to newly inserted content (non-disruptive)
    requestAnimationFrame(() => {
      // Re-pin scroll in case Lexical's DOM update shifted it
      if (scroller) scroller.scrollTop = savedScrollTop

      for (const key of newNodeKeys) {
        const elem = editor.getElementByKey(key)
        if (!elem) continue
        elem.querySelectorAll<HTMLElement>('span[data-lexical-text], p, li, td, th, h1, h2, h3, h4, h5, h6').forEach((child) => {
          child.classList.add('ai-diff-inserted')
        })
        if (!elem.querySelector('span[data-lexical-text]')) {
          elem.classList.add('ai-diff-inserted')
        }
      }
    })

    onClose()
  }, [diffData, editor, savedSelectionRef, onClose])

  // ── Reject: animate out, go back to prompt ──
  const handleReject = useCallback(() => {
    setIsExiting(true)
    setTimeout(() => {
      setDiffData(null)
      setIsExiting(false)
    }, 200)
  }, [])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setPrompt(val)
    const cursor = e.target.selectionStart
    const textBefore = val.slice(0, cursor)
    const atMatch = textBefore.match(/@([^\s@]*)$/)
    if (atMatch) {
      setAtQuery(atMatch[1])
      setAtMenuIndex(0)
      setShowAtMenu(true)
    } else {
      setShowAtMenu(false)
    }
  }, [])

  const selectAtItem = useCallback((item: RefMenuItem) => {
    setAttachedRefs((prev) => {
      if (prev.some((r) => r.type === item.type && r.path === item.path)) return prev
      return [...prev, { type: item.type, path: item.path, label: item.label }]
    })
    const cursor = inputRef.current?.selectionStart ?? prompt.length
    const textBefore = prompt.slice(0, cursor)
    const atMatch = textBefore.match(/@([^\s@]*)$/)
    if (atMatch) {
      setPrompt(prompt.slice(0, cursor - atMatch[0].length) + prompt.slice(cursor))
    }
    setShowAtMenu(false)
    inputRef.current?.focus()
  }, [prompt])

  const removeRef = useCallback((idx: number) => {
    setAttachedRefs((prev) => prev.filter((_, i) => i !== idx))
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (showAtMenu && filteredAtItems.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAtMenuIndex((p) => (p < filteredAtItems.length - 1 ? p + 1 : 0)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setAtMenuIndex((p) => (p > 0 ? p - 1 : filteredAtItems.length - 1)); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); const item = filteredAtItems[atMenuIndex]; if (item) selectAtItem(item); return }
      if (e.key === 'Escape') { e.preventDefault(); setShowAtMenu(false); return }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSubmit() }
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }, [handleSubmit, onClose, showAtMenu, filteredAtItems, atMenuIndex, selectAtItem])

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setIsDragOver(true) }, [])
  const handleDragLeave = useCallback(() => setIsDragOver(false), [])
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const filePath = e.dataTransfer.getData('text/plain')
    if (!filePath || !filePath.startsWith('/')) return
    const name = filePath.split('/').pop() || filePath
    const isDir = !name.includes('.')
    setAttachedRefs((prev) => {
      if (prev.some((r) => r.path === filePath)) return prev
      return [...prev, { type: isDir ? 'folder' : 'file', path: filePath, label: name.replace(/\.md$/, '') }]
    })
    inputRef.current?.focus()
  }, [])

  // ── Drag support ──
  const onDragHandleDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    draggingRef.current = true
    const startX = e.clientX
    const startY = e.clientY
    const ox = dragOffset?.x ?? 0
    const oy = dragOffset?.y ?? 0
    dragStartRef.current = { x: startX, y: startY, ox, oy }

    const onMove = (me: PointerEvent): void => {
      const dx = me.clientX - startX
      const dy = me.clientY - startY
      setDragOffset({ x: ox + dx, y: oy + dy })
    }
    const onUp = (): void => {
      draggingRef.current = false
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }, [dragOffset])

  // Click a diff line → scroll to corresponding content in editor
  const handleDiffLineClick = useCallback((lineText: string, lineType: 'added' | 'removed' | 'unchanged') => {
    if (lineType === 'added' || !lineText.trim()) return
    // For removed/unchanged lines, scroll to the matching content in the editor
    const sel = savedSelectionRef.current
    if (!sel) return
    editor.getEditorState().read(() => {
      const nodes = sel.getNodes()
      const plain = lineText.replace(/^[#\-*>\s]+/, '').trim()
      if (!plain) return
      for (const node of nodes) {
        const elem = editor.getElementByKey(node.getKey())
        if (!elem) continue
        if (elem.textContent?.includes(plain)) {
          elem.scrollIntoView({ behavior: 'smooth', block: 'center' })
          // Brief flash
          elem.style.transition = 'outline 0.2s ease'
          elem.style.outline = '2px solid rgba(94, 234, 212, 0.5)'
          elem.style.outlineOffset = '2px'
          elem.style.borderRadius = '4px'
          setTimeout(() => {
            elem.style.outline = 'none'
          }, 800)
          break
        }
      }
    })
  }, [editor, savedSelectionRef])

  // ── Diff View ──
  if (diffData) {
    const addedCount = diffData.diff.filter(d => d.type === 'added').length
    const removedCount = diffData.diff.filter(d => d.type === 'removed').length
    const unchangedCount = diffData.diff.filter(d => d.type === 'unchanged').length

    return (
      <div
        className={`border-t border-border-subtle ${isExiting ? 'ai-diff-panel-exit' : 'ai-diff-panel-enter'}`}
        style={dragOffset ? { transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` } : undefined}
      >
        {/* Drag handle */}
        <div
          className="flex items-center justify-center py-1 cursor-grab active:cursor-grabbing border-b border-border-subtle hover:bg-bg-hover/50 transition-colors"
          onPointerDown={onDragHandleDown}
        >
          <div className="w-8 h-1 rounded-full bg-tx-faint/40" />
        </div>

        {/* Diff header */}
        <div className="px-3 py-2 border-b border-border-subtle flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-accent-main/15 flex items-center justify-center">
            <Sparkles size={10} className="text-accent-main" />
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] text-tx-main font-medium leading-none">Changes Preview</span>
            <div className="flex items-center gap-2 mt-1">
              {addedCount > 0 && (
                <span className="text-[9px] text-emerald-400 flex items-center gap-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                  +{addedCount}
                </span>
              )}
              {removedCount > 0 && (
                <span className="text-[9px] text-red-400 flex items-center gap-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
                  -{removedCount}
                </span>
              )}
              {unchangedCount > 0 && (
                <span className="text-[9px] text-tx-faint">{unchangedCount} unchanged</span>
              )}
            </div>
          </div>
        </div>

        {/* Diff content */}
        <div className="max-h-[260px] overflow-y-auto scrollbar-thin">
          <div className="text-[11px] font-mono leading-[1.7] py-1">
            {diffData.diff.map((line, i) => {
              const isClickable = line.type !== 'added' && line.text.trim()
              return (
                <div
                  key={i}
                  className={`ai-diff-line flex items-start group ${
                    line.type === 'added'
                      ? 'bg-emerald-500/10 border-l-2 border-emerald-500/50'
                      : line.type === 'removed'
                      ? 'bg-red-500/8 border-l-2 border-red-500/40'
                      : 'border-l-2 border-transparent'
                  } ${isClickable ? 'cursor-pointer hover:bg-white/[0.03]' : ''}`}
                  style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
                  onClick={isClickable ? () => handleDiffLineClick(line.text, line.type) : undefined}
                >
                  {/* Gutter */}
                  <span className={`inline-flex items-center justify-center w-6 shrink-0 text-[9px] select-none py-px ${
                    line.type === 'added' ? 'text-emerald-400/70' : line.type === 'removed' ? 'text-red-400/70' : 'text-tx-faint/40'
                  }`}>
                    {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                  </span>
                  {/* Content */}
                  <span className={`flex-1 px-2 py-px whitespace-pre-wrap break-words ${
                    line.type === 'added'
                      ? 'text-emerald-300'
                      : line.type === 'removed'
                      ? 'text-red-400/80 line-through decoration-red-400/40'
                      : 'text-tx-muted/80'
                  }`}>
                    {line.text || '\u00A0'}
                  </span>
                  {/* Jump indicator for clickable lines */}
                  {isClickable && (
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity pr-2 py-px text-tx-faint/50 text-[9px]">
                      ↗
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Accept / Reject actions */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-t border-border-subtle">
          <button
            onClick={handleReject}
            className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-tx-muted bg-bg-hover hover:bg-bg-active hover:text-red-400 transition-all duration-200"
          >
            <XCircle size={12} />
            Reject
          </button>
          <button
            onClick={handleAccept}
            className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25 transition-all duration-200 ai-accept-pulse"
          >
            <CheckCircle2 size={12} />
            Accept
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`border-t border-border-subtle transition-colors ${isDragOver ? 'bg-accent-main/10' : ''}`}
      style={dragOffset ? { transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` } : undefined}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag handle */}
      <div
        className="flex items-center justify-center py-1 cursor-grab active:cursor-grabbing border-b border-border-subtle hover:bg-bg-hover/50 transition-colors"
        onPointerDown={onDragHandleDown}
      >
        <div className="w-8 h-1 rounded-full bg-tx-faint/40" />
      </div>

      {/* Selected text preview */}
      {selectedText && (
        <div className="px-3 py-1.5 border-b border-border-subtle bg-bg-app/50">
          <div className="text-[10px] text-tx-faint mb-0.5">Selected text:</div>
          <pre className="text-[11px] text-tx-muted font-mono whitespace-pre-wrap break-words max-h-[60px] overflow-y-auto leading-relaxed">
            {selectedText.length > 200 ? selectedText.slice(0, 200) + '...' : selectedText}
          </pre>
        </div>
      )}

      {/* Attached refs */}
      {attachedRefs.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 py-1.5 border-b border-border-subtle">
          {attachedRefs.map((ref, i) => (
            <span key={`${ref.type}-${ref.path}`} className="inline-flex items-center gap-1 text-[10px] text-accent-main bg-accent-main/10 pl-1.5 pr-0.5 py-0.5 rounded">
              {ref.type === 'file' ? <FileText size={9} /> : ref.type === 'folder' ? <FolderOpen size={9} /> : <Terminal size={9} />}
              <span className="max-w-[100px] truncate">{ref.label}</span>
              <button onClick={() => removeRef(i)} className="w-3 h-3 flex items-center justify-center rounded-full hover:bg-accent-main/20">
                <X size={7} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="relative px-3 py-1.5">
        <textarea
          ref={inputRef}
          value={prompt}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={isDragOver ? 'Drop files here...' : 'Describe what you want... @ for context'}
          className="w-[280px] bg-transparent text-tx-main text-xs resize-none outline-none placeholder-tx-faint min-h-[32px] max-h-[80px]"
          rows={2}
          disabled={loading}
        />

        {/* @ menu */}
        {showAtMenu && filteredAtItems.length > 0 && (
          <div ref={atMenuRef} className="absolute left-3 bottom-full mb-1 z-50 bg-bg-popover border border-border-subtle rounded-lg shadow-lg py-1 min-w-[200px] max-h-[160px] overflow-y-auto">
            {filteredAtItems.map((item, i) => {
              const Icon = item.icon
              return (
                <button
                  key={`${item.type}-${item.path}`}
                  className={`w-full text-left px-2.5 py-1 flex items-center gap-2 text-[11px] transition-colors ${
                    i === atMenuIndex ? 'bg-accent-bg text-accent-main' : 'text-tx-muted hover:bg-bg-hover'
                  }`}
                  onMouseDown={(e) => { e.preventDefault(); selectAtItem(item) }}
                  onMouseEnter={() => setAtMenuIndex(i)}
                >
                  <Icon size={12} className="shrink-0" />
                  <span className="truncate">{item.label}</span>
                  <span className="text-[9px] text-tx-faint ml-auto">{item.type}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 pb-1.5">
          <div className="text-[10px] text-red-400 bg-red-500/10 rounded px-2 py-1">{error}</div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-border-subtle">
        <span className="text-[9px] text-tx-faint">
          {loading ? 'Generating...' : '⌘↵ generate · @ context'}
        </span>
        <button
          onClick={handleSubmit}
          disabled={!prompt.trim() || loading}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-accent-main/15 text-accent-main hover:bg-accent-main/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />}
          {loading ? 'Generating' : 'Generate'}
        </button>
      </div>
    </div>
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
