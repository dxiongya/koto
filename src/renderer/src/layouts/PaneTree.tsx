import React, { useMemo, useCallback, memo, useRef, useEffect, useState } from 'react'
import { FileText, Archive, Terminal, BookOpen, Brain, File, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useUIStore } from '../store/useUIStore'
import type { PaneNode, Pane, Item } from '../store/useUIStore'
import type { AppType } from '../../../shared/types'
import { getAppRegistry, AppAPIProvider } from '../core/AppContext'
import { SettingsApp } from '../apps/SettingsApp'
import { resolveAppForFile } from './paneRouting'
import { PaneContextProvider } from './PaneContext'
import { hasResourceType } from './resourceDrag'

type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center'

const PANE_DRAG_TYPE = 'application/x-lite-pane'
const FILE_DRAG_TYPE = 'application/x-lite-file'

const APP_ICONS: Record<string, LucideIcon> = {
  'notes.app': FileText,
  'collector.app': Archive,
  'terminal.app': Terminal,
  'wiki.app': BookOpen,
  'memory.app': Brain,
}

function getAppIcon(appId: AppType): LucideIcon {
  return APP_ICONS[appId] ?? File
}

function appName(appId: AppType): string {
  const reg = getAppRegistry().get(appId)
  return reg?.definition.manifest.name ?? appId.replace('.app', '')
}

function tabTooltip(item: Item): string {
  return `${appName(item.appId)} — ${item.label}`
}

interface Rect { top: number; left: number; width: number; height: number }

const HANDLES_CONTAINER_ID = 'pane-split-handles-container'

function computePaneRects(
  node: PaneNode,
  rect: Rect = { top: 0, left: 0, width: 100, height: 100 },
): Map<string, Rect> {
  const result = new Map<string, Rect>()
  if (node.type === 'pane') {
    result.set(node.paneId, rect)
    return result
  }
  const count = node.children.length
  const sizes = node.sizes?.length === count ? node.sizes : Array(count).fill(1 / count)
  let offset = 0
  for (let i = 0; i < count; i++) {
    const size = sizes[i]
    const childRect = node.direction === 'horizontal'
      ? { ...rect, left: rect.left + rect.width * offset, width: rect.width * size }
      : { ...rect, top: rect.top + rect.height * offset, height: rect.height * size }
    offset += size
    for (const [id, r] of computePaneRects(node.children[i], childRect)) {
      result.set(id, r)
    }
  }
  return result
}

function firstPaneId(node: PaneNode): string | undefined {
  if (node.type === 'pane') return node.paneId
  return node.children.length > 0 ? firstPaneId(node.children[0]) : undefined
}

const selectRootLayout = (s: { rootLayout: PaneNode | null }) => s.rootLayout
const selectFocusedPaneId = (s: { focusedPaneId: string | null }) => s.focusedPaneId

export const PaneTree: React.FC = () => {
  const rootLayout = useUIStore(selectRootLayout)
  const focusedPaneId = useUIStore(selectFocusedPaneId)

  const rects = useMemo(
    () => (rootLayout ? computePaneRects(rootLayout) : new Map<string, Rect>()),
    [rootLayout],
  )

  if (!rootLayout) return null

  const paneIds = Array.from(rects.keys())
  const showFocusIndicator = paneIds.length > 1
  const hasSplits = paneIds.length > 1

  return (
    <div className="flex-1 relative overflow-hidden">
      {paneIds.map((paneId) => {
        const r = rects.get(paneId)!
        return (
          <PaneHost
            key={paneId}
            paneId={paneId}
            top={r.top}
            left={r.left}
            width={r.width}
            height={r.height}
            isFocused={paneId === focusedPaneId}
            showFocusIndicator={showFocusIndicator}
            canClose={paneIds.length > 1}
          />
        )
      })}

      {hasSplits && (
        <div
          id={HANDLES_CONTAINER_ID}
          className="absolute inset-0 z-10 pointer-events-none"
        >
          <SplitHandlesRenderer node={rootLayout} />
        </div>
      )}
    </div>
  )
}

// ── PaneHost ──
// Receives primitive rect fields so React.memo shallow comparison works reliably.
// During a split resize, only panes whose rect actually changed will re-render.

const PaneHost = memo(function PaneHost({
  paneId,
  top,
  left,
  width,
  height,
  isFocused,
  canClose,
}: {
  paneId: string
  top: number
  left: number
  width: number
  height: number
  isFocused: boolean
  showFocusIndicator: boolean
  canClose: boolean
}) {
  const pane = useUIStore(useCallback((s) => s.panes[paneId], [paneId]))
  const setFocusedPane = useUIStore((s) => s.setFocusedPane)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dropZone, setDropZone] = useState<DropZone | null>(null)

  const handleMouseDown = useCallback(() => {
    if (!isFocused) setFocusedPane(paneId)
  }, [paneId, isFocused, setFocusedPane])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const types = e.dataTransfer.types
    const isPaneDrag = types.includes(PANE_DRAG_TYPE)
    const isResourceDrag = hasResourceType(types)
    if (!isPaneDrag && !isResourceDrag) return
    e.preventDefault()
    e.dataTransfer.dropEffect = isPaneDrag ? 'move' : 'copy'
    if (containerRef.current) {
      // Only show edge/split preview for pane/tab or file drags where
      // "open as tab / split" semantics apply. Generic resource drops
      // (collector items) insert into the active app, so no preview — they
      // just need the whole pane to be a valid dropzone so the child's
      // drop handler receives the event.
      const showPreview = isPaneDrag || types.includes(FILE_DRAG_TYPE)
      setDropZone(showPreview ? calcDropZone(containerRef.current, e) : null)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const related = e.relatedTarget as Node | null
    if (!containerRef.current?.contains(related)) setDropZone(null)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    // If the inner app (Lexical editor / CollectorApp / TerminalView) already
    // handled the drop, don't double-process as a pane-level action. Those
    // handlers call preventDefault() on success; React's event bubbles up from
    // child → parent, so by the time PaneHost sees it, we can tell via
    // defaultPrevented.
    if (e.defaultPrevented) {
      setDropZone(null)
      return
    }
    setDropZone(null)
    if (!containerRef.current) return
    const zone = calcDropZone(containerRef.current, e)
    const store = useUIStore.getState()

    // ── Pane / Tab drag drop (drag from a pane's tab bar or a tab chip) ──
    const paneDragRaw = e.dataTransfer.getData(PANE_DRAG_TYPE)
    if (paneDragRaw) {
      e.preventDefault()
      e.stopPropagation()
      try {
        const { paneId: sourceId, tabId } = JSON.parse(paneDragRaw) as {
          paneId: string
          tabId?: string
        }
        if (!sourceId) return

        // Tab drag: move tab into this pane (center) or split + move (edge).
        if (tabId) {
          if (zone === 'center') {
            store.moveTabToPane(sourceId, tabId, paneId)
          } else {
            const direction: 'horizontal' | 'vertical' =
              zone === 'top' || zone === 'bottom' ? 'vertical' : 'horizontal'
            const position: 'before' | 'after' =
              zone === 'top' || zone === 'left' ? 'before' : 'after'
            store.splitPaneWithTab(sourceId, tabId, paneId, direction, position)
          }
          return
        }

        // Pane drag (whole pane): move it next to this one.
        if (sourceId === paneId) return
        const direction: 'horizontal' | 'vertical' =
          zone === 'top' || zone === 'bottom' ? 'vertical' : 'horizontal'
        const position: 'before' | 'after' =
          zone === 'top' || zone === 'left' ? 'before' : 'after'
        const dir = zone === 'center' ? 'horizontal' : direction
        const pos = zone === 'center' ? 'after' : position
        store.movePane(sourceId, paneId, dir, pos)
      } catch { /* ignore */ }
      return
    }

    // ── File / resource drop ──
    // Only intercept edge-zone drops (split). Center drops fall through so the
    // inner app can handle them; if nothing else does, we fall back to
    // "open as tab" below.
    const filePath = e.dataTransfer.getData(FILE_DRAG_TYPE)
    if (!filePath) return
    const appId = resolveAppForFile(filePath)
    if (!appId) return

    if (zone === 'center') {
      // Only open-as-tab when the active app ISN'T the target app — i.e., the
      // user meant to switch apps, not insert into the current editor. For
      // matching apps we leave it to the inner app's drop handler (which, if
      // registered, would have set defaultPrevented above).
      const activePane = store.panes[paneId]
      const activeItem = activePane?.tabs.find((t) => t.id === activePane.activeTabId)
      if (activeItem?.appId === appId) {
        // Same-app drop into content — treat as app-level insert: let the app
        // handle it. If no handler, do nothing (safe default).
        return
      }
      e.preventDefault()
      store.openTabInPane(paneId, appId, filePath)
      store.trackRecentFile(filePath, appId)
      return
    }
    e.preventDefault()

    const direction: 'horizontal' | 'vertical' =
      zone === 'top' || zone === 'bottom' ? 'vertical' : 'horizontal'
    const position: 'before' | 'after' =
      zone === 'top' || zone === 'left' ? 'before' : 'after'
    store.openFileInPane({ filePath, appId, targetPaneId: paneId, direction, position })
  }, [paneId])

  if (!pane) return null

  const activeTab = pane.tabs.find((t) => t.id === pane.activeTabId) ?? pane.tabs[0] ?? null
  const registry = getAppRegistry()
  const activeAppId = activeTab?.appId ?? 'notes.app'
  const registered = registry.get(activeAppId)
  const AppComponent = activeAppId === 'settings.app' ? SettingsApp : registered?.definition.component

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
      className="group/pane flex flex-col overflow-hidden relative"
      onMouseDownCapture={handleMouseDown}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <PaneTabs
        paneId={paneId}
        pane={pane}
        isFocused={isFocused}
        canClose={canClose}
        onDragEnter={() => setDropZone(null)}
      />
      <div className="flex-1 min-h-0 relative flex flex-col">
        {activeTab && AppComponent ? (
          <PaneContextProvider key={activeTab.id} value={{ paneId, itemId: activeTab.id }}>
            <AppAPIProvider appId={activeAppId}>
              <AppComponent api={undefined as never} />
            </AppAPIProvider>
          </PaneContextProvider>
        ) : (
          <PaneEmptyState appId={activeAppId} />
        )}
      </div>

      {dropZone && <DropZonePreview zone={dropZone} />}
    </div>
  )
})

// ── Pane Tabs ──
// VSCode-style tab bar: one chip per tab, click to activate, X to close.
// Whole bar is a drop target for file drags; drag-start on a tab lets it
// be moved to other panes (Phase 2 will handle cross-pane drop).

const PaneTabs = memo(function PaneTabs({
  paneId,
  pane,
  isFocused,
  canClose: _canClose,
  onDragEnter,
}: {
  paneId: string
  pane: Pane
  isFocused: boolean
  canClose: boolean
  onDragEnter?: () => void
}) {
  const setActiveTab = useUIStore((s) => s.setActiveTab)
  const closeTab = useUIStore((s) => s.closeTab)
  const [isDropTarget, setIsDropTarget] = useState(false)
  const [insertIndex, setInsertIndex] = useState<number | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  const handleHeaderDragStart = useCallback((e: React.DragEvent) => {
    // Click-and-drag on empty tab-bar area = move the whole pane.
    // Per-tab drag is handled on the tab element below.
    e.dataTransfer.setData(PANE_DRAG_TYPE, JSON.stringify({ paneId }))
    e.dataTransfer.effectAllowed = 'move'
  }, [paneId])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    const types = e.dataTransfer.types
    // Tab bar only handles tab/pane drags and file drags. Generic resource
    // drags (collector items) don't belong here — let them bubble to PaneHost.
    if (!types.includes(FILE_DRAG_TYPE) && !types.includes(PANE_DRAG_TYPE)) return
    setIsDropTarget(true)
    onDragEnter?.()
  }, [onDragEnter])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const types = e.dataTransfer.types
    if (!types.includes(FILE_DRAG_TYPE) && !types.includes(PANE_DRAG_TYPE)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = types.includes(PANE_DRAG_TYPE) ? 'move' : 'copy'
    // Compute insert index from cursor x relative to tab chip midpoints.
    const bar = barRef.current
    if (!bar) return
    const chips = Array.from(bar.querySelectorAll<HTMLDivElement>('[data-tab-id]'))
    let idx = chips.length
    for (let i = 0; i < chips.length; i++) {
      const r = chips[i].getBoundingClientRect()
      if (e.clientX < r.left + r.width / 2) {
        idx = i
        break
      }
    }
    setInsertIndex(idx)
    setIsDropTarget(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear when leaving the bar entirely (not when crossing between chips).
    const related = e.relatedTarget as Node | null
    if (!barRef.current?.contains(related)) {
      setIsDropTarget(false)
      setInsertIndex(null)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const store = useUIStore.getState()
    const targetIdx = insertIndex ?? pane.tabs.length
    setIsDropTarget(false)
    setInsertIndex(null)

    // Tab / pane drag
    const paneDragRaw = e.dataTransfer.getData(PANE_DRAG_TYPE)
    if (paneDragRaw) {
      try {
        const { paneId: sourceId, tabId } = JSON.parse(paneDragRaw) as {
          paneId: string
          tabId?: string
        }
        if (tabId) {
          if (sourceId === paneId) {
            store.moveTabWithinPane(paneId, tabId, targetIdx > 0 ? targetIdx - 1 : 0)
          } else {
            store.moveTabToPane(sourceId, tabId, paneId, targetIdx)
          }
        }
        // Whole-pane drops on another pane's tab bar aren't meaningful — ignore.
      } catch { /* ignore */ }
      return
    }

    // File drag → open as tab at the requested position.
    const filePath = e.dataTransfer.getData(FILE_DRAG_TYPE)
    if (!filePath) return
    const appId = resolveAppForFile(filePath)
    if (!appId) return
    store.openTabInPane(paneId, appId, filePath)
    // openTabInPane appends; if the user dropped at a specific index, reorder after.
    const created = useUIStore.getState().panes[paneId]?.tabs.find(
      (t) => t.appId === appId && t.resource === filePath,
    )
    if (created && targetIdx !== pane.tabs.length) {
      store.moveTabWithinPane(paneId, created.id, targetIdx)
    }
    store.trackRecentFile(filePath, appId)
  }, [paneId, insertIndex, pane.tabs.length])

  const baseBar = isFocused
    ? 'bg-bg-active border-border-subtle'
    : 'bg-bg-sidebar border-border-subtle'

  return (
    <div
      ref={barRef}
      draggable
      onDragStart={handleHeaderDragStart}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`shrink-0 h-8 flex items-stretch border-b text-[12px] select-none overflow-x-auto scroll-thin relative ${baseBar}`}
    >
      {pane.tabs.map((item, i) => (
        <React.Fragment key={item.id}>
          {isDropTarget && insertIndex === i && <DropInsertLine />}
          <TabChip
            paneId={paneId}
            item={item}
            isActive={item.id === pane.activeTabId}
            isPaneFocused={isFocused}
            onActivate={() => setActiveTab(paneId, item.id)}
            onClose={() => closeTab(paneId, item.id)}
          />
        </React.Fragment>
      ))}
      {isDropTarget && insertIndex === pane.tabs.length && <DropInsertLine />}
    </div>
  )
})

function DropInsertLine() {
  return <div className="w-[2px] shrink-0 bg-accent-main/70" />
}

// Rendered when a pane's active app isn't registered (or no tabs yet).
// Keeps the surface quiet — one icon, one line, no calls to action.
function PaneEmptyState({ appId }: { appId: AppType }) {
  const Icon = getAppIcon(appId)
  const name = appName(appId)
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-tx-faint">
      <Icon size={22} strokeWidth={1.5} className="text-tx-faint" />
      <div className="text-[12px]">{name}</div>
    </div>
  )
}

const TabChip = memo(function TabChip({
  paneId,
  item,
  isActive,
  isPaneFocused,
  onActivate,
  onClose,
}: {
  paneId: string
  item: Item
  isActive: boolean
  isPaneFocused: boolean
  onActivate: () => void
  onClose: () => void
}) {
  const Icon = getAppIcon(item.appId)

  // Terminal tabs derive their label from the live session title (which can
  // change as the shell runs). When the session can't be found (e.g. stale
  // restored id) we show a generic "Terminal" rather than a raw UUID.
  const displayLabel = useUIStore((s) => {
    if (item.appId !== 'terminal.app' || !item.resource) return item.label
    const sessionId = item.resource.startsWith('terminal://')
      ? item.resource.slice('terminal://'.length)
      : item.resource
    const session = s.terminalSessions.find((t) => t.id === sessionId)
    if (session) return session.title
    // Stale id — prefer the stored label if it already looks human, else "Terminal".
    if (/^[a-f0-9-]{20,}$/i.test(item.label)) return 'Terminal'
    return item.label
  })

  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onClose()
  }, [onClose])

  const handleDragStart = useCallback((e: React.DragEvent) => {
    // Phase 2 will encode tabId for cross-pane moves; today we still mark
    // the drag as a pane-move so container drops fall back gracefully.
    e.stopPropagation()
    e.dataTransfer.setData(PANE_DRAG_TYPE, JSON.stringify({ paneId, tabId: item.id }))
    e.dataTransfer.effectAllowed = 'move'
  }, [paneId, item.id])

  // Middle click = close tab (browser/VSCode convention)
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
      data-tab-id={item.id}
      onDragStart={handleDragStart}
      onClick={onActivate}
      onMouseDown={handleMouseDown}
      title={tabTooltip(item)}
      className={`group/tab relative flex items-center gap-1.5 px-3 h-full min-w-[110px] max-w-[200px]
        border-r border-border-subtle cursor-pointer transition-colors ${activeCls}`}
    >
      <Icon size={12} className={`shrink-0 ${isActive ? 'text-tx-active' : 'text-tx-faint'}`} />
      <span className="truncate flex-1 text-[12px]">{displayLabel}</span>
      <button
        type="button"
        onClick={handleClose}
        aria-label="Close tab"
        className={`shrink-0 p-0.5 rounded transition-opacity hover:bg-bg-hover
          ${isActive ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover/tab:opacity-60'}`}
      >
        <X size={11} />
      </button>
      {/* underline accent for active tab in focused pane */}
      {isActive && isPaneFocused && (
        <span className="absolute inset-x-0 bottom-0 h-[1px] bg-accent-main/60 pointer-events-none" />
      )}
    </div>
  )
})

// ── Drop zone preview + detection ──

function calcDropZone(el: HTMLElement, e: React.DragEvent): DropZone {
  const rect = el.getBoundingClientRect()
  const relX = (e.clientX - rect.left) / rect.width
  const relY = (e.clientY - rect.top) / rect.height
  // Center band (30%-70% on both axes) = replace-in-place
  if (relX > 0.3 && relX < 0.7 && relY > 0.3 && relY < 0.7) return 'center'
  // Otherwise pick the closer edge
  const distTop = relY
  const distBottom = 1 - relY
  const distLeft = relX
  const distRight = 1 - relX
  const min = Math.min(distTop, distBottom, distLeft, distRight)
  if (min === distTop) return 'top'
  if (min === distBottom) return 'bottom'
  if (min === distLeft) return 'left'
  return 'right'
}

function DropZonePreview({ zone }: { zone: DropZone }) {
  if (zone === 'center') {
    return (
      <div className="absolute inset-2 z-50 pointer-events-none bg-accent-main/10 border-2 border-dashed border-accent-main/40 rounded-md" />
    )
  }
  const halfStyle: React.CSSProperties = {
    position: 'absolute',
    zIndex: 50,
    pointerEvents: 'none',
  }
  const edgeClass = 'bg-accent-main/10 border-2 border-dashed border-accent-main/40 rounded-md m-1'
  switch (zone) {
    case 'left':
      return <div style={{ ...halfStyle, top: 0, bottom: 0, left: 0, width: '50%' }} className={edgeClass} />
    case 'right':
      return <div style={{ ...halfStyle, top: 0, bottom: 0, right: 0, width: '50%' }} className={edgeClass} />
    case 'top':
      return <div style={{ ...halfStyle, top: 0, left: 0, right: 0, height: '50%' }} className={edgeClass} />
    case 'bottom':
      return <div style={{ ...halfStyle, bottom: 0, left: 0, right: 0, height: '50%' }} className={edgeClass} />
  }
}

// ── Split Handles Renderer ──
// Walks the tree and emits a SplitHandleOverlay between each pair of siblings.
// Memoized — only re-runs when rootLayout ref changes (i.e. after structural edits).

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
        const childRect = node.direction === 'horizontal'
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

// ── Split Handle (draggable resize) ──
// Pure DOM drag — no React state / store updates during drag.
// Only handle position is mutated via .style during mousemove.
// Single store commit on mouseup via direct reference match on the split node.

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
    const handle = handleRef.current
    if (!handle) return

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const container = document.getElementById(HANDLES_CONTAINER_ID)
      if (!container || nodeRef.type !== 'split') return
      const cRect = container.getBoundingClientRect()
      const totalPx = isVertical ? cRect.height : cRect.width
      const startPos = isVertical ? e.clientY : e.clientX

      const node = nodeRef
      const count = node.children.length
      const startSizes = node.sizes?.length === count ? [...node.sizes] : Array(count).fill(1 / count)
      let finalSizes = startSizes

      const onMouseMove = (ev: MouseEvent) => {
        const delta = ((isVertical ? ev.clientY : ev.clientX) - startPos) / totalPx
        const ns = [...startSizes]
        ns[index - 1] = Math.max(0.1, startSizes[index - 1] + delta)
        ns[index] = Math.max(0.1, startSizes[index] - delta)
        const total = ns.reduce((a, b) => a + b, 0)
        for (let i = 0; i < ns.length; i++) ns[i] /= total
        finalSizes = ns
        // CSS-only: move the handle, not React state
        if (isVertical) {
          handle.style.top = `${rect.top + rect.height * ns.slice(0, index).reduce((a, b) => a + b, 0)}%`
        } else {
          handle.style.left = `${rect.left + rect.width * ns.slice(0, index).reduce((a, b) => a + b, 0)}%`
        }
      }

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''

        // Single store update on release — reference-match the exact split node
        if (finalSizes !== startSizes) {
          const state = useUIStore.getState()
          if (!state.rootLayout) return
          function updateNode(n: PaneNode): PaneNode {
            if (n === node && n.type === 'split') return { ...n, sizes: finalSizes }
            if (n.type === 'split') {
              const ch = n.children.map(updateNode)
              return ch.some((c, i) => c !== n.children[i]) ? { ...n, children: ch } : n
            }
            return n
          }
          const newLayout = updateNode(state.rootLayout)
          if (newLayout !== state.rootLayout) {
            useUIStore.setState({ rootLayout: newLayout })
            window.api.state.update({ rootLayout: newLayout })
          }
        }
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
      document.body.style.cursor = isVertical ? 'row-resize' : 'col-resize'
      document.body.style.userSelect = 'none'
    }

    handle.addEventListener('mousedown', onMouseDown)
    return () => handle.removeEventListener('mousedown', onMouseDown)
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
        } bg-border-subtle group-hover:bg-accent-main/60`}
      />
    </div>
  )
}
