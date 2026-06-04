/**
 * ReadingHighlightPlugin — non-destructive reading aids for the Lexical
 * markdown view.
 *
 * Three pattern groups, each rendered through the CSS Custom Highlight
 * API (`CSS.highlights.set(name, Highlight)`) so we **do not mutate the
 * Lexical DOM** — Highlights are pure rendering decorations, invisible to
 * the editor model and to React reconciliation:
 *
 *   • rd-keyword  TODO / FIXME / NOTE / WARNING / 重要 / 注意 …
 *   • rd-number   5KB / 60K+ / 0.70.6 / 321 / ⌘\ …
 *   • rd-acronym  LLM / SQL / API / JSON / CDP …  (3–7 uppercase letters)
 *
 * Recomputes on every editor update + on a small debounce, scoped to the
 * markdown-body container so we don't waste cycles scanning the whole doc
 * each keystroke.
 */
import { useEffect, type JSX } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'

const KEYWORD_RE =
  /\b(TODO|FIXME|HACK|XXX|BUG|NOTE|WARNING|IMPORTANT|TIP|DEPRECATED|TBD)\b|(?:重要|注意|警告|待办|提示)/g
// Numbers with optional decimal/version + optional unit suffix. Restricted
// to >=2 chars total so we don't decorate every standalone "1" inside prose.
const NUMBER_RE =
  /\b\d+(?:\.\d+){0,3}(?:KB|MB|GB|TB|kb|mb|gb|tb|k|K|M|B|ms|s|min|hr|em|rem|px|%|°|x)\b|\b\d+(?:\.\d+){2,3}\b|\b\d+[KkMm]\+?(?=\b|$)/g
// 3–7 character ALL-CAPS tokens. \b on both ends; a-zA-Z lookahead/behind
// excluded inline-code style by checking the parent later.
const ACRONYM_RE = /\b[A-Z][A-Z0-9]{2,6}\b/g

// `Highlight` and `CSS.highlights` are part of the CSS Custom Highlight API
// (Chromium 105+, supported in Electron). TypeScript's lib.dom.d.ts has the
// types; we just feature-detect at runtime.
type CssWithHighlights = {
  highlights?: {
    set(name: string, value: Highlight): void
    delete(name: string): boolean
    clear(): void
  }
}

function isInsideTagName(node: Node, tagNames: ReadonlySet<string>): boolean {
  let cur: Node | null = node
  while (cur && cur.nodeType !== Node.DOCUMENT_NODE) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const el = cur as HTMLElement
      if (tagNames.has(el.tagName)) return true
    }
    cur = cur.parentNode
  }
  return false
}

const SKIP_TAGS = new Set(['CODE', 'PRE', 'A', 'KBD', 'STYLE', 'SCRIPT', 'TEXTAREA', 'INPUT'])

function collectTextNodes(root: HTMLElement): Text[] {
  const out: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const t = n as Text
      if (!t.nodeValue || !t.nodeValue.trim()) return NodeFilter.FILTER_REJECT
      // Skip text inside code / links / kbd — those already have their own
      // styling and we don't want to over-decorate.
      if (isInsideTagName(t, SKIP_TAGS)) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  let n: Node | null
  while ((n = walker.nextNode())) out.push(n as Text)
  return out
}

function buildRangesFor(re: RegExp, nodes: Text[]): Range[] {
  const ranges: Range[] = []
  for (const node of nodes) {
    const text = node.nodeValue ?? ''
    if (!text) continue
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const start = m.index
      const end = start + m[0].length
      const r = document.createRange()
      try {
        r.setStart(node, start)
        r.setEnd(node, end)
        ranges.push(r)
      } catch { /* node detached mid-walk — ignore */ }
    }
  }
  return ranges
}

function recompute(container: HTMLElement): void {
  const cssWithHighlights = (CSS as unknown as CssWithHighlights).highlights
  if (!cssWithHighlights) return
  if (typeof (globalThis as { Highlight?: unknown }).Highlight === 'undefined') return
  const nodes = collectTextNodes(container)
  if (nodes.length === 0) {
    cssWithHighlights.delete('rd-keyword')
    cssWithHighlights.delete('rd-number')
    cssWithHighlights.delete('rd-acronym')
    return
  }
  const keywordRanges = buildRangesFor(KEYWORD_RE, nodes)
  const numberRanges = buildRangesFor(NUMBER_RE, nodes)
  const acronymRanges = buildRangesFor(ACRONYM_RE, nodes)

  if (keywordRanges.length) cssWithHighlights.set('rd-keyword', new Highlight(...keywordRanges))
  else cssWithHighlights.delete('rd-keyword')
  if (numberRanges.length) cssWithHighlights.set('rd-number', new Highlight(...numberRanges))
  else cssWithHighlights.delete('rd-number')
  if (acronymRanges.length) cssWithHighlights.set('rd-acronym', new Highlight(...acronymRanges))
  else cssWithHighlights.delete('rd-acronym')
}

export function ReadingHighlightPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    const root = editor.getRootElement()
    if (!root) return
    // Walk up to the scroll container (`#write` / `.markdown-body`) so we
    // also scan content rendered by decorator nodes (callouts, etc.).
    const container =
      (root.closest('.markdown-body') as HTMLElement | null) ?? root

    let raf = 0
    const schedule = (): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => recompute(container))
    }

    // Initial pass after mount + every editor update.
    schedule()
    const unsub = editor.registerUpdateListener(() => schedule())

    return () => {
      cancelAnimationFrame(raf)
      unsub()
      const cssWithHighlights = (CSS as unknown as CssWithHighlights).highlights
      if (cssWithHighlights) {
        cssWithHighlights.delete('rd-keyword')
        cssWithHighlights.delete('rd-number')
        cssWithHighlights.delete('rd-acronym')
      }
    }
  }, [editor])

  return null
}
