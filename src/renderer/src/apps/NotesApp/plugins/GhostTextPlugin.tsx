import { useEffect, useRef, useCallback } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  $getSelection,
  $getNodeByKey,
  $isRangeSelection,
  $isTextNode,
  $isLineBreakNode,
  KEY_TAB_COMMAND,
  KEY_ESCAPE_COMMAND,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_CRITICAL,
  type LexicalNode,
  type ElementNode,
  type NodeKey,
} from 'lexical'
import { $isCodeNode, $isCodeHighlightNode } from '@lexical/code'
import { $isHeadingNode, $isQuoteNode } from '@lexical/rich-text'
import { $isListItemNode, $isListNode } from '@lexical/list'
import { $isTableCellNode } from '@lexical/table'
import { useUIStore } from '../../../store/useUIStore'
import { $createGhostTextNode, $isGhostTextNode } from '../nodes/GhostTextNode'
import type { AIChatMessage } from '../../../../../shared/types'

// ── Config ──
const DEBOUNCE_MS = 600
const MIN_CONTEXT_LENGTH = 8
const MAX_CONTEXT_CHARS = 2000
const GHOST_TAG = 'ghost-text'

// ── Debug ──
const DEBUG = true
const dbg = (label: string, ...args: unknown[]) =>
  DEBUG && console.log(`%c[GhostText] ${label}`, 'color:#5eead4;font-weight:bold', ...args)
const dbgWarn = (label: string, ...args: unknown[]) =>
  DEBUG && console.warn(`[GhostText] ${label}`, ...args)

/** Exported flag — LexicalEditor's auto-save should skip when true */
export let _hasGhostText = false

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Context detection
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type ContextType = 'code' | 'text' | 'heading' | 'list' | 'quote' | 'table' | 'callout'

interface CompletionContext {
  type: ContextType
  lang?: string
  contextBefore: string
}

/** Markdown syntax patterns that should NOT trigger text completion */
const MD_SYNTAX_RE = /^(`{1,3}|#{1,6}\s*|[-*+]\s*|\d+\.\s*|>\s*|---+|===+|\|)$/

function $detectContext(): CompletionContext | null {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null

  const anchor = selection.anchor
  const anchorNode = anchor.getNode()

  // ── Code block ──
  const codeParent = $findAncestor(anchorNode, $isCodeNode)
  if (codeParent && $isCodeNode(codeParent)) {
    const lang = codeParent.getLanguage() || 'plaintext'
    const children = codeParent.getChildren()

    dbg('detectContext', `[code] anchorNode type=${anchorNode.getType()} key=${anchorNode.getKey()} anchor.type=${anchor.type} offset=${anchor.offset}`)

    // When cursor is on an empty line or at a position within CodeNode itself,
    // anchor.type === 'element' and anchorNode IS the CodeNode.
    // In that case, anchor.offset is the child index position.
    if (anchor.type === 'element' && anchorNode.getKey() === codeParent.getKey()) {
      const childIndex = anchor.offset
      const parts: string[] = []
      let currentLine = ''
      for (let i = 0; i < childIndex && i < children.length; i++) {
        const child = children[i]
        if ($isLineBreakNode(child)) {
          parts.push(currentLine)
          currentLine = ''
        } else {
          currentLine += child.getTextContent()
        }
      }
      parts.push(currentLine)
      dbg('detectContext', `[code/element] childIndex=${childIndex} context="${parts.join('\\n').slice(-60)}"`)
      return { type: 'code', lang, contextBefore: parts.join('\n') }
    }

    // anchor.type === 'text' — cursor is inside a CodeHighlightNode
    const parts: string[] = []
    let currentLine = ''
    for (const child of children) {
      if ($isLineBreakNode(child)) {
        parts.push(currentLine)
        currentLine = ''
      } else {
        currentLine += child.getTextContent()
      }
      if (child.getKey() === anchorNode.getKey()) {
        const fullText = child.getTextContent()
        currentLine = currentLine.slice(0, currentLine.length - fullText.length) +
          fullText.substring(0, anchor.offset)
        parts.push(currentLine)
        break
      }
    }
    dbg('detectContext', `[code/text] context="${parts.join('\\n').slice(-60)}"`)
    return { type: 'code', lang, contextBefore: parts.join('\n') }
  }

  // ── Non-code: need TextNode ──
  if (!$isTextNode(anchorNode) && !$isCodeHighlightNode(anchorNode)) return null
  if (anchor.offset < anchorNode.getTextContent().length) return null

  const topLevel = anchorNode.getTopLevelElement()
  if (!topLevel) return null

  // ── Heading ──
  if ($isHeadingNode(topLevel)) {
    const tag = topLevel.getTag()
    return { type: 'heading', contextBefore: `[${tag}] ${$collectParagraphContext(topLevel, anchor.offset)}` }
  }

  // ── Quote ──
  if ($isQuoteNode(topLevel)) {
    return { type: 'quote', contextBefore: $collectParagraphContext(topLevel, anchor.offset) }
  }

  // ── List ──
  const listItem = $findAncestor(anchorNode, $isListItemNode)
  if (listItem) {
    const listNode = listItem.getParent()
    const listType = listNode && $isListNode(listNode) ? listNode.getListType() : 'bullet'
    return {
      type: 'list',
      lang: listType,
      contextBefore: $collectListContext(listNode as ElementNode, listItem as ElementNode, anchor.offset),
    }
  }

  // ── Table cell ──
  const tableCell = $findAncestor(anchorNode, $isTableCellNode)
  if (tableCell && $isTableCellNode(tableCell)) {
    return { type: 'table', contextBefore: $collectTableContext(tableCell, anchor.offset) }
  }

  // ── Callout ──
  if ($findAncestorByType(anchorNode, 'callout')) {
    return { type: 'callout', contextBefore: $collectParagraphContext(topLevel, anchor.offset) }
  }

  // ── Regular text ──
  const contextBefore = $collectParagraphContext(topLevel, anchor.offset)
  if (contextBefore.endsWith('  ')) return null
  const currentLineText = contextBefore.split('\n').pop()?.trim() ?? ''
  if (MD_SYNTAX_RE.test(currentLineText)) return null
  return { type: 'text', contextBefore }
}

// ── Tree helpers ──

function $findAncestor(node: LexicalNode, predicate: (n: LexicalNode) => boolean): LexicalNode | null {
  let current: LexicalNode | null = node
  while (current) {
    if (predicate(current)) return current
    current = current.getParent()
  }
  return null
}

function $findAncestorByType(node: LexicalNode, type: string): LexicalNode | null {
  return $findAncestor(node, (n) => n.getType() === type)
}

function $collectParagraphContext(topLevel: ElementNode, cursorOffset: number): string {
  const root = topLevel.getParent()
  if (!root) return topLevel.getTextContent().substring(0, cursorOffset)
  const children = root.getChildren()
  const idx = children.indexOf(topLevel)
  const parts: string[] = []
  let total = 0
  for (let i = idx; i >= 0 && total < MAX_CONTEXT_CHARS; i--) {
    const t = children[i].getTextContent()
    parts.unshift(t)
    total += t.length
  }
  if (parts.length > 0) parts[parts.length - 1] = topLevel.getTextContent().substring(0, cursorOffset)
  return parts.join('\n')
}

function $collectListContext(listNode: ElementNode | null, currentItem: ElementNode, cursorOffset: number): string {
  if (!listNode) return currentItem.getTextContent().substring(0, cursorOffset)
  const parts: string[] = []
  for (const item of listNode.getChildren()) {
    if (item === currentItem) { parts.push(item.getTextContent().substring(0, cursorOffset)); break }
    parts.push(item.getTextContent())
  }
  return parts.join('\n')
}

function $collectTableContext(cell: LexicalNode, cursorOffset: number): string {
  const row = cell.getParent()
  if (!row) return cell.getTextContent().substring(0, cursorOffset)
  const table = row.getParent()
  if (!table) return cell.getTextContent().substring(0, cursorOffset)
  const rows = table.getChildren()
  const parts: string[] = []
  if (rows.length > 0) {
    const hdr = rows[0].getChildren()
    parts.push('| ' + hdr.map((c) => c.getTextContent()).join(' | ') + ' |')
    parts.push('| ' + hdr.map(() => '---').join(' | ') + ' |')
  }
  const rowCells = row.getChildren()
  const ci = rowCells.indexOf(cell)
  parts.push('| ' + rowCells.map((c, i) => i === ci ? c.getTextContent().substring(0, cursorOffset) : i < ci ? c.getTextContent() : '').join(' | ') + ' |')
  if (rows.length > 0 && ci >= 0) {
    const hdr = rows[0].getChildren()
    if (ci < hdr.length) parts.push(`(current column: "${hdr[ci].getTextContent()}")`)
  }
  return parts.join('\n')
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Prompt building
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildPrompt(ctx: CompletionContext): AIChatMessage[] {
  switch (ctx.type) {
    case 'code':
      return [
        { role: 'system', content: `You are an inline code completion assistant. Language: ${ctx.lang}. Continue the code naturally. Rules:\n- Output ONLY the code to insert — no markdown fences, no explanations\n- If you see "// todo:" or "# todo:", generate the described code\n- Respect indentation\n- Keep completions short: 1-3 lines unless a todo asks for more\n- If you cannot complete, respond with empty string` },
        { role: 'user', content: ctx.contextBefore },
      ]
    case 'heading':
      return [
        { role: 'system', content: 'Complete the heading concisely. Output ONLY the completion text, a few words max.' },
        { role: 'user', content: `Complete this heading:\n\n${ctx.contextBefore}` },
      ]
    case 'list':
      return [
        { role: 'system', content: `Complete the current ${ctx.lang === 'check' ? 'checklist' : ctx.lang === 'number' ? 'numbered' : 'bulleted'} list item. Output ONLY text to append — one line, no bullet markers.` },
        { role: 'user', content: `Complete the last item:\n\n${ctx.contextBefore}` },
      ]
    case 'table':
      return [
        { role: 'system', content: 'Complete the current table cell based on column header and context. Output ONLY cell content.' },
        { role: 'user', content: `Complete:\n\n${ctx.contextBefore}` },
      ]
    case 'quote':
      return [
        { role: 'system', content: 'Continue the blockquote naturally. Output ONLY the text, no "> " prefix. 1 sentence max.' },
        { role: 'user', content: `Continue:\n\n${ctx.contextBefore}` },
      ]
    case 'callout':
      return [
        { role: 'system', content: 'Continue the callout text naturally. Output ONLY the completion. Keep concise.' },
        { role: 'user', content: `Continue:\n\n${ctx.contextBefore}` },
      ]
    case 'text':
    default:
      return [
        { role: 'system', content: 'You are an inline text completion assistant for markdown notes. Continue naturally. Rules:\n- Output ONLY the completion text\n- 1-2 sentences max\n- If the last word looks misspelled, output the corrected word + continuation\n- No markdown formatting unless user is mid-format\n- Empty string if no meaningful completion' },
        { role: 'user', content: `Continue:\n\n${ctx.contextBefore}` },
      ]
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Plugin
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Get the precise caret bounding rect.
 * For normal text selections, `range.getBoundingClientRect()` works.
 * For element-type selections (e.g. empty lines in code blocks), the range rect
 * is all zeros. In that case, temporarily insert a zero-width space into the DOM
 * to get the exact position, then remove it synchronously (before MutationObserver fires).
 */
function getCaretRect(): DOMRect | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null

  const range = sel.getRangeAt(0)
  const rect = range.getBoundingClientRect()

  // Normal case: range has a valid rect
  if (rect.height > 0 || rect.top > 0) return rect

  // Fallback: insert temporary marker to get position
  const marker = document.createTextNode('\u200B')
  range.insertNode(marker)
  const tempRange = document.createRange()
  tempRange.selectNode(marker)
  const markerRect = tempRange.getBoundingClientRect()
  marker.remove()

  // Restore selection (insertNode may have shifted it)
  sel.removeAllRanges()
  sel.addRange(range)

  if (markerRect.height > 0 || markerRect.top > 0) return markerRect
  return null
}

/**
 * Rendering strategy (both inside Lexical's DOM, no external overlays):
 *
 * - Non-code → GhostTextNode (Lexical DecoratorNode, inline in the node tree)
 * - Code     → data-ghost-text attribute on CodeHighlightNode's DOM <span> + CSS ::after
 *
 * Why code needs a different approach:
 * registerCodeHighlighting() re-tokenizes CodeNode on every child mutation,
 * rebuilding ALL children from scratch. Any non-CodeHighlightNode inserted
 * inside CodeNode gets destroyed. Setting a data-attribute on an existing
 * element does NOT trigger Lexical's MutationObserver (which only watches
 * childList + characterData, not attributes), so the highlighter won't fire.
 */

export function GhostTextPlugin(): null {
  const [editor] = useLexicalComposerContext()
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ghostKeyRef = useRef<NodeKey | null>(null)
  const ghostTextRef = useRef<string>('')
  const ghostModeRef = useRef<'node' | 'attr' | null>(null)
  /** For 'attr' mode: the DOM element carrying data-ghost-text */
  const ghostAttrElRef = useRef<HTMLElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const requestingRef = useRef(false)
  const lastTextContent = useRef('')
  /** Saved caret rect — captured before async AI request so it's available when response arrives */
  const savedCaretRectRef = useRef<DOMRect | null>(null)
  /** Code block element with temporary extra padding */
  const ghostPaddingElRef = useRef<HTMLElement | null>(null)
  const ghostPaddingOriginal = useRef<string>('')

  /** Remove ghost — DecoratorNode or data-attribute depending on mode */
  const clearGhost = useCallback(() => {
    const mode = ghostModeRef.current
    if (!mode) return

    if (mode === 'node' && ghostKeyRef.current) {
      const key = ghostKeyRef.current
      editor.update(
        () => {
          const node = $getNodeByKey(key)
          if (node && $isGhostTextNode(node)) node.remove()
        },
        { tag: GHOST_TAG },
      )
    }

    if (mode === 'attr' && ghostAttrElRef.current) {
      ghostAttrElRef.current.remove()
      ghostAttrElRef.current = null
    }

    // Restore code block padding
    if (ghostPaddingElRef.current) {
      ghostPaddingElRef.current.style.paddingBottom = ghostPaddingOriginal.current
      ghostPaddingElRef.current = null
    }

    ghostKeyRef.current = null
    ghostTextRef.current = ''
    ghostModeRef.current = null
    _hasGhostText = false
    dbg('clearGhost', mode)
  }, [editor])

  /** Show ghost text */
  const showGhost = useCallback(
    (text: string, contextType: ContextType) => {
      const displayText = text

      ghostTextRef.current = text
      _hasGhostText = true

      if (contextType === 'code') {
        // ── Code: fixed-position ghost element at cursor ──
        // Use saved caret rect (captured before async AI request)
        const rect = savedCaretRectRef.current
        if (!rect || (rect.height === 0 && rect.top === 0)) {
          dbgWarn('showGhost', `[code] no saved caret rect — aborting`)
          return
        }

        const ghost = document.createElement('span')
        ghost.className = 'ghost-text-code-overlay'
        ghost.textContent = displayText
        ghost.style.position = 'fixed'
        ghost.style.top = `${rect.top}px`
        ghost.style.left = `${rect.right || rect.left}px`
        ghost.style.height = `${rect.height}px`
        ghost.style.lineHeight = `${rect.height}px`
        ghost.style.zIndex = '40'
        document.body.appendChild(ghost)

        // Add extra padding to code block so ghost text doesn't overflow
        const lineCount = displayText.split('\n').length
        if (lineCount > 1) {
          // Find the <code> element (CodeNode's DOM)
          let codeEl: HTMLElement | null = null
          editor.getEditorState().read(() => {
            const sel = $getSelection()
            if ($isRangeSelection(sel)) {
              const node = sel.anchor.getNode()
              const codeParent = $findAncestor(node, $isCodeNode)
              if (codeParent) codeEl = editor.getElementByKey(codeParent.getKey())
            }
          })
          if (codeEl) {
            const lineHeight = rect.height || 20
            const extraPx = (lineCount - 1) * lineHeight
            ghostPaddingOriginal.current = (codeEl as HTMLElement).style.paddingBottom
            ;(codeEl as HTMLElement).style.paddingBottom = `${extraPx + 16}px`
            ghostPaddingElRef.current = codeEl
          }
        }

        dbg('showGhost', `[code/fixed] top=${Math.round(rect.top)} left=${Math.round(rect.right || rect.left)} lines=${lineCount} "${displayText.slice(0, 50)}"`)

        ghostAttrElRef.current = ghost
        ghostModeRef.current = 'attr'
        savedCaretRectRef.current = null
      } else {
        // ── Non-code: Lexical DecoratorNode ──
        editor.update(
          () => {
            const selection = $getSelection()
            if (!$isRangeSelection(selection) || !selection.isCollapsed()) return

            const ghost = $createGhostTextNode(displayText)
            selection.insertNodes([ghost])
            ghost.selectPrevious()

            ghostKeyRef.current = ghost.getKey()
            ghostModeRef.current = 'node'
            dbg('showGhost', `[${contextType}/node] key=${ghost.getKey()} "${displayText.slice(0, 50)}${displayText.length > 50 ? '…' : ''}"`)
          },
          { tag: GHOST_TAG },
        )
      }
    },
    [editor],
  )

  /** Request AI completion */
  const requestCompletion = useCallback(async () => {
    if (requestingRef.current) return
    requestingRef.current = true

    const provider = useUIStore.getState().getAIProviderForFeature('completion')
    if (!provider) {
      dbgWarn('request', 'no AI provider for "completion"')
      requestingRef.current = false
      return
    }

    let ctx: CompletionContext | null = null
    editor.getEditorState().read(() => { ctx = $detectContext() })

    if (!ctx) {
      dbg('request', 'no valid context')
      requestingRef.current = false
      return
    }

    const { type, lang, contextBefore } = ctx
    if (contextBefore.trim().length < MIN_CONTEXT_LENGTH) {
      dbg('request', `context too short (${contextBefore.trim().length} chars)`)
      requestingRef.current = false
      return
    }

    // Save caret rect NOW (before async gap) for code block ghost positioning
    if (type === 'code') {
      savedCaretRectRef.current = getCaretRect()
      dbg('request', `[code] saved caret rect: ${savedCaretRectRef.current ? `top=${Math.round(savedCaretRectRef.current.top)} left=${Math.round(savedCaretRectRef.current.left)}` : 'null'}`)
    }

    dbg('request', `type=${type}${lang ? ` lang=${lang}` : ''} provider=${provider.name}`)
    dbg('request', `context (${contextBefore.length} chars): "…${contextBefore.slice(-80)}"`)

    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const messages = buildPrompt(ctx)
    const maxTokens = type === 'code' ? 200 : type === 'table' ? 60 : 150

    try {
      const t0 = performance.now()
      const result = await window.api.ai.chat(provider.id, messages, 0.3, maxTokens)
      const ms = Math.round(performance.now() - t0)

      if (controller.signal.aborted) { dbg('request', `aborted (${ms}ms)`); return }
      if (!result.ok) { dbgWarn('request', `error (${ms}ms):`, (result as { error: string }).error); return }

      const completion = result.data.content.trim()
      dbg('request', `[${type}] response (${ms}ms): "${completion.slice(0, 60)}"`)

      if (completion) {
        clearGhost()
        showGhost(completion, type)
      }
    } catch (err) {
      dbgWarn('request', 'exception:', err)
    } finally {
      requestingRef.current = false
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [editor, clearGhost, showGhost])

  // ── Editor update listener — only on real text changes ──
  useEffect(() => {
    dbg('init', 'plugin mounted')
    editor.getEditorState().read(() => { lastTextContent.current = $getRoot().getTextContent() })

    const unregister = editor.registerUpdateListener(({ editorState, tags }) => {
      if (tags.has(GHOST_TAG)) return // skip our own ghost insert/remove updates

      let currentText = ''
      editorState.read(() => { currentText = $getRoot().getTextContent() })
      if (currentText === lastTextContent.current) return // selection-only change
      lastTextContent.current = currentText

      clearGhost()
      if (abortRef.current) { abortRef.current.abort(); abortRef.current = null }
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      debounceTimer.current = setTimeout(() => requestCompletion(), DEBOUNCE_MS)
    })

    return () => { unregister(); if (debounceTimer.current) clearTimeout(debounceTimer.current) }
  }, [editor, clearGhost, requestCompletion])

  // ── Scroll → clear fixed-position ghost (it won't follow scroll) ──
  useEffect(() => {
    const rootEl = editor.getRootElement()
    const scrollParent = rootEl?.closest('.overflow-y-auto') ?? rootEl?.parentElement
    if (!scrollParent) return
    const onScroll = (): void => {
      if (ghostModeRef.current === 'attr') clearGhost()
    }
    scrollParent.addEventListener('scroll', onScroll, { passive: true })
    return () => scrollParent.removeEventListener('scroll', onScroll)
  }, [editor, clearGhost])

  // ── Tab → accept ghost ──
  useEffect(() => {
    return editor.registerCommand(
      KEY_TAB_COMMAND,
      (event) => {
        const mode = ghostModeRef.current
        if (!mode) return false // no ghost showing → let default Tab behaviour through

        event.preventDefault()
        const fullText = ghostTextRef.current
        dbg('Tab', `accept [${mode}] "${fullText.slice(0, 40)}…"`)

        if (mode === 'node') {
          const key = ghostKeyRef.current
          ghostKeyRef.current = null
          ghostTextRef.current = ''
          ghostModeRef.current = null
          _hasGhostText = false

          editor.update(
            () => {
              if (key) {
                const node = $getNodeByKey(key)
                if (node && $isGhostTextNode(node)) node.remove()
              }
              const selection = $getSelection()
              if ($isRangeSelection(selection)) {
                selection.insertRawText(fullText)
              }
            },
            { tag: GHOST_TAG },
          )
        } else if (mode === 'attr') {
          // Remove the fixed-position ghost element
          if (ghostAttrElRef.current) {
            ghostAttrElRef.current.remove()
            ghostAttrElRef.current = null
          }
          // Restore code block padding
          if (ghostPaddingElRef.current) {
            ghostPaddingElRef.current.style.paddingBottom = ghostPaddingOriginal.current
            ghostPaddingElRef.current = null
          }
          ghostTextRef.current = ''
          ghostModeRef.current = null
          _hasGhostText = false

          // Insert completion text at cursor inside the code block
          editor.update(
            () => {
              const selection = $getSelection()
              if ($isRangeSelection(selection)) {
                selection.insertRawText(fullText)
              }
            },
            { tag: GHOST_TAG },
          )
        }
        return true
      },
      COMMAND_PRIORITY_CRITICAL,
    )
  }, [editor])

  // ── Escape → dismiss ──
  useEffect(() => {
    return editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        if (!ghostModeRef.current) return false
        dbg('Escape', 'dismiss')
        clearGhost()
        return true
      },
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor, clearGhost])

  // Cleanup
  useEffect(() => {
    return () => {
      clearGhost()
      _hasGhostText = false
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      if (abortRef.current) abortRef.current.abort()
    }
  }, [clearGhost])

  return null
}
