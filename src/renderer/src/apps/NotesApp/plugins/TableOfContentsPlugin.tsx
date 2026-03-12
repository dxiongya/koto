import { useEffect, useState, useCallback, useRef, type JSX } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot, $getNodeByKey, type NodeKey } from 'lexical'
import { $isHeadingNode, type HeadingTagType } from '@lexical/rich-text'
import { List, PanelRightClose, PanelRightOpen, X } from 'lucide-react'
import { ResizeHandle } from '../../../components/ResizeHandle'

interface TocItem {
  key: NodeKey
  text: string
  tag: HeadingTagType
  level: number
}

const TAG_LEVELS: Record<HeadingTagType, number> = {
  h1: 1, h2: 2, h3: 3, h4: 3, h5: 3, h6: 3,
}

type TocMode = 'floating' | 'pinned' | 'collapsed'

export function TableOfContentsPlugin(): JSX.Element {
  const [editor] = useLexicalComposerContext()
  const [items, setItems] = useState<TocItem[]>([])
  const [activeKey, setActiveKey] = useState<NodeKey | null>(null)
  const [mode, setMode] = useState<TocMode>('floating')
  const [pinnedWidth, setPinnedWidth] = useState(180)
  const scrollContainerRef = useRef<HTMLElement | null>(null)

  // Extract headings
  const extractHeadings = useCallback(() => {
    editor.getEditorState().read(() => {
      const root = $getRoot()
      const headings: TocItem[] = []
      for (const node of root.getChildren()) {
        if ($isHeadingNode(node)) {
          const text = node.getTextContent().trim()
          if (text) {
            headings.push({
              key: node.getKey(),
              text,
              tag: node.getTag(),
              level: TAG_LEVELS[node.getTag()] ?? 3,
            })
          }
        }
      }
      setItems(headings)
    })
  }, [editor])

  useEffect(() => {
    extractHeadings()
    return editor.registerUpdateListener(() => extractHeadings())
  }, [editor, extractHeadings])

  // Find scroll container
  useEffect(() => {
    const root = editor.getRootElement()
    if (!root) return
    scrollContainerRef.current = root.closest('.overflow-y-auto') as HTMLElement | null
  }, [editor])

  const tocScrollRef = useRef<HTMLDivElement>(null)

  // Track active heading on scroll
  useEffect(() => {
    const scroller = scrollContainerRef.current
    if (!scroller || items.length === 0) return

    const handleScroll = (): void => {
      const scrollerRect = scroller.getBoundingClientRect()
      const threshold = scrollerRect.top + 80

      let current: NodeKey | null = null
      for (const item of items) {
        const el = editor.getElementByKey(item.key)
        if (!el) continue
        if (el.getBoundingClientRect().top <= threshold) current = item.key
        else break
      }
      setActiveKey(current)
    }

    handleScroll()
    scroller.addEventListener('scroll', handleScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', handleScroll)
  }, [editor, items])

  // Auto-scroll the TOC list to keep active item visible
  useEffect(() => {
    if (!activeKey || !tocScrollRef.current) return
    const activeEl = tocScrollRef.current.querySelector(`[data-toc-key="${activeKey}"]`) as HTMLElement | null
    if (!activeEl) return
    const container = tocScrollRef.current
    const elTop = activeEl.offsetTop - container.offsetTop
    const elBottom = elTop + activeEl.offsetHeight
    const viewTop = container.scrollTop
    const viewBottom = viewTop + container.clientHeight

    if (elTop < viewTop + 4) {
      container.scrollTo({ top: Math.max(0, elTop - 8), behavior: 'smooth' })
    } else if (elBottom > viewBottom - 4) {
      container.scrollTo({ top: elBottom - container.clientHeight + 8, behavior: 'smooth' })
    }
  }, [activeKey])

  const handleClick = useCallback(
    (key: NodeKey) => {
      const el = editor.getElementByKey(key)
      if (!el) return
      const scroller = scrollContainerRef.current
      if (!scroller) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
      const scrollerRect = scroller.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      scroller.scrollTo({
        top: elRect.top - scrollerRect.top + scroller.scrollTop - 20,
        behavior: 'smooth',
      })
      editor.update(() => {
        const node = $getNodeByKey(key)
        if (node && $isHeadingNode(node)) node.selectEnd()
      })
    },
    [editor],
  )

  // No headings → show nothing
  if (items.length === 0) return <></>

  // ── Collapsed: just a small trigger button ──
  if (mode === 'collapsed') {
    return (
      <button
        onClick={() => setMode('floating')}
        className="toc-trigger absolute top-3 right-3 z-30 w-7 h-7 flex items-center justify-center rounded-md bg-bg-popover/80 border border-border-subtle text-tx-faint hover:text-tx-muted hover:bg-bg-hover backdrop-blur-sm transition-all"
        title="Show table of contents"
      >
        <List size={14} />
      </button>
    )
  }

  // navList is now inline inside scrollableNav below

  // ── Header bar (sticky, never scrolls) ──
  const header = (
    <div className="flex items-center gap-1 px-2 pb-2 border-b border-border-subtle shrink-0">
      <span className="text-[10px] text-tx-faint uppercase tracking-wider flex-1">Contents</span>
      {mode === 'floating' ? (
        <button
          onClick={() => setMode('pinned')}
          className="w-5 h-5 flex items-center justify-center rounded text-tx-faint hover:text-tx-muted hover:bg-bg-hover transition-colors"
          title="Pin to side"
        >
          <PanelRightClose size={12} />
        </button>
      ) : (
        <button
          onClick={() => setMode('floating')}
          className="w-5 h-5 flex items-center justify-center rounded text-tx-faint hover:text-tx-muted hover:bg-bg-hover transition-colors"
          title="Unpin"
        >
          <PanelRightOpen size={12} />
        </button>
      )}
      <button
        onClick={() => setMode('collapsed')}
        className="w-5 h-5 flex items-center justify-center rounded text-tx-faint hover:text-tx-muted hover:bg-bg-hover transition-colors"
        title="Close"
      >
        <X size={12} />
      </button>
    </div>
  )

  // ── Scrollable nav list ──
  const scrollableNav = (
    <div ref={tocScrollRef} className="flex-1 overflow-y-auto min-h-0 pt-1">
      <nav className="space-y-0.5">
        {items.map((item) => {
          const isActive = item.key === activeKey
          return (
            <button
              key={item.key}
              data-toc-key={item.key}
              onClick={() => handleClick(item.key)}
              className={`block w-full text-left truncate rounded px-2 py-1 text-[11px] leading-snug transition-colors ${
                isActive
                  ? 'text-accent-main bg-accent-main/8'
                  : 'text-tx-faint hover:text-tx-muted hover:bg-bg-hover'
              }`}
              style={{ paddingLeft: `${(item.level - 1) * 10 + 8}px` }}
              title={item.text}
            >
              {item.text}
            </button>
          )
        })}
      </nav>
    </div>
  )

  // ── Pinned: fixed sidebar with resize ──
  if (mode === 'pinned') {
    return (
      <div
        className="toc-pinned shrink-0 flex flex-col pt-3 pr-1 pl-1 border-l border-border-subtle relative h-full"
        style={{ width: pinnedWidth }}
      >
        <ResizeHandle
          side="right"
          width={pinnedWidth}
          onResize={setPinnedWidth}
          minWidth={140}
          maxWidth={360}
        />
        {header}
        {scrollableNav}
      </div>
    )
  }

  // ── Floating (default) ──
  return (
    <div className="toc-floating absolute top-3 right-3 z-30 w-[200px] max-h-[60vh] flex flex-col rounded-lg bg-bg-popover/90 border border-border-subtle shadow-lg backdrop-blur-md pt-3 pb-2 px-1">
      {header}
      {scrollableNav}
    </div>
  )
}
