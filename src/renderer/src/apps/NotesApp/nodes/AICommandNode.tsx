import { useCallback, useRef, useState, useEffect, type JSX } from 'react'
import {
  DecoratorNode,
  $getNodeByKey,
  $createParagraphNode,
  $createTextNode,
  type DOMConversionMap,
  type DOMExportOutput,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
  type ElementNode,
} from 'lexical'
import { Loader2, Sparkles, Send, X, FileText, FolderOpen, Terminal, ChevronDown, ChevronUp } from 'lucide-react'
import { useUIStore } from '../../../store/useUIStore'

// ── Types ──

export type SerializedAICommandNode = Spread<
  { prompt: string; selectedText: string },
  SerializedLexicalNode
>

// ── Reference types ──

interface AttachedRef {
  type: 'file' | 'folder' | 'terminal'
  path: string
  label: string // display name
}

// ── Context reference resolution ──

const REF_RE = /@(file|folder|terminal)\(([^)]+)\)/g

interface ResolvedRef {
  type: 'file' | 'folder' | 'terminal'
  path: string
  content: string
}

async function resolveReferences(text: string, attachedRefs: AttachedRef[]): Promise<{ prompt: string; refs: ResolvedRef[] }> {
  const refs: ResolvedRef[] = []

  // Resolve inline @references from text
  const matches = [...text.matchAll(REF_RE)]
  for (const match of matches) {
    const [, type, path] = match
    const ref = await resolveOneRef(type as 'file' | 'folder' | 'terminal', path)
    refs.push(ref)
  }

  // Resolve attached refs (from drag-and-drop / picker)
  for (const ar of attachedRefs) {
    // Skip if already referenced inline
    if (refs.some((r) => r.type === ar.type && r.path === ar.path)) continue
    const ref = await resolveOneRef(ar.type, ar.path)
    refs.push(ref)
  }

  // Build prompt with resolved context
  let resolvedPrompt = text
  for (const ref of refs) {
    const inlinePattern = `@${ref.type}(${ref.path})`
    if (resolvedPrompt.includes(inlinePattern)) {
      resolvedPrompt = resolvedPrompt.replace(
        inlinePattern,
        `\n\n--- @${ref.type}(${ref.path}) ---\n${ref.content}\n--- end ---\n`
      )
    }
  }

  // Append attached refs that aren't inline
  const attachedOnly = refs.filter((r) => !text.includes(`@${r.type}(${r.path})`))
  if (attachedOnly.length > 0) {
    resolvedPrompt += '\n\n' + attachedOnly.map(
      (r) => `--- @${r.type}(${r.path}) ---\n${r.content}\n--- end ---`
    ).join('\n\n')
  }

  return { prompt: resolvedPrompt, refs }
}

async function resolveOneRef(type: 'file' | 'folder' | 'terminal', path: string): Promise<ResolvedRef> {
  try {
    let content = ''
    if (type === 'file') {
      const res = await window.api.fs.readFile(path)
      content = res.ok ? res.data : `[Error reading file: ${res.error}]`
    } else if (type === 'folder') {
      const res = await window.api.fs.readDir(path)
      if (res.ok) {
        content = res.data.map((f) => `${f.isDirectory ? '📁' : '📄'} ${f.name}`).join('\n')
      } else {
        content = `[Error reading folder: ${res.error}]`
      }
    } else if (type === 'terminal') {
      const res = await window.api.terminal.loadBuffer(path)
      content = res.ok ? res.data : `[Error reading terminal: ${res.error}]`
    }
    return { type, path, content }
  } catch (err) {
    return { type, path, content: `[Error: ${err}]` }
  }
}

// ── @ Autocomplete menu items ──

interface RefMenuItem {
  type: 'file' | 'folder' | 'terminal'
  path: string
  label: string
  icon: typeof FileText
}

function useAvailableRefs(): RefMenuItem[] {
  const [items, setItems] = useState<RefMenuItem[]>([])

  useEffect(() => {
    void (async () => {
      const result: RefMenuItem[] = []
      const storeState = useUIStore.getState()

      // Get notes from the notes directory
      try {
        const notesDir = storeState.liteHome
          ? `${storeState.liteHome}/notes`
          : null

        if (notesDir) {
          const res = await window.api.fs.readDir(notesDir)
          if (res.ok) {
            for (const f of res.data) {
              if (f.isDirectory) {
                result.push({ type: 'folder', path: f.path, label: f.name, icon: FolderOpen })
                // Load children for groups
                const sub = await window.api.fs.readDir(f.path)
                if (sub.ok) {
                  for (const sf of sub.data) {
                    if (!sf.isDirectory && sf.name.endsWith('.md')) {
                      result.push({
                        type: 'file',
                        path: sf.path,
                        label: `${f.name}/${sf.name.replace(/\.md$/, '')}`,
                        icon: FileText,
                      })
                    }
                  }
                }
              } else if (f.name.endsWith('.md')) {
                result.push({
                  type: 'file',
                  path: f.path,
                  label: f.name.replace(/\.md$/, ''),
                  icon: FileText,
                })
              }
            }
          }
        }

        // Code app workspace
        if (storeState.codeProjectPath) {
          result.push({
            type: 'folder',
            path: storeState.codeProjectPath,
            label: storeState.codeProjectPath.split('/').pop() || 'workspace',
            icon: FolderOpen,
          })
        }
      } catch {
        /* ignore */
      }

      // Terminal sessions
      for (const t of storeState.terminalSessions) {
        result.push({
          type: 'terminal',
          path: t.id,
          label: t.title || `Terminal ${t.id}`,
          icon: Terminal,
        })
      }

      setItems(result)
    })()
  }, [])

  return items
}

// ── AI Command Component ──

function AICommandComponent({
  nodeKey,
  initialPrompt,
  selectedText,
  editor,
}: {
  nodeKey: NodeKey
  initialPrompt: string
  selectedText: string
  editor: LexicalEditor
}): JSX.Element {
  const [prompt, setPrompt] = useState(initialPrompt)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSelection, setShowSelection] = useState(false)
  const [attachedRefs, setAttachedRefs] = useState<AttachedRef[]>([])
  const [showAtMenu, setShowAtMenu] = useState(false)
  const [atQuery, setAtQuery] = useState('')
  const [atMenuIndex, setAtMenuIndex] = useState(0)
  const [isDragOver, setIsDragOver] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const atMenuRef = useRef<HTMLDivElement>(null)
  const availableRefs = useAvailableRefs()

  // Auto-focus + scroll into view
  useEffect(() => {
    setTimeout(() => {
      inputRef.current?.focus()
      containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 50)
  }, [])

  // Close @ menu on outside click
  useEffect(() => {
    if (!showAtMenu) return
    const handler = (e: MouseEvent): void => {
      if (atMenuRef.current && !atMenuRef.current.contains(e.target as Node)) {
        setShowAtMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showAtMenu])

  // Filter @ menu items
  const filteredAtItems = availableRefs.filter((item) =>
    !atQuery || item.label.toLowerCase().includes(atQuery.toLowerCase()) ||
    item.type.includes(atQuery.toLowerCase())
  )

  const handleCancel = useCallback(() => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if (node) node.remove()
    })
  }, [editor, nodeKey])

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

      const { prompt: resolvedPrompt } = await resolveReferences(prompt, attachedRefs)

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

      editor.update(() => {
        const node = $getNodeByKey(nodeKey)
        if (!node) return

        const lines = markdown.split('\n')
        const nodes: LexicalNode[] = []
        for (const line of lines) {
          const p = $createParagraphNode()
          if (line.trim()) p.append($createTextNode(line))
          nodes.push(p)
        }

        for (const n of nodes) {
          node.insertBefore(n)
        }
        node.remove()

        if (nodes.length > 0) {
          const last = nodes[nodes.length - 1]
          if ('selectEnd' in last) (last as ElementNode).selectEnd()
        }
      })
    } catch (err) {
      setError(String(err))
    }
    setLoading(false)
  }, [prompt, selectedText, loading, editor, nodeKey, attachedRefs])

  // Handle text input with @ detection
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setPrompt(val)

    // Detect @ trigger
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

  // Select an @ menu item
  const selectAtItem = useCallback((item: RefMenuItem) => {
    // Add as attached ref tag
    setAttachedRefs((prev) => {
      if (prev.some((r) => r.type === item.type && r.path === item.path)) return prev
      return [...prev, { type: item.type, path: item.path, label: item.label }]
    })

    // Remove the @query from the prompt
    const cursor = inputRef.current?.selectionStart ?? prompt.length
    const textBefore = prompt.slice(0, cursor)
    const atMatch = textBefore.match(/@([^\s@]*)$/)
    if (atMatch) {
      const newPrompt = prompt.slice(0, cursor - atMatch[0].length) + prompt.slice(cursor)
      setPrompt(newPrompt)
    }

    setShowAtMenu(false)
    inputRef.current?.focus()
  }, [prompt])

  // Remove an attached ref
  const removeRef = useCallback((idx: number) => {
    setAttachedRefs((prev) => prev.filter((_, i) => i !== idx))
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // @ menu navigation
      if (showAtMenu && filteredAtItems.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setAtMenuIndex((prev) => (prev < filteredAtItems.length - 1 ? prev + 1 : 0))
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setAtMenuIndex((prev) => (prev > 0 ? prev - 1 : filteredAtItems.length - 1))
          return
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          const item = filteredAtItems[atMenuIndex]
          if (item) selectAtItem(item)
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setShowAtMenu(false)
          return
        }
      }

      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleSubmit()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        handleCancel()
      }
    },
    [handleSubmit, handleCancel, showAtMenu, filteredAtItems, atMenuIndex, selectAtItem],
  )

  // ── Drag and drop ──
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)

    const filePath = e.dataTransfer.getData('text/plain')
    if (!filePath || !filePath.startsWith('/')) return

    const name = filePath.split('/').pop() || filePath
    const isDir = !name.includes('.')
    const refType: 'file' | 'folder' = isDir ? 'folder' : 'file'

    setAttachedRefs((prev) => {
      if (prev.some((r) => r.path === filePath)) return prev
      return [...prev, {
        type: refType,
        path: filePath,
        label: name.replace(/\.md$/, ''),
      }]
    })

    inputRef.current?.focus()
  }, [])

  const refTypeIcon = (type: string): JSX.Element => {
    switch (type) {
      case 'file': return <FileText size={10} />
      case 'folder': return <FolderOpen size={10} />
      case 'terminal': return <Terminal size={10} />
      default: return <FileText size={10} />
    }
  }

  return (
    <div
      ref={containerRef}
      className={`ai-command-block my-2 rounded-lg border overflow-hidden transition-colors ${
        isDragOver
          ? 'border-accent-main bg-accent-main/10'
          : 'border-accent-main/30 bg-accent-main/5'
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-accent-main/15">
        <Sparkles size={14} className="text-accent-main shrink-0" />
        <span className="text-xs text-accent-main font-medium">AI Generate</span>
        {selectedText && (
          <button
            onClick={() => setShowSelection(!showSelection)}
            className="flex items-center gap-1 text-[10px] text-tx-faint bg-bg-active px-1.5 py-0.5 rounded hover:bg-bg-hover transition-colors"
          >
            selection ({selectedText.length} chars)
            {showSelection ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={handleCancel}
          className="w-5 h-5 flex items-center justify-center rounded text-tx-faint hover:text-tx-muted hover:bg-bg-hover transition-colors"
        >
          <X size={12} />
        </button>
      </div>

      {/* Selected text preview */}
      {selectedText && showSelection && (
        <div className="px-3 py-2 border-b border-accent-main/10 bg-bg-app/50">
          <pre className="text-[11px] text-tx-muted font-mono whitespace-pre-wrap break-words max-h-[120px] overflow-y-auto leading-relaxed">
            {selectedText.length > 500 ? selectedText.slice(0, 500) + '...' : selectedText}
          </pre>
        </div>
      )}

      {/* Attached references */}
      {attachedRefs.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b border-accent-main/10">
          {attachedRefs.map((ref, i) => (
            <span
              key={`${ref.type}-${ref.path}`}
              className="inline-flex items-center gap-1 text-[11px] text-accent-main bg-accent-main/10 pl-1.5 pr-1 py-0.5 rounded-md"
            >
              {refTypeIcon(ref.type)}
              <span className="max-w-[140px] truncate">{ref.label}</span>
              <button
                onClick={() => removeRef(i)}
                className="w-3.5 h-3.5 flex items-center justify-center rounded-full hover:bg-accent-main/20 transition-colors"
              >
                <X size={8} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="relative px-3 py-2">
        <textarea
          ref={inputRef}
          value={prompt}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={isDragOver ? 'Drop files here to add as context...' : 'Describe what you want... Type @ for context'}
          className="w-full bg-transparent text-tx-main text-sm resize-none outline-none placeholder-tx-faint min-h-[40px] max-h-[120px]"
          rows={2}
          disabled={loading}
        />

        {/* @ autocomplete menu */}
        {showAtMenu && filteredAtItems.length > 0 && (
          <div
            ref={atMenuRef}
            className="absolute left-3 bottom-full mb-1 z-50 bg-bg-popover border border-border-subtle rounded-lg shadow-[0_4px_16px_rgba(0,0,0,0.15)] py-1 min-w-[240px] max-h-[200px] overflow-y-auto"
          >
            {filteredAtItems.map((item, i) => {
              const Icon = item.icon
              return (
                <button
                  key={`${item.type}-${item.path}`}
                  className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-xs transition-colors ${
                    i === atMenuIndex
                      ? 'bg-accent-bg text-accent-main'
                      : 'text-tx-muted hover:bg-bg-hover hover:text-tx-main'
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    selectAtItem(item)
                  }}
                  onMouseEnter={() => setAtMenuIndex(i)}
                >
                  <Icon size={13} className="shrink-0" />
                  <span className="truncate font-medium">{item.label}</span>
                  <span className="text-[10px] text-tx-faint ml-auto shrink-0">{item.type}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Drop zone hint */}
      {isDragOver && (
        <div className="px-3 pb-2 text-[11px] text-accent-main flex items-center gap-1.5 animate-pulse">
          <FileText size={12} />
          Drop to add as context reference
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-3 pb-2">
          <div className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1.5">{error}</div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-accent-main/15 bg-accent-main/3">
        <span className="text-[10px] text-tx-faint">
          {loading ? 'Generating...' : '⌘↵ generate · @ context · drag files here'}
        </span>
        <button
          onClick={handleSubmit}
          disabled={!prompt.trim() || loading}
          className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs bg-accent-main/15 text-accent-main hover:bg-accent-main/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
          {loading ? 'Generating' : 'Generate'}
        </button>
      </div>
    </div>
  )
}

// ── AICommandNode ──

export class AICommandNode extends DecoratorNode<JSX.Element> {
  __prompt: string
  __selectedText: string

  static getType(): string {
    return 'ai-command'
  }

  static clone(node: AICommandNode): AICommandNode {
    return new AICommandNode(node.__prompt, node.__selectedText, node.__key)
  }

  constructor(prompt: string, selectedText: string = '', key?: NodeKey) {
    super(key)
    this.__prompt = prompt
    this.__selectedText = selectedText
  }

  createDOM(): HTMLElement {
    const div = document.createElement('div')
    div.setAttribute('data-lexical-decorator', 'true')
    div.contentEditable = 'false'
    return div
  }

  updateDOM(): boolean {
    return false
  }

  exportDOM(): DOMExportOutput {
    return { element: null }
  }

  static importDOM(): DOMConversionMap | null {
    return null
  }

  isInline(): boolean {
    return false
  }

  getTextContent(): string {
    return ''
  }

  exportJSON(): SerializedAICommandNode {
    return {
      ...super.exportJSON(),
      prompt: this.__prompt,
      selectedText: this.__selectedText,
      type: 'ai-command',
      version: 1,
    }
  }

  static importJSON(json: SerializedAICommandNode): AICommandNode {
    return new AICommandNode(json.prompt, json.selectedText)
  }

  decorate(_editor: LexicalEditor): JSX.Element {
    return (
      <AICommandComponent
        nodeKey={this.getKey()}
        initialPrompt={this.__prompt}
        selectedText={this.__selectedText}
        editor={_editor}
      />
    )
  }
}

export function $createAICommandNode(prompt: string = '', selectedText: string = ''): AICommandNode {
  return new AICommandNode(prompt, selectedText)
}

export function $isAICommandNode(node: LexicalNode | null | undefined): node is AICommandNode {
  return node instanceof AICommandNode
}
