/**
 * TerminalClassicHost — Classic/Single-app mode surface for terminal.app.
 *
 * Structurally a mini PaneTree scoped to terminals: each pane holds a list
 * of tabs (each tab = a terminal session), and panes can be split freely
 * regardless of any folder/workspace. State lives in the store under
 * `classicTermPanes` / `classicTermRoot`, fully isolated from the global
 * Tabs-mode `panes` / `rootLayout` so flipping between the two layout
 * modes preserves both surfaces.
 *
 * Drag & drop:
 *   - Drag a tab chip onto another pane's center → move tab into that pane.
 *   - Drag onto an edge → split that pane with the tab.
 *   - Drag onto another position in the tab bar → reorder.
 *
 * Keyboard:
 *   - ⌘W / ⌘⌥W close active tab
 *   - ⌘⌥← / → navigate panes
 */
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Plus, Terminal as TerminalIcon, X } from 'lucide-react'
import {
  useUIStore,
  type Item,
  type Pane,
  type PaneNode,
} from '../../store/useUIStore'
import { TerminalView, type TerminalViewHandle } from './TerminalView'
import { getTerminalRefs } from './index'

const PANE_DRAG_TYPE = 'application/x-classic-term-pane'

type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center'

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

function computePaneRects(
  node: PaneNode,
  rect: Rect = { top: 0, left: 0, width: 100, height: 100 },
): Map<string, Rect> {
  const out = new Map<string, Rect>()
  if (node.type === 'pane') {
    out.set(node.paneId, rect)
    return out
  }
  const count = node.children.length
  const sizes = node.sizes?.length === count ? node.sizes : Array(count).fill(1 / count)
  let offset = 0
  for (let i = 0; i < count; i++) {
    const size = sizes[i]
    const childRect =
      node.direction === 'horizontal'
        ? { ...rect, left: rect.left + rect.width * offset, width: rect.width * size }
        : { ...rect, top: rect.top + rect.height * offset, height: rect.height * size }
    offset += size
    for (const [k, v] of computePaneRects(node.children[i], childRect)) out.set(k, v)
  }
  return out
}

function firstPaneId(node: PaneNode): string | undefined {
  if (node.type === 'pane') return node.paneId
  return node.children.length > 0 ? firstPaneId(node.children[0]) : undefined
}

function calcDropZone(el: HTMLElement, e: React.DragEvent): DropZone {
  const rect = el.getBoundingClientRect()
  const relX = (e.clientX - rect.left) / rect.width
  const relY = (e.clientY - rect.top) / rect.height
  if (relX > 0.3 && relX < 0.7 && relY > 0.3 && relY < 0.7) return 'center'
  const top = relY, bottom = 1 - relY, left = relX, right = 1 - relX
  const min = Math.min(top, bottom, left, right)
  if (min === top) return 'top'
  if (min === bottom) return 'bottom'
  if (min === left) return 'left'
  return 'right'
}

// ── Main component ──

const HANDLES_ID = 'classic-term-split-handles'

export const TerminalClassicHost: React.FC = () => {
  const root = useUIStore((s) => s.classicTermRoot)
  const panes = useUIStore((s) => s.classicTermPanes)
  const focusedPaneId = useUIStore((s) => s.classicTermFocusedPaneId)
  const ensureRoot = useUIStore((s) => s.ensureClassicTermRoot)
  const openNew = useUIStore((s) => s.openNewClassicTerm)

  // Seed an empty pane on first entry so the user can click "+".
  useEffect(() => {
    if (!root) ensureRoot()
  }, [root, ensureRoot])

  const rects = useMemo(
    () => (root ? computePaneRects(root) : new Map<string, Rect>()),
    [root],
  )
  const paneIds = useMemo(() => Array.from(rects.keys()), [rects])
  const hasSplits = paneIds.length > 1

  // First-time render or corrupted state — surface a visible entry point so
  // the user isn't staring at a blank screen with no affordance.
  if (!root || paneIds.length === 0) {
    const handleStart = async (): Promise<void> => {
      const paneId = ensureRoot()
      await openNew(paneId)
    }
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-tx-faint bg-bg-app">
        <TerminalIcon size={28} strokeWidth={1.5} />
        <div className="text-[13px]">No terminal yet</div>
        <button
          type="button"
          onClick={handleStart}
          className="flex items-center gap-1.5 px-4 py-1.5 text-[12px] text-tx-muted border border-border-strong rounded-md hover:border-tx-faint hover:text-tx-main transition-colors"
        >
          <Plus size={12} /> New Terminal
        </button>
      </div>
    )
  }

  return (
    <div className="flex-1 relative overflow-hidden min-h-0">
      {paneIds.map((paneId) => {
        const r = rects.get(paneId)!
        const pane = panes[paneId]
        if (!pane) return null
        return (
          <ClassicTermPaneHost
            key={paneId}
            paneId={paneId}
            pane={pane}
            top={r.top}
            left={r.left}
            width={r.width}
            height={r.height}
            isFocused={paneId === focusedPaneId}
            canClose={paneIds.length > 1}
          />
        )
      })}
      {hasSplits && (
        <div id={HANDLES_ID} className="absolute inset-0 z-10 pointer-events-none">
          <SplitHandlesRenderer node={root} />
        </div>
      )}
    </div>
  )
}

// ── One pane in the classic terminal tree ──

const ClassicTermPaneHost = memo(function ClassicTermPaneHost({
  paneId,
  pane,
  top,
  left,
  width,
  height,
  isFocused,
  canClose,
}: {
  paneId: string
  pane: Pane
  top: number
  left: number
  width: number
  height: number
  isFocused: boolean
  canClose: boolean
}) {
  const setFocus = useUIStore((s) => s.setClassicTermFocusedPane)
  const openNew = useUIStore((s) => s.openNewClassicTerm)
  const moveTabToPane = useUIStore((s) => s.moveClassicTermTabToPane)
  const splitWithTab = useUIStore((s) => s.splitClassicTermWithTab)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dropZone, setDropZone] = useState<DropZone | null>(null)

  const handleMouseDown = useCallback(() => {
    if (!isFocused) setFocus(paneId)
  }, [paneId, isFocused, setFocus])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(PANE_DRAG_TYPE)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (containerRef.current) setDropZone(calcDropZone(containerRef.current, e))
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const related = e.relatedTarget as Node | null
    if (!containerRef.current?.contains(related)) setDropZone(null)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    setDropZone(null)
    if (e.defaultPrevented) return
    const raw = e.dataTransfer.getData(PANE_DRAG_TYPE)
    if (!raw) return
    e.preventDefault()
    const { paneId: sourceId, tabId } = JSON.parse(raw) as { paneId: string; tabId?: string }
    if (!sourceId) return
    if (!containerRef.current) return
    const zone = calcDropZone(containerRef.current, e)

    if (tabId) {
      if (zone === 'center') {
        moveTabToPane(sourceId, tabId, paneId)
      } else {
        const direction: 'horizontal' | 'vertical' =
          zone === 'top' || zone === 'bottom' ? 'vertical' : 'horizontal'
        const position: 'before' | 'after' = zone === 'top' || zone === 'left' ? 'before' : 'after'
        splitWithTab(sourceId, tabId, paneId, direction, position)
      }
    }
  }, [paneId, moveTabToPane, splitWithTab])

  const handleNewTab = useCallback(() => {
    void openNew(paneId)
  }, [paneId, openNew])

  const activeTab = pane.tabs.find((t) => t.id === pane.activeTabId) ?? pane.tabs[0] ?? null

  const style: React.CSSProperties = {
    position: 'absolute',
    top: `${top}%`,
    left: `${left}%`,
    width: `${width}%`,
    height: `${height}%`,
  }

  return (
    <div
      ref={containerRef}
      style={style}
      className="flex flex-col overflow-hidden"
      onMouseDownCapture={handleMouseDown}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <ClassicTermTabBar
        paneId={paneId}
        pane={pane}
        isFocused={isFocused}
        canClose={canClose}
        onNewTab={handleNewTab}
      />
      <div className="flex-1 min-h-0 relative">
        {pane.tabs.map((t) => (
          <TerminalLeaf
            key={t.id}
            tab={t}
            visible={t.id === activeTab?.id}
          />
        ))}
        {pane.tabs.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-tx-faint">
            <TerminalIcon size={22} strokeWidth={1.5} />
            <div className="text-[12px]">No terminal</div>
            <button
              type="button"
              onClick={handleNewTab}
              className="flex items-center gap-1.5 px-4 py-1.5 text-[12px] text-tx-muted border border-border-strong rounded-md hover:border-tx-faint hover:text-tx-main transition-colors"
            >
              <Plus size={12} /> New terminal
            </button>
          </div>
        )}
      </div>
      {dropZone && <DropZonePreview zone={dropZone} />}
    </div>
  )
})

// ── Terminal leaf (renders/keeps xterm mounted per tab) ──

const TerminalLeaf = memo(function TerminalLeaf({
  tab,
  visible,
}: {
  tab: Item
  visible: boolean
}) {
  const sessionId = tab.resource
  const ref = useRef<TerminalViewHandle | null>(null)
  const replayBuffer = useUIStore(
    useCallback(
      (s) => (sessionId ? s.terminalSessions.find((t) => t.id === sessionId)?._replayBuffer : undefined),
      [sessionId],
    ),
  )

  useEffect(() => {
    if (!sessionId) return
    const registry = getTerminalRefs()
    registry.set(sessionId, ref)
    return () => {
      if (registry.get(sessionId) === ref) registry.delete(sessionId)
    }
  }, [sessionId])

  const wasVisible = useRef(visible)
  useEffect(() => {
    if (visible && !wasVisible.current) {
      requestAnimationFrame(() => {
        ref.current?.fit()
        ref.current?.refresh()
        ref.current?.focus()
      })
    } else if (visible) {
      requestAnimationFrame(() => ref.current?.focus())
    }
    wasVisible.current = visible
  }, [visible])

  if (!sessionId) return null

  return (
    <div
      className="absolute inset-0"
      style={visible ? undefined : { display: 'none' }}
    >
      <TerminalView ref={ref} terminalId={sessionId} replayBuffer={replayBuffer} />
    </div>
  )
})

// ── Tab bar ──

const ClassicTermTabBar = memo(function ClassicTermTabBar({
  paneId,
  pane,
  isFocused,
  canClose: _canClose,
  onNewTab,
}: {
  paneId: string
  pane: Pane
  isFocused: boolean
  canClose: boolean
  onNewTab: () => void
}) {
  const setActive = useUIStore((s) => s.setClassicTermActiveTab)
  const closeTab = useUIStore((s) => s.closeClassicTermTab)
  const moveWithinPane = useUIStore((s) => s.moveClassicTermTabWithinPane)
  const moveToPane = useUIStore((s) => s.moveClassicTermTabToPane)
  const [isDropTarget, setIsDropTarget] = useState(false)
  const [insertIndex, setInsertIndex] = useState<number | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  const handleHeaderDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.setData(PANE_DRAG_TYPE, JSON.stringify({ paneId }))
      e.dataTransfer.effectAllowed = 'move'
    },
    [paneId],
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(PANE_DRAG_TYPE)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    const bar = barRef.current
    if (!bar) return
    const chips = Array.from(bar.querySelectorAll<HTMLDivElement>('[data-term-tab-id]'))
    let idx = chips.length
    for (let i = 0; i < chips.length; i++) {
      const r = chips[i].getBoundingClientRect()
      if (e.clientX < r.left + r.width / 2) { idx = i; break }
    }
    setInsertIndex(idx)
    setIsDropTarget(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const related = e.relatedTarget as Node | null
    if (!barRef.current?.contains(related)) {
      setIsDropTarget(false)
      setInsertIndex(null)
    }
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const raw = e.dataTransfer.getData(PANE_DRAG_TYPE)
      setIsDropTarget(false)
      setInsertIndex(null)
      if (!raw) return
      const { paneId: sourceId, tabId } = JSON.parse(raw) as { paneId: string; tabId?: string }
      if (!tabId || !sourceId) return
      const targetIdx = insertIndex ?? pane.tabs.length
      if (sourceId === paneId) {
        moveWithinPane(paneId, tabId, targetIdx > 0 ? targetIdx - 1 : 0)
      } else {
        moveToPane(sourceId, tabId, paneId, targetIdx)
      }
    },
    [paneId, insertIndex, pane.tabs.length, moveWithinPane, moveToPane],
  )

  const baseCls = isFocused
    ? 'bg-bg-active border-border-subtle'
    : 'bg-bg-sidebar border-border-subtle'

  return (
    <div
      ref={barRef}
      draggable
      onDragStart={handleHeaderDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`shrink-0 h-8 flex items-stretch border-b text-[12px] select-none overflow-x-auto scroll-thin relative ${baseCls}`}
    >
      {pane.tabs.map((tab, i) => (
        <React.Fragment key={tab.id}>
          {isDropTarget && insertIndex === i && (
            <div className="w-[2px] shrink-0 bg-accent-main/70" />
          )}
          <ClassicTermTabChip
            paneId={paneId}
            tab={tab}
            isActive={tab.id === pane.activeTabId}
            isPaneFocused={isFocused}
            onActivate={() => setActive(paneId, tab.id)}
            onClose={() => closeTab(paneId, tab.id)}
          />
        </React.Fragment>
      ))}
      {isDropTarget && insertIndex === pane.tabs.length && (
        <div className="w-[2px] shrink-0 bg-accent-main/70" />
      )}
      <button
        type="button"
        onClick={onNewTab}
        className="shrink-0 px-2 text-tx-faint hover:text-tx-main hover:bg-bg-hover transition-colors"
        title="New terminal"
      >
        <Plus size={12} />
      </button>
    </div>
  )
})

const ClassicTermTabChip = memo(function ClassicTermTabChip({
  paneId,
  tab,
  isActive,
  isPaneFocused,
  onActivate,
  onClose,
}: {
  paneId: string
  tab: Item
  isActive: boolean
  isPaneFocused: boolean
  onActivate: () => void
  onClose: () => void
}) {
  const label = useUIStore((s) => {
    if (!tab.resource) return tab.label
    const session = s.terminalSessions.find((t) => t.id === tab.resource)
    if (session) return session.title
    if (/^[a-f0-9-]{20,}$/i.test(tab.label)) return 'Terminal'
    return tab.label
  })

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.stopPropagation()
    e.dataTransfer.setData(PANE_DRAG_TYPE, JSON.stringify({ paneId, tabId: tab.id }))
    e.dataTransfer.effectAllowed = 'move'
  }, [paneId, tab.id])

  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onClose()
  }, [onClose])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault()
      onClose()
    }
  }, [onClose])

  const activeCls = isActive
    ? 'text-tx-active bg-bg-app border-b-transparent'
    : 'text-tx-muted hover:text-tx-main hover:bg-bg-hover'

  return (
    <div
      draggable
      data-term-tab-id={tab.id}
      onDragStart={handleDragStart}
      onClick={onActivate}
      onMouseDown={handleMouseDown}
      className={`group/tab relative flex items-center gap-1.5 px-3 h-full min-w-[110px] max-w-[200px]
        border-r border-border-subtle cursor-pointer transition-colors ${activeCls}`}
      title={label}
    >
      <TerminalIcon size={12} className={`shrink-0 ${isActive ? 'text-tx-active' : 'text-tx-faint'}`} />
      <span className="truncate flex-1 text-[12px]">{label}</span>
      <button
        type="button"
        onClick={handleClose}
        aria-label="Close tab"
        className={`shrink-0 p-0.5 rounded transition-opacity hover:bg-bg-hover
          ${isActive ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover/tab:opacity-60'}`}
      >
        <X size={11} />
      </button>
      {isActive && isPaneFocused && (
        <span className="absolute inset-x-0 bottom-0 h-[1px] bg-accent-main/60 pointer-events-none" />
      )}
    </div>
  )
})

// ── Drop zone preview ──

function DropZonePreview({ zone }: { zone: DropZone }) {
  if (zone === 'center') {
    return (
      <div className="absolute inset-2 z-50 pointer-events-none bg-accent-main/10 border-2 border-dashed border-accent-main/40 rounded-md" />
    )
  }
  const halfStyle: React.CSSProperties = { position: 'absolute', zIndex: 50, pointerEvents: 'none' }
  const cls = 'bg-accent-main/10 border-2 border-dashed border-accent-main/40 rounded-md m-1'
  switch (zone) {
    case 'left':
      return <div style={{ ...halfStyle, top: 0, bottom: 0, left: 0, width: '50%' }} className={cls} />
    case 'right':
      return <div style={{ ...halfStyle, top: 0, bottom: 0, right: 0, width: '50%' }} className={cls} />
    case 'top':
      return <div style={{ ...halfStyle, top: 0, left: 0, right: 0, height: '50%' }} className={cls} />
    case 'bottom':
      return <div style={{ ...halfStyle, bottom: 0, left: 0, right: 0, height: '50%' }} className={cls} />
  }
}

// ── Split handles (drag to resize) ──

const SplitHandlesRenderer = memo(function SplitHandlesRenderer({
  node,
  rect = { top: 0, left: 0, width: 100, height: 100 },
}: {
  node: PaneNode
  rect?: Rect
}) {
  if (node.type === 'pane') return null
  const count = node.children.length
  const sizes = node.sizes?.length === count ? node.sizes : Array(count).fill(1 / count)
  let offset = 0
  return (
    <>
      {node.children.map((child, i) => {
        const size = sizes[i]
        const childRect =
          node.direction === 'horizontal'
            ? { ...rect, left: rect.left + rect.width * offset, width: rect.width * size }
            : { ...rect, top: rect.top + rect.height * offset, height: rect.height * size }
        offset += size
        const key = child.type === 'pane' ? child.paneId : firstPaneId(child) ?? String(i)
        const offsetBefore = sizes.slice(0, i).reduce((a, b) => a + b, 0)
        return (
          <React.Fragment key={key}>
            {i > 0 && (
              <SplitHandleOverlay
                direction={node.direction}
                rect={rect}
                nodeRef={node}
                index={i}
                offsetPct={offsetBefore}
              />
            )}
            <SplitHandlesRenderer node={child} rect={childRect} />
          </React.Fragment>
        )
      })}
    </>
  )
})

function SplitHandleOverlay({
  direction,
  rect,
  nodeRef,
  index,
  offsetPct,
}: {
  direction: 'horizontal' | 'vertical'
  rect: Rect
  nodeRef: PaneNode
  index: number
  offsetPct: number
}) {
  const isVertical = direction === 'vertical'
  const handleRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = handleRef.current
    if (!el) return
    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const container = document.getElementById(HANDLES_ID)
      if (!container || nodeRef.type !== 'split') return
      const cRect = container.getBoundingClientRect()
      const totalPx = isVertical ? cRect.height : cRect.width
      const startPos = isVertical ? e.clientY : e.clientX
      const node = nodeRef
      const count = node.children.length
      const startSizes = node.sizes?.length === count ? [...node.sizes] : Array(count).fill(1 / count)
      let finalSizes = startSizes
      const onMove = (ev: MouseEvent) => {
        const delta = ((isVertical ? ev.clientY : ev.clientX) - startPos) / totalPx
        const ns = [...startSizes]
        ns[index - 1] = Math.max(0.1, startSizes[index - 1] + delta)
        ns[index] = Math.max(0.1, startSizes[index] - delta)
        const total = ns.reduce((a, b) => a + b, 0)
        for (let k = 0; k < ns.length; k++) ns[k] /= total
        finalSizes = ns
        if (isVertical) el.style.top = `${rect.top + rect.height * ns.slice(0, index).reduce((a, b) => a + b, 0)}%`
        else el.style.left = `${rect.left + rect.width * ns.slice(0, index).reduce((a, b) => a + b, 0)}%`
      }
      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        if (finalSizes !== startSizes) {
          const state = useUIStore.getState()
          if (!state.classicTermRoot) return
          function updateNode(n: PaneNode): PaneNode {
            if (n === node && n.type === 'split') return { ...n, sizes: finalSizes }
            if (n.type === 'split') {
              const ch = n.children.map(updateNode)
              return ch.some((c, i) => c !== n.children[i]) ? { ...n, children: ch } : n
            }
            return n
          }
          const next = updateNode(state.classicTermRoot)
          if (next !== state.classicTermRoot) useUIStore.getState().setClassicTermLayout(next)
        }
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      document.body.style.cursor = isVertical ? 'row-resize' : 'col-resize'
      document.body.style.userSelect = 'none'
    }
    el.addEventListener('mousedown', onMouseDown)
    return () => el.removeEventListener('mousedown', onMouseDown)
  })

  const style: React.CSSProperties = isVertical
    ? {
        position: 'absolute',
        top: `${rect.top + rect.height * offsetPct}%`,
        left: `${rect.left}%`,
        width: `${rect.width}%`,
        height: '8px',
        marginTop: '-4px',
        cursor: 'row-resize',
        zIndex: 20,
      }
    : {
        position: 'absolute',
        top: `${rect.top}%`,
        left: `${rect.left + rect.width * offsetPct}%`,
        width: '8px',
        marginLeft: '-4px',
        height: `${rect.height}%`,
        cursor: 'col-resize',
        zIndex: 20,
      }

  return (
    <div ref={handleRef} style={style} className="pointer-events-auto group">
      <div
        className={`${
          isVertical ? 'h-px w-full mt-[3px]' : 'w-px h-full ml-[3px]'
        } bg-border-subtle group-hover:bg-accent-main/60 transition-colors`}
      />
    </div>
  )
}
