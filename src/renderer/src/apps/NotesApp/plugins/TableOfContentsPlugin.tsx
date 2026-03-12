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

  // ── Nav list (shared between floating & pinned) ──
  const navList = (
    <nav className="space-y-0.5">
      {items.map((item) => {
        const isActive = item.key === activeKey
        return (
          <button
            key={item.key}
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
  )

  // ── Header bar ──
  const header = (
    <div className="flex items-center gap-1 px-2 pb-2 mb-1 border-b border-border-subtle">
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

  // ── Pinned: fixed sidebar with resize ──
  if (mode === 'pinned') {
    return (
      <div
        className="toc-pinned shrink-0 overflow-y-auto pt-3 pr-1 pl-1 border-l border-border-subtle relative"
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
        {navList}
      </div>
    )
  }

  // ── Floating (default) ──
  return (
    <div className="toc-floating absolute top-3 right-3 z-30 w-[200px] max-h-[60vh] overflow-y-auto rounded-lg bg-bg-popover/90 border border-border-subtle shadow-lg backdrop-blur-md pt-3 pb-2 px-1">
      {header}
      {navList}
    </div>
  )
}
