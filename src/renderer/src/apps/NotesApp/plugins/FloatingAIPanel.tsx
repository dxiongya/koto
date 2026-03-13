import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  type LexicalNode,
  type RangeSelection,
} from 'lexical'
import { $isListItemNode, $isListNode } from '@lexical/list'
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown'
import {
  Sparkles,
  Send,
  X,
  Loader2,
  FileText,
  FolderOpen,
  Terminal,
  CheckCircle2,
  XCircle,
  MessageSquare,
  RotateCcw,
  ChevronRight,
  ChevronDown,
} from 'lucide-react'
import { useUIStore } from '../../../store/useUIStore'
import { ALL_TRANSFORMERS, $fixUnconvertedHeadings } from '../LexicalEditor'

// ── Types ──

type RefType = 'file' | 'folder' | 'terminal'

interface AttachedRef {
  type: RefType
  path: string
  label: string
}

interface RefMenuItem {
  type: RefType
  path: string
  label: string
  icon: typeof FileText
}

export interface DiffLine {
  type: 'unchanged' | 'added' | 'removed'
  text: string
}

type ChatEntry =
  | { role: 'user'; content: string; refs: AttachedRef[] }
  | {
      role: 'assistant'
      content: string
      diff: DiffLine[]
      original: string
      generated: string
      status: 'pending' | 'accepted' | 'rejected'
      model: string
      providerId: string
    }
  | { role: 'note'; content: string }
  | { role: 'tool'; toolName: string; status: 'running' | 'done'; toolInput?: Record<string, unknown>; result?: string; durationMs?: number }

// ── Diff ──

export function computeLineDiff(original: string, generated: string): DiffLine[] {
  const oldLines = original.split('\n')
  const newLines = generated.split('\n')
  const m = oldLines.length
  const n = newLines.length

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

// ── Reference resolution ──

async function resolveOneRef(type: RefType, path: string): Promise<{ type: string; path: string; content: string }> {
  try {
    let content = ''
    if (type === 'file') {
      const res = await window.api.fs.readFile(path)
      content = res.ok ? res.data : `[Error: ${res.error}]`
    } else if (type === 'folder') {
      const res = await window.api.fs.readDir(path)
      content = res.ok ? res.data.map((f: { isDirectory: boolean; name: string }) => `${f.isDirectory ? '📁' : '📄'} ${f.name}`).join('\n') : `[Error: ${res.error}]`
    } else if (type === 'terminal') {
      const res = await window.api.terminal.loadBuffer(path)
      content = res.ok ? res.data : `[Error: ${res.error}]`
    }
    return { type, path, content }
  } catch (err) {
    return { type, path, content: `[Error: ${err}]` }
  }
}

// ── Markdown indent normalization ──
// Lexical uses LIST_INDENT_SIZE=4, but AI typically generates 2-space indentation.
// Math.floor(2/4)=0, so 2-space nested items are treated as same level.
// Fix: double leading spaces on list lines so 2-space becomes 4-space.
function normalizeListIndent(md: string): string {
  return md.split('\n').map((line) => {
    const m = line.match(/^( +)([-*+] \[[ x]?\] |[-*+] |\d+\. )/)
    if (m) {
      return m[1] + m[1] + line.slice(m[1].length)
    }
    return line
  }).join('\n')
}

// ── Panel Component ──

interface FloatingAIPanelProps {
  editor: ReturnType<typeof useLexicalComposerContext>[0]
  savedSelectionRef: React.MutableRefObject<RangeSelection | null>
  onClose: () => void
  filePath: string | null
}

const PANEL_W = 380
const PANEL_H_MIN = 300

export function FloatingAIPanel({ editor, savedSelectionRef, onClose, filePath }: FloatingAIPanelProps): JSX.Element {
  // ── Position (free drag) — start near the selected text ──
  const [pos, setPos] = useState(() => {
    try {
      const nativeSel = window.getSelection()
      if (nativeSel && nativeSel.rangeCount > 0) {
        const range = nativeSel.getRangeAt(0)
        // Use first client rect (first line) for focused positioning
        const rects = range.getClientRects()
        const anchor = rects.length > 0 ? rects[0] : range.getBoundingClientRect()

        // Try right of the first line of selection
        const rightX = anchor.right + 16
        if (rightX + PANEL_W <= window.innerWidth - 20) {
          return {
            x: rightX,
            y: Math.max(20, Math.min(anchor.top, window.innerHeight - PANEL_H_MIN - 20))
          }
        }
        // Not enough space on right → position below selection, left-aligned
        const fullRect = range.getBoundingClientRect()
        return {
          x: Math.max(20, Math.min(anchor.left, window.innerWidth - PANEL_W - 20)),
          y: Math.max(20, Math.min(fullRect.bottom + 8, window.innerHeight - PANEL_H_MIN - 20))
        }
      }
    } catch { /* ignore */ }
    return { x: 60, y: 60 }
  })
  const draggingRef = useRef(false)

  // ── Chat state ──
  const [chatHistory, setChatHistory] = useState<ChatEntry[]>([])
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // ── Attached refs / @ menu ──
  const [attachedRefs, setAttachedRefs] = useState<AttachedRef[]>([])
  const [showAtMenu, setShowAtMenu] = useState(false)
  const [atQuery, setAtQuery] = useState('')
  const [atMenuIndex, setAtMenuIndex] = useState(0)
  const [isDragOver, setIsDragOver] = useState(false)
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set())
  const [availableRefs, setAvailableRefs] = useState<RefMenuItem[]>([])

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const prevFileRef = useRef(filePath)

  // ── Selection text (markdown) — cached once on mount ──
  const [selectedText] = useState(() => {
    const sel = savedSelectionRef.current
    if (!sel) return ''
    let text = ''
    try {
      editor.getEditorState().read(() => {
        // Use sel directly — don't use $setSelection in .read() context (it's read-only)
        const plainText = sel.getTextContent()
        if (!plainText.trim()) { text = ''; return }

        // Try to find the markdown equivalent
        try {
          const fullMd = $convertToMarkdownString(ALL_TRANSFORMERS)
          const mdLines = fullMd.split('\n')
          const plainLines = plainText.split('\n').filter((l) => l.trim())

          const firstWords = plainLines[0]?.split(/[\s\t]+/).filter(Boolean) || []
          const lastWords = (plainLines[plainLines.length - 1] || '').split(/[\s\t]+/).filter(Boolean)

          let startIdx = -1
          let endIdx = -1

          for (let i = 0; i < mdLines.length; i++) {
            if (firstWords.length > 0 && firstWords.every((w) => mdLines[i].includes(w))) {
              startIdx = i
              break
            }
          }

          if (startIdx >= 0 && lastWords.length > 0) {
            for (let i = mdLines.length - 1; i >= startIdx; i--) {
              if (lastWords.every((w) => mdLines[i].includes(w))) {
                endIdx = i
                break
              }
            }
          }

          if (startIdx >= 0 && endIdx >= startIdx) {
            text = mdLines.slice(startIdx, endIdx + 1).join('\n')
            return
          }
        } catch { /* markdown matching failed, use plain text */ }

        text = plainText
      })
    } catch {
      text = ''
    }
    return text
  })

  // ── Highlight selected text in editor ──
  useEffect(() => {
    const markedElems: HTMLElement[] = []
    const sel = savedSelectionRef.current
    if (sel) {
      try {
        editor.getEditorState().read(() => {
          // Use sel.getNodes() directly — don't use $setSelection in .read() context
          const nodes = sel.getNodes()
          for (const node of nodes) {
            const elem = editor.getElementByKey(node.getKey())
            if (!elem) continue
            const isInline = elem.matches('span, a, code, strong, em, b, i, u, s')
            if (isInline) {
              elem.classList.add('ai-sel-highlight')
              markedElems.push(elem)
            } else {
              elem.querySelectorAll<HTMLElement>('span[data-lexical-text]').forEach((span) => {
                span.classList.add('ai-sel-highlight')
                markedElems.push(span)
              })
            }
          }
        })
      } catch {
        // Nodes may be stale — skip highlighting
      }
    }
    setTimeout(() => inputRef.current?.focus(), 50)
    return () => {
      markedElems.forEach((el) => el.classList.remove('ai-sel-highlight'))
    }
  }, [editor, savedSelectionRef])

  // ── Reset history on file change ──
  useEffect(() => {
    if (prevFileRef.current !== filePath) {
      setChatHistory([])
      setPrompt('')
      setError(null)
      prevFileRef.current = filePath
    }
  }, [filePath])

  // ── Auto-scroll chat to bottom ──
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatHistory])

  // ── Load available refs ──
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

  // ── Convert chat history to API messages ──
  const buildAPIMessages = useCallback((userPrompt: string, refs: AttachedRef[]): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> => {
    const hasSelection = !!selectedText.trim()
    const fullSystemPrompt = `You are an AI assistant embedded in a markdown notes editor. You have powerful tool capabilities and should actively use them.

## Tools — ALWAYS use when needed
You have access to these tools and MUST use them proactively:
- **web_fetch**: Fetch any web page content. Use this for any request involving URLs, web search, or online information.
- **file_read** / **file_list**: Read files and list directories.
- **search_content**: Search across files by regex.
- **terminal_exec**: Execute shell commands (10s timeout). Use for anything tools can't cover.
- **use_skill**: Load a skill to guide your approach. Check available skills when the task matches.
- **MCP tools**: Any connected MCP server tools are also available.

IMPORTANT: When the user asks you to search, fetch, look up, or gather ANY information, you MUST use tools. Never say "I can't access the internet" — you CAN via web_fetch and terminal_exec. If one tool fails, try another approach.

## Output format
${hasSelection ? `The user has selected text in the editor. Your output will REPLACE the selected text.
- Output ONLY the modified markdown content
- Relate your output to the MEANING of the selected text
- PRESERVE format: checklists stay checklists, tables stay tables, headings stay headings
- For lists/checklists: use - [ ] / - [x] syntax, 4 spaces for nesting
- For tables: use proper markdown table syntax
- For code: use fenced code blocks with language` : `No text is selected. The user is asking you to generate content or perform a task.
- Output markdown content that can be inserted into the note
- Use appropriate markdown formatting (headings, lists, tables, code blocks)`}
- If the user rejected a previous suggestion, adjust your approach based on their feedback`

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: fullSystemPrompt }
    ]

    // Build the current user prompt (may include context prefix for first turn)
    let currentPrompt = userPrompt
    if (refs.length > 0) {
      currentPrompt += '\n\n(Referenced context attached below)'
    }

    // For the first turn, merge selected text context into the user message
    // (Anthropic API requires alternating user/assistant roles — no consecutive user messages)
    if (chatHistory.length === 0 && selectedText) {
      currentPrompt = `Selected text:\n${selectedText}\n\nInstruction: ${currentPrompt}`
    }

    // Add full chat history
    for (const entry of chatHistory) {
      if (entry.role === 'user') {
        messages.push({ role: 'user', content: entry.content })
      } else if (entry.role === 'assistant') {
        let content = entry.content
        if (entry.status === 'rejected') {
          content += '\n\n[The user rejected this suggestion]'
        }
        messages.push({ role: 'assistant', content })
      } else if (entry.role === 'note') {
        // Merge note into the last user or assistant message to avoid consecutive roles
        const lastMsg = messages[messages.length - 1]
        if (lastMsg && lastMsg.role === 'assistant') {
          lastMsg.content += `\n\n[User note: ${entry.content}]`
        } else {
          messages.push({ role: 'user', content: `[Note: ${entry.content}]` })
        }
      }
    }

    // Ensure no consecutive user messages — merge if needed
    const lastMsg = messages[messages.length - 1]
    if (lastMsg && lastMsg.role === 'user') {
      lastMsg.content += '\n\n' + currentPrompt
    } else {
      messages.push({ role: 'user', content: currentPrompt })
    }

    return messages
  }, [chatHistory, selectedText])

  // ── Submit ──
  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() || loading) return
    const currentPrompt = prompt.trim()
    const currentRefs = [...attachedRefs]
    setLoading(true)
    setError(null)
    setPrompt('')

    // Add user message to history
    setChatHistory((prev) => [...prev, { role: 'user', content: currentPrompt, refs: currentRefs }])

    try {
      const provider = useUIStore.getState().getAIProviderForFeature('chat')
      if (!provider) {
        setError('No AI provider configured. Go to Settings to add one.')
        setLoading(false)
        return
      }

      // Resolve refs
      let resolvedPrompt = currentPrompt
      const REF_RE = /@(file|folder|terminal)\(([^)]+)\)/g
      const inlineMatches = [...currentPrompt.matchAll(REF_RE)]
      for (const match of inlineMatches) {
        const [, type, path] = match
        const ref = await resolveOneRef(type as 'file' | 'folder' | 'terminal', path)
        resolvedPrompt = resolvedPrompt.replace(
          `@${ref.type}(${ref.path})`,
          `\n\n--- @${ref.type}(${ref.path}) ---\n${ref.content}\n--- end ---\n`
        )
      }
      for (const ar of currentRefs) {
        if (resolvedPrompt.includes(`@${ar.type}(${ar.path})`)) continue
        const ref = await resolveOneRef(ar.type, ar.path)
        resolvedPrompt += `\n\n--- @${ref.type}(${ref.path}) ---\n${ref.content}\n--- end ---`
      }

      const messages = buildAPIMessages(resolvedPrompt, currentRefs)

      // Subscribe to tool events for real-time status
      const unsubToolEvent = window.api.ai.onToolEvent((event) => {
        if (event.type === 'tool_start') {
          setChatHistory((prev) => [...prev, {
            role: 'tool',
            toolName: event.toolName,
            status: 'running',
            toolInput: event.toolInput,
          }])
        } else if (event.type === 'tool_result') {
          setChatHistory((prev) => {
            const updated = [...prev]
            // Find the last running tool entry with this name
            for (let i = updated.length - 1; i >= 0; i--) {
              const e = updated[i]
              if (e.role === 'tool' && e.toolName === event.toolName && e.status === 'running') {
                updated[i] = { ...e, status: 'done', result: event.result, durationMs: event.durationMs }
                break
              }
            }
            return updated
          })
        }
      })

      const result = await window.api.ai.chat(provider.id, messages, 0.7, 2048, true)
      unsubToolEvent()

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

      const diff = computeLineDiff(selectedText, markdown)
      setChatHistory((prev) => [...prev, {
        role: 'assistant',
        content: markdown,
        diff,
        original: selectedText,
        generated: markdown,
        status: 'pending',
        model: result.data.model,
        providerId: provider.id
      }])

    } catch (err) {
      setError(String(err))
    }
    setLoading(false)
  }, [prompt, loading, attachedRefs, buildAPIMessages, selectedText])

  // ── Accept ──
  const handleAccept = useCallback((entryIndex: number) => {
    const entry = chatHistory[entryIndex]
    if (!entry || entry.role !== 'assistant') return
    const markdown = entry.generated

    const rootEl = editor.getRootElement()
    const scroller = rootEl?.closest('.overflow-y-auto') as HTMLElement | null
    const savedScrollTop = scroller?.scrollTop ?? 0

    const newNodeKeys: string[] = []

    editor.update(
      () => {
        const saved = savedSelectionRef.current
        if (saved) $setSelection(saved.clone())
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return

        const nodes = selection.getNodes()

        // Find replacement targets: prefer ListItemNode for list content, else top-level element
        // This prevents replacing an entire list when only one item was selected
        const targetSet = new Set<LexicalNode>()
        for (const node of nodes) {
          let cur: LexicalNode | null = node
          let listItem: LexicalNode | null = null
          while (cur) {
            if ($isListItemNode(cur)) { listItem = cur; break }
            cur = cur.getParent()
          }
          if (listItem) {
            targetSet.add(listItem)
          } else {
            const topLevel = node.getTopLevelElement()
            if (topLevel) targetSet.add(topLevel)
          }
        }
        const targets = Array.from(targetSet)
        if (targets.length === 0) return

        const lastTarget = targets[targets.length - 1]

        // Convert AI markdown to new nodes in a temporary root
        const normalizedMarkdown = normalizeListIndent(markdown)
        const root = $getRoot()
        const existingChildren = root.getChildren()
        root.clear()
        $convertFromMarkdownString(normalizedMarkdown, ALL_TRANSFORMERS)
        $fixUnconvertedHeadings()
        const newNodes = root.getChildren()
        root.clear()
        existingChildren.forEach((child) => root.append(child))

        // Check if all targets are ListItemNodes (granular list replacement)
        const allListItems = targets.every((t) => $isListItemNode(t))

        if (allListItems) {
          // Extract list items from new nodes (AI may wrap them in a ListNode)
          const newItems: LexicalNode[] = []
          for (const node of newNodes) {
            if ($isListNode(node)) {
              for (const child of node.getChildren()) {
                newItems.push(child)
              }
            } else {
              newItems.push(node)
            }
          }

          // Insert new items as siblings in the same list
          let insertAfter: LexicalNode = lastTarget
          for (const node of newItems) {
            insertAfter.insertAfter(node)
            newNodeKeys.push(node.getKey())
            insertAfter = node
          }

          // Remove only the selected list items
          for (const target of targets) {
            target.remove()
          }
        } else {
          // Top-level replacement (paragraphs, headings, etc.)
          let insertAfter: LexicalNode = lastTarget
          for (const node of newNodes) {
            insertAfter.insertAfter(node)
            newNodeKeys.push(node.getKey())
            insertAfter = node
          }

          for (const target of targets) {
            target.remove()
          }
        }
      },
      { discrete: true }
    )

    if (scroller) scroller.scrollTop = savedScrollTop

    requestAnimationFrame(() => {
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

    // Update history
    setChatHistory((prev) => prev.map((e, i) =>
      i === entryIndex && e.role === 'assistant' ? { ...e, status: 'accepted' as const } : e
    ))

    // Append to changelog
    if (filePath) {
      window.api.changelog.append({
        timestamp: Date.now(),
        filePath,
        prompt: chatHistory.filter(e => e.role === 'user').map(e => e.content).join(' → '),
        originalText: entry.original,
        generatedText: entry.generated,
        action: 'accepted',
        model: entry.model,
        providerId: entry.providerId
      })
    }

    // Auto-close panel after accept
    setTimeout(() => onClose(), 600)
  }, [chatHistory, editor, savedSelectionRef, filePath, onClose])

  // ── Reject ──
  const handleReject = useCallback((entryIndex: number) => {
    const entry = chatHistory[entryIndex]
    if (!entry || entry.role !== 'assistant') return

    setChatHistory((prev) => {
      const updated = prev.map((e, i) =>
        i === entryIndex && e.role === 'assistant' ? { ...e, status: 'rejected' as const } : e
      )
      return [...updated, { role: 'note' as const, content: 'User rejected the above suggestion. Please try a different approach.' }]
    })

    // Append to changelog
    if (filePath) {
      window.api.changelog.append({
        timestamp: Date.now(),
        filePath,
        prompt: chatHistory.filter(e => e.role === 'user').map(e => e.content).join(' → '),
        originalText: entry.original,
        generatedText: entry.generated,
        action: 'rejected',
        model: entry.model,
        providerId: entry.providerId
      })
    }

    setTimeout(() => inputRef.current?.focus(), 50)
  }, [chatHistory, filePath])

  // ── Input handlers ──
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

  // ── Drop ──
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setIsDragOver(true) }, [])
  const handleDragLeave = useCallback(() => setIsDragOver(false), [])
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const fp = e.dataTransfer.getData('text/plain')
    if (!fp || !fp.startsWith('/')) return
    const name = fp.split('/').pop() || fp
    const isDir = !name.includes('.')
    setAttachedRefs((prev) => {
      if (prev.some((r) => r.path === fp)) return prev
      return [...prev, { type: isDir ? 'folder' : 'file', path: fp, label: name.replace(/\.md$/, '') }]
    })
    inputRef.current?.focus()
  }, [])

  // ── Drag panel ──
  const onHeaderPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    draggingRef.current = true
    const startX = e.clientX
    const startY = e.clientY
    const startPos = { ...pos }

    const onMove = (me: PointerEvent): void => {
      const nx = Math.max(0, Math.min(startPos.x + (me.clientX - startX), window.innerWidth - PANEL_W))
      const ny = Math.max(0, Math.min(startPos.y + (me.clientY - startY), window.innerHeight - 60))
      setPos({ x: nx, y: ny })
    }
    const onUp = (): void => {
      draggingRef.current = false
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }, [pos])

  // Check if there's a pending diff (last assistant entry with status 'pending')
  const lastAssistantIdx = chatHistory.length - 1
  const lastEntry = chatHistory[lastAssistantIdx]
  const hasPendingDiff = lastEntry?.role === 'assistant' && lastEntry.status === 'pending'
  const showInput = !hasPendingDiff && !loading

  return createPortal(
    <div
      className="fixed z-[60] flex flex-col rounded-2xl overflow-hidden ai-diff-panel-enter"
      style={{
        left: pos.x,
        top: pos.y,
        width: PANEL_W,
        maxHeight: `calc(100vh - ${pos.y + 20}px)`,
        minHeight: PANEL_H_MIN,
        background: 'linear-gradient(180deg, rgba(30,30,30,0.98) 0%, rgba(22,22,22,0.98) 100%)',
        border: '1px solid rgba(255,255,255,0.07)',
        boxShadow: '0 12px 48px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.04)',
        backdropFilter: 'blur(20px)',
      }}
      onMouseDown={(e) => {
        const tag = (e.target as HTMLElement).tagName
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') e.preventDefault()
      }}
    >
      {/* ── Header (draggable) ── */}
      <div
        className="flex items-center gap-2.5 px-4 py-2.5 cursor-grab active:cursor-grabbing shrink-0 select-none"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        onPointerDown={onHeaderPointerDown}
      >
        <div className="flex items-center gap-2 flex-1">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(94,234,212,0.2) 0%, rgba(94,234,212,0.08) 100%)' }}>
            <Sparkles size={12} className="text-accent-main" />
          </div>
          <div className="flex flex-col">
            <span className="text-[12px] text-tx-main font-medium leading-tight">AI Assistant</span>
            {chatHistory.length > 0 && (
              <span className="text-[9px] text-tx-faint leading-tight">{chatHistory.filter(e => e.role === 'user').length} messages</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {chatHistory.length > 0 && (
            <button
              onClick={() => { setChatHistory([]); setError(null) }}
              className="w-6 h-6 flex items-center justify-center rounded-lg text-tx-faint hover:text-tx-muted hover:bg-white/[0.05] transition-all duration-200"
              title="Clear history"
            >
              <RotateCcw size={11} />
            </button>
          )}
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-lg text-tx-faint hover:text-red-400/80 hover:bg-red-400/10 transition-all duration-200"
            title="Close (Esc)"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* ── Selected text context — always visible as pinned context ── */}
      {selectedText && (
        <div className="mx-3 mt-2 mb-1 rounded-lg shrink-0" style={{ background: 'rgba(94,234,212,0.04)', border: '1px solid rgba(94,234,212,0.08)' }}>
          <div className="px-3 py-2">
            <div className="text-[9px] text-accent-main/60 uppercase tracking-wider font-medium mb-1">Selected context</div>
            <pre className="text-[11px] text-tx-muted font-mono whitespace-pre-wrap break-words max-h-[80px] overflow-y-auto leading-relaxed">
              {selectedText.length > 400 ? selectedText.slice(0, 400) + '...' : selectedText}
            </pre>
          </div>
        </div>
      )}

      {/* ── Chat History ── */}
      <div className="flex-1 overflow-y-auto min-h-0 px-3 py-2 space-y-3">
        {chatHistory.length === 0 && !selectedText && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: 'rgba(94,234,212,0.08)' }}>
              <Sparkles size={18} className="text-accent-main/40" />
            </div>
            <span className="text-[11px] text-tx-faint">Select text and describe what you want</span>
            <span className="text-[9px] text-tx-faint/60 mt-0.5">Use @ to reference files for context</span>
          </div>
        )}

        {chatHistory.map((entry, idx) => {
          if (entry.role === 'user') {
            return (
              <div key={idx} className="flex justify-end animate-in fade-in slide-in-from-right-2 duration-200">
                <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-br-md text-[11px] text-tx-main leading-relaxed"
                  style={{ background: 'rgba(94,234,212,0.08)', border: '1px solid rgba(94,234,212,0.1)' }}>
                  {entry.content}
                  {entry.refs.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5 pt-1.5" style={{ borderTop: '1px solid rgba(94,234,212,0.08)' }}>
                      {entry.refs.map((r, ri) => (
                        <span key={ri} className="text-[9px] text-accent-main/60 bg-accent-main/5 px-1.5 py-0.5 rounded-md">
                          @{r.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          }

          if (entry.role === 'note') {
            return (
              <div key={idx} className="flex justify-center py-1 animate-in fade-in duration-200">
                <span className="text-[9px] text-tx-faint/70 italic px-3 py-1 rounded-full" style={{ background: 'rgba(255,255,255,0.03)' }}>
                  {entry.content}
                </span>
              </div>
            )
          }

          if (entry.role === 'tool') {
            const isExpanded = expandedTools.has(idx)
            const toggleExpand = () => {
              setExpandedTools((prev) => {
                const next = new Set(prev)
                if (next.has(idx)) next.delete(idx); else next.add(idx)
                return next
              })
            }
            const inputSummary = entry.toolInput
              ? Object.values(entry.toolInput).map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(', ').slice(0, 80)
              : ''
            return (
              <div key={idx} className="rounded-lg animate-in fade-in duration-200 overflow-hidden"
                style={{ background: 'rgba(94,234,212,0.03)', border: '1px solid rgba(94,234,212,0.06)' }}>
                <button onClick={toggleExpand} className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-accent-main/5 transition-colors text-left">
                  {entry.status === 'running' ? (
                    <Loader2 size={10} className="text-accent-main/60 animate-spin shrink-0" />
                  ) : (
                    <CheckCircle2 size={10} className="text-emerald-400/60 shrink-0" />
                  )}
                  <span className="text-[10px] text-accent-main/70 font-mono shrink-0">{entry.toolName}</span>
                  {!isExpanded && inputSummary && (
                    <span className="text-[9px] text-tx-faint truncate flex-1">{inputSummary}</span>
                  )}
                  <span className="ml-auto shrink-0 flex items-center gap-1">
                    {entry.status === 'done' && entry.durationMs != null && (
                      <span className="text-[9px] text-tx-faint/50">{(entry.durationMs / 1000).toFixed(1)}s</span>
                    )}
                    {isExpanded ? <ChevronDown size={10} className="text-tx-faint/50" /> : <ChevronRight size={10} className="text-tx-faint/50" />}
                  </span>
                </button>
                {isExpanded && (
                  <div className="px-3 pb-2 space-y-1.5" style={{ borderTop: '1px solid rgba(94,234,212,0.06)' }}>
                    {entry.toolInput && Object.keys(entry.toolInput).length > 0 && (
                      <div className="pt-1.5">
                        <div className="text-[9px] text-tx-faint uppercase tracking-wider mb-1">Input</div>
                        <pre className="text-[10px] text-tx-muted font-mono whitespace-pre-wrap break-all leading-relaxed bg-bg-app/50 rounded px-2 py-1.5 max-h-[120px] overflow-auto">
                          {JSON.stringify(entry.toolInput, null, 2)}
                        </pre>
                      </div>
                    )}
                    {entry.status === 'done' && entry.result && (
                      <div>
                        <div className="text-[9px] text-tx-faint uppercase tracking-wider mb-1">Result</div>
                        <pre className="text-[10px] text-tx-muted font-mono whitespace-pre-wrap break-all leading-relaxed bg-bg-app/50 rounded px-2 py-1.5 max-h-[200px] overflow-auto">
                          {entry.result}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          }

          // ── Assistant message with diff ──
          const isRejected = entry.status === 'rejected'
          const isAccepted = entry.status === 'accepted'
          const isPending = entry.status === 'pending'
          const addedCount = entry.diff.filter(d => d.type === 'added').length
          const removedCount = entry.diff.filter(d => d.type === 'removed').length

          return (
            <div key={idx} className={`rounded-xl overflow-hidden animate-in fade-in slide-in-from-left-2 duration-300 ${isRejected ? 'opacity-50' : ''}`}
              style={{
                border: isAccepted ? '1px solid rgba(16,185,129,0.15)' : isRejected ? '1px solid rgba(239,68,68,0.1)' : '1px solid rgba(255,255,255,0.06)',
                background: isAccepted ? 'rgba(16,185,129,0.03)' : 'rgba(255,255,255,0.02)'
              }}>
              {/* Diff header */}
              <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <div className={`w-4 h-4 rounded-md flex items-center justify-center ${
                  isAccepted ? 'bg-emerald-500/15' : isRejected ? 'bg-red-500/10' : 'bg-accent-main/10'
                }`}>
                  {isAccepted ? <CheckCircle2 size={9} className="text-emerald-400" /> :
                   isRejected ? <XCircle size={9} className="text-red-400/60" /> :
                   <MessageSquare size={9} className="text-accent-main" />}
                </div>
                <span className="text-[10px] text-tx-muted flex-1 font-medium">
                  {isAccepted ? 'Applied' : isRejected ? 'Rejected' : 'Proposed changes'}
                </span>
                <div className="flex items-center gap-2">
                  {addedCount > 0 && (
                    <span className="text-[9px] text-emerald-400/80 font-mono">+{addedCount}</span>
                  )}
                  {removedCount > 0 && (
                    <span className="text-[9px] text-red-400/80 font-mono">-{removedCount}</span>
                  )}
                </div>
              </div>

              {/* Diff lines */}
              <div className={`max-h-[200px] overflow-y-auto ${isRejected ? 'opacity-60' : ''}`}>
                <div className="text-[10px] font-mono leading-[1.7]">
                  {entry.diff.map((line, li) => (
                    <div
                      key={li}
                      className={`flex items-start ${
                        line.type === 'added'
                          ? 'bg-emerald-500/[0.07]'
                          : line.type === 'removed'
                          ? 'bg-red-500/[0.05]'
                          : ''
                      }`}
                      style={{ borderLeft: line.type === 'added' ? '2px solid rgba(16,185,129,0.4)' : line.type === 'removed' ? '2px solid rgba(239,68,68,0.3)' : '2px solid transparent' }}
                    >
                      <span className={`inline-flex items-center justify-center w-6 shrink-0 text-[9px] select-none py-0.5 font-mono ${
                        line.type === 'added' ? 'text-emerald-500/50' : line.type === 'removed' ? 'text-red-400/50' : 'text-tx-faint/20'
                      }`}>
                        {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                      </span>
                      <span className={`flex-1 px-1.5 py-0.5 whitespace-pre-wrap break-words ${
                        line.type === 'added' ? 'text-emerald-300/90' : line.type === 'removed' ? 'text-red-400/60 line-through decoration-red-400/30' : 'text-tx-muted/50'
                      }`}>
                        {line.text || '\u00A0'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Accept / Reject buttons */}
              {isPending && (
                <div className="flex items-center gap-2 px-3 py-2.5" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                  <button
                    onClick={() => handleReject(idx)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-medium text-tx-faint transition-all duration-200 hover:text-red-400 hover:bg-red-400/8"
                    style={{ background: 'rgba(255,255,255,0.03)' }}
                  >
                    <XCircle size={11} /> Reject
                  </button>
                  <button
                    onClick={() => handleAccept(idx)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-medium text-emerald-300 transition-all duration-200 hover:brightness-110"
                    style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.15) 0%, rgba(16,185,129,0.1) 100%)' }}
                  >
                    <CheckCircle2 size={11} /> Accept
                  </button>
                </div>
              )}
            </div>
          )
        })}

        {/* Loading indicator */}
        {loading && (
          <div className="flex items-center gap-2.5 px-1 py-2 animate-in fade-in duration-200">
            <div className="w-5 h-5 rounded-lg flex items-center justify-center" style={{ background: 'rgba(94,234,212,0.08)' }}>
              <Loader2 size={11} className="animate-spin text-accent-main" />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] text-tx-muted">Generating response...</span>
              <div className="flex gap-0.5 mt-1">
                <span className="w-1 h-1 rounded-full bg-accent-main/40 animate-pulse" style={{ animationDelay: '0ms' }} />
                <span className="w-1 h-1 rounded-full bg-accent-main/40 animate-pulse" style={{ animationDelay: '200ms' }} />
                <span className="w-1 h-1 rounded-full bg-accent-main/40 animate-pulse" style={{ animationDelay: '400ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* ── Attached refs ── */}
      {attachedRefs.length > 0 && (
        <div className="flex flex-wrap gap-1 px-4 py-2 shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
          {attachedRefs.map((ref, i) => (
            <span key={`${ref.type}-${ref.path}`} className="inline-flex items-center gap-1 text-[10px] text-accent-main/80 pl-2 pr-1 py-0.5 rounded-md" style={{ background: 'rgba(94,234,212,0.06)', border: '1px solid rgba(94,234,212,0.1)' }}>
              {ref.type === 'file' ? <FileText size={9} /> : ref.type === 'folder' ? <FolderOpen size={9} /> : <Terminal size={9} />}
              <span className="max-w-[80px] truncate">{ref.label}</span>
              <button onClick={() => removeRef(i)} className="w-4 h-4 flex items-center justify-center rounded hover:bg-accent-main/15 transition-colors ml-0.5">
                <X size={8} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="px-4 pb-2 shrink-0">
          <div className="text-[10px] text-red-400 rounded-lg px-3 py-2" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.12)' }}>
            {error}
          </div>
        </div>
      )}

      {/* ── Input area ── */}
      {showInput && (
        <div
          className={`shrink-0 transition-colors duration-200 ${isDragOver ? 'bg-accent-main/5' : ''}`}
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="relative px-4 pt-2.5 pb-1">
            <textarea
              ref={inputRef}
              value={prompt}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={chatHistory.length > 0 ? 'Refine your request...' : (isDragOver ? 'Drop files here...' : 'Describe what you want... @ for context')}
              className="w-full bg-transparent text-tx-main text-[12px] resize-none outline-none placeholder-tx-faint/50 min-h-[36px] max-h-[80px] leading-relaxed"
              rows={2}
              disabled={loading}
            />

            {/* @ menu */}
            {showAtMenu && filteredAtItems.length > 0 && (
              <div className="absolute left-3 bottom-full mb-1 z-50 rounded-xl shadow-lg py-1 min-w-[220px] max-h-[180px] overflow-y-auto"
                style={{ background: 'rgba(30,30,30,0.98)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(16px)' }}>
                {filteredAtItems.map((item, i) => {
                  const Icon = item.icon
                  return (
                    <button
                      key={`${item.type}-${item.path}`}
                      className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-[11px] transition-colors duration-150 ${
                        i === atMenuIndex ? 'text-accent-main' : 'text-tx-muted hover:text-tx-main'
                      }`}
                      style={i === atMenuIndex ? { background: 'rgba(94,234,212,0.08)' } : undefined}
                      onMouseDown={(e) => { e.preventDefault(); selectAtItem(item) }}
                      onMouseEnter={() => setAtMenuIndex(i)}
                    >
                      <Icon size={12} className="shrink-0 opacity-60" />
                      <span className="truncate flex-1">{item.label}</span>
                      <span className="text-[9px] text-tx-faint/50 font-mono">{item.type}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between px-4 py-2" style={{ borderTop: '1px solid rgba(255,255,255,0.03)' }}>
            <span className="text-[9px] text-tx-faint/40 font-mono">⌘↵ send · @ refs</span>
            <button
              onClick={handleSubmit}
              disabled={!prompt.trim() || loading}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-medium transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
              style={prompt.trim() ? {
                background: 'linear-gradient(135deg, rgba(94,234,212,0.2) 0%, rgba(94,234,212,0.12) 100%)',
                color: 'rgb(94,234,212)'
              } : {
                background: 'rgba(255,255,255,0.03)',
                color: 'rgba(255,255,255,0.2)'
              }}
            >
              <Send size={10} />
              Send
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}
