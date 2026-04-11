import React, { useRef, useEffect, useCallback, useState, useMemo, memo } from 'react'
import { Terminal, X, GripVertical, Plus } from 'lucide-react'
import { useUIStore, collectTerminalIds, removeFromTree, insertIntoTree } from '../../store/useUIStore'
import type { SplitNode } from '../../store/useUIStore'
import { TerminalView } from './TerminalView'
import type { TerminalViewHandle } from './TerminalView'

/** Global registry so the before-unload handler can serialize all terminals */
const terminalRefs = new Map<string, React.RefObject<TerminalViewHandle | null>>()

export function getTerminalRefs(): Map<string, React.RefObject<TerminalViewHandle | null>> {
  return terminalRefs
}

type DropZone = 'left' | 'right' | 'top' | 'bottom'

// ── Drop state management via module-level pub/sub (avoids Context re-renders) ──
let _dropTarget: { terminalId: string; zone: DropZone } | null = null
const _dropListeners = new Set<() => void>()

function setGlobalDropTarget(v: { terminalId: string; zone: DropZone } | null) {
  if (v?.terminalId === _dropTarget?.terminalId && v?.zone === _dropTarget?.zone) return
  _dropTarget = v
  _dropListeners.forEach((fn) => fn())
}

function useDropTargetFor(terminalId: string): DropZone | null {
  const [zone, setZone] = useState<DropZone | null>(null)
  useEffect(() => {
    const update = () => {
      const z = _dropTarget?.terminalId === terminalId ? _dropTarget.zone : null
      setZone((prev) => prev === z ? prev : z)
    }
    _dropListeners.add(update)
    update()
    return () => { _dropListeners.delete(update) }
  }, [terminalId])
  return zone
}

// ── Layout rect computation ──
// Converts a SplitNode tree into absolute position rects (percentages) for each terminal.
// Tab bar height is handled in CSS, not here.
interface LayoutRect { top: number; left: number; width: number; height: number }

function computeLayoutRects(
  node: SplitNode,
  rect: LayoutRect = { top: 0, left: 0, width: 100, height: 100 },
): Map<string, LayoutRect> {
  const result = new Map<string, LayoutRect>()
  if (node.type === 'terminal') {
    result.set(node.terminalId, rect)
    return result
  }
  const count = node.children.length
  // Use custom sizes if available, otherwise equal split
  const sizes = node.sizes?.length === count
    ? node.sizes
    : Array(count).fill(1 / count)
  let offset = 0
  node.children.forEach((child, i) => {
    const size = sizes[i]
    const childRect = node.direction === 'horizontal'
      ? { ...rect, left: rect.left + rect.width * offset, width: rect.width * size }
      : { ...rect, top: rect.top + rect.height * offset, height: rect.height * size }
    offset += size
    for (const [id, r] of computeLayoutRects(child, childRect)) {
      result.set(id, r)
    }
  })
  return result
}

// ── Stable selectors ──
const selectShowCommandPalette = (s: { showCommandPalette: boolean }) => s.showCommandPalette
const selectActiveTerminalId = (s: { activeTerminalId: string | null }) => s.activeTerminalId
const selectHasTerminals = (s: { terminalSessions: { id: string }[] }) => s.terminalSessions.length > 0
const selectSessions = (s: { terminalSessions: { id: string }[] }) => s.terminalSessions
const selectActiveLayout = (s: {
  terminalWorkspaces: { id: string; groups: { id: string; layout: SplitNode }[]; activeGroupId: string | null }[]
  activeWorkspaceId: string | null
}): SplitNode | null => {
  const ws = s.terminalWorkspaces.find((w) => w.id === s.activeWorkspaceId)
  if (!ws) return null
  const g = ws.groups.find((gr) => gr.id === ws.activeGroupId)
  return g?.layout ?? null
}

// ── Main Component ──
// Architecture (VS Code pattern):
// 1. ALL xterm instances always mounted in a flat layer (never destroyed on tab switch)
// 2. Layout tree computes position rects — each xterm positioned via CSS
// 3. Terminals not in active group get display:none (xterm buffer stays in JS memory)

export const TerminalApp: React.FC = () => {
  const showCommandPalette = useUIStore(selectShowCommandPalette)
  const activeTerminalId = useUIStore(selectActiveTerminalId)
  const hasTerminals = useUIStore(selectHasTerminals)
  const activeLayout = useUIStore(selectActiveLayout, (a, b) => a === b)
  const sessions = useUIStore(selectSessions)
  const sessionIds = useMemo(() => sessions.map((t) => t.id), [sessions])

  // Compute layout rects from the active split tree
  const layoutRects = useMemo(
    () => activeLayout ? computeLayoutRects(activeLayout) : new Map<string, LayoutRect>(),
    [activeLayout],
  )

  // Keyboard navigation for split panes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey || !e.altKey) return
      const state = useUIStore.getState()
      const ws = state.terminalWorkspaces.find((w) => w.id === state.activeWorkspaceId)
      const group = ws?.groups.find((g) => g.id === ws.activeGroupId)
      if (!group) return
      const ids = collectTerminalIds(group.layout)
      if (ids.length < 2 && e.key !== 'w') return
      const currentIdx = ids.indexOf(state.activeTerminalId ?? '')

      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        const nextIdx = currentIdx <= 0 ? ids.length - 1 : currentIdx - 1
        state.setActiveTerminalId(ids[nextIdx])
        terminalRefs.get(ids[nextIdx])?.current?.focus()
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        const nextIdx = currentIdx >= ids.length - 1 ? 0 : currentIdx + 1
        state.setActiveTerminalId(ids[nextIdx])
        terminalRefs.get(ids[nextIdx])?.current?.focus()
      } else if (e.key === 'w') {
        e.preventDefault()
        if (state.activeTerminalId) {
          window.api.terminal.close(state.activeTerminalId)
          state.removeTerminalSession(state.activeTerminalId)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const blurClass = showCommandPalette
    ? 'opacity-50 transition-opacity duration-200'
    : 'transition-opacity duration-200'

  return (
    <div className={`flex-1 flex flex-col overflow-hidden ${blurClass}`} role="region" aria-label="Terminal">
      <div className="flex-1 overflow-hidden relative">
        {/* Persistent xterm instance layer — ALL terminals always mounted */}
        {sessionIds.map((id) => (
          <PersistentTerminalPane
            key={id}
            terminalId={id}
            isActive={id === activeTerminalId}
            layoutRect={layoutRects.get(id) ?? null}
            showTabBar={layoutRects.size > 0}
          />
        ))}

        {/* Split handles overlay */}
        {activeLayout && layoutRects.size > 1 && (
          <div className="absolute inset-0 z-10 pointer-events-none" id="split-handles-container">
            <SplitHandlesRenderer node={activeLayout} />
          </div>
        )}

        {!hasTerminals && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-tx-faint">
            <Terminal size={32} className="text-tx-faint" />
            <div className="text-sm">No terminals open</div>
            <button
              onClick={async () => {
                const store = useUIStore.getState()
                const cwd = store.codeProjectPath ?? undefined
                const res = await window.api.terminal.create(cwd)
                if (res.ok) {
                  const { genTerminalPersistKey } = await import('../../store/useUIStore')
                  store.addTerminalSession({
                    id: res.data,
                    persistKey: genTerminalPersistKey(),
                    title: `Terminal 1`,
                    cwd,
                  })
                }
              }}
              className="flex items-center gap-1.5 px-4 py-1.5 text-[13px] text-tx-muted border border-border-strong rounded-md hover:border-tx-faint hover:text-tx-main transition-colors"
            >
              <Plus size={13} />
              New Terminal
            </button>
            <div className="text-xs text-tx-faint mt-1">
              Or press <kbd className="px-1.5 py-0.5 text-[10px] bg-bg-hover border border-border-subtle rounded font-mono">⌘K</kbd> and type "new terminal"
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Persistent Terminal Pane ──
// Always mounted. Positioned by layout rect. Hidden via display:none when not in active group.
// xterm instance survives group/workspace switches — scrollback preserved.

const PersistentTerminalPane = memo(function PersistentTerminalPane({
  terminalId,
  isActive,
  layoutRect,
  showTabBar,
}: {
  terminalId: string
  isActive: boolean
  layoutRect: LayoutRect | null
  showTabBar: boolean
}) {
  const ref = useRef<TerminalViewHandle | null>(null)
  const myDrop = useDropTargetFor(terminalId)
  const paneRef = useRef<HTMLDivElement>(null)
  // Get replay buffer from session (one-time, for restore)
  const replayBuffer = useUIStore(
    useCallback((s) => s.terminalSessions.find((t) => t.id === terminalId)?._replayBuffer, [terminalId]),
  )

  // Lazy mount: don't create xterm until container is first visible.
  // This prevents xterm.open() on a display:none container (0-size → distorted output).
  // Once mounted, stays mounted forever (scrollback preserved on group switch).
  const [mounted, setMounted] = useState(!!layoutRect)
  useEffect(() => {
    if (layoutRect && !mounted) setMounted(true)
  }, [layoutRect, mounted])

  useEffect(() => {
    if (mounted) {
      terminalRefs.set(terminalId, ref)
      return () => { terminalRefs.delete(terminalId) }
    }
  }, [terminalId, mounted])

  // Re-fit + focus when hidden → visible
  const wasVisible = useRef(!!layoutRect)
  useEffect(() => {
    const isNowVisible = !!layoutRect
    if (isNowVisible && !wasVisible.current && mounted) {
      requestAnimationFrame(() => {
        ref.current?.fit()
        ref.current?.refresh() // Fix garbled display after display:none
        if (isActive) ref.current?.focus()
      })
    } else if (isActive && isNowVisible) {
      requestAnimationFrame(() => ref.current?.focus())
    }
    wasVisible.current = isNowVisible
  }, [isActive, layoutRect, mounted])

  const handleClick = useCallback(() => {
    useUIStore.getState().setActiveTerminalId(terminalId)
    ref.current?.focus()
  }, [terminalId])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-terminal-drag')) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (paneRef.current) {
      setGlobalDropTarget({ terminalId, zone: calcZoneFromEvent(paneRef.current, e) })
    }
  }, [terminalId])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const related = e.relatedTarget as Node | null
    if (!paneRef.current?.contains(related)) setGlobalDropTarget(null)
  }, [])

  const handleDropEvent = useCallback((e: React.DragEvent) => {
    e.stopPropagation()
    if (paneRef.current) handlePaneDrop(terminalId, calcZoneFromEvent(paneRef.current, e), e)
  }, [terminalId])

  const handleActivate = useCallback(() => {
    useUIStore.getState().setActiveTerminalId(terminalId)
  }, [terminalId])

  const handleClose = useCallback(() => {
    window.api.terminal.close(terminalId)
    useUIStore.getState().removeTerminalSession(terminalId)
  }, [terminalId])

  const isVisible = !!layoutRect

  // Not yet mounted (never been visible) → render nothing
  if (!mounted) return null

  const style: React.CSSProperties = isVisible
    ? {
        position: 'absolute',
        top: `${layoutRect.top}%`,
        left: `${layoutRect.left}%`,
        width: `${layoutRect.width}%`,
        height: `${layoutRect.height}%`,
      }
    : { display: 'none' }

  return (
    <div
      ref={paneRef}
      style={style}
      className={isVisible ? 'flex flex-col' : undefined}
      onDragOver={isVisible ? handleDragOver : undefined}
      onDragLeave={isVisible ? handleDragLeave : undefined}
      onDrop={isVisible ? handleDropEvent : undefined}
    >
      {isVisible && showTabBar && (
        <PaneTabBarMemo
          terminalId={terminalId}
          isActiveTerminal={isActive}
          onActivate={handleActivate}
          onClose={handleClose}
        />
      )}
      <div
        className={isVisible ? 'flex-1 relative min-h-0' : undefined}
        onClick={handleClick}
        onDragOver={isVisible ? handleDragOver : undefined}
        onDragLeave={isVisible ? handleDragLeave : undefined}
        onDrop={isVisible ? handleDropEvent : undefined}
      >
        <div style={isVisible ? { position: 'absolute', inset: 0 } : undefined}>
          <TerminalView ref={ref} terminalId={terminalId} replayBuffer={replayBuffer} />
        </div>
      </div>

      {/* Per-pane drop preview */}
      {myDrop && (
        <div
          className="absolute inset-0 z-50 flex pointer-events-none"
          style={{ flexDirection: (myDrop === 'top' || myDrop === 'bottom') ? 'column' : 'row' }}
        >
          <div className={`flex-1 ${(myDrop === 'left' || myDrop === 'top') ? 'bg-accent-main/10 border-2 border-dashed border-accent-main/40 rounded-md m-1' : ''}`} />
          <div className={`flex-1 ${(myDrop === 'right' || myDrop === 'bottom') ? 'bg-accent-main/10 border-2 border-dashed border-accent-main/40 rounded-md m-1' : ''}`} />
        </div>
      )}
    </div>
  )
})

// ── Split Handles Renderer ──
// Only renders split handles as positioned overlays. Tab bars are inside each PersistentTerminalPane.

const SplitHandlesRenderer = memo(function SplitHandlesRenderer({
  node,
  rect = { top: 0, left: 0, width: 100, height: 100 },
}: {
  node: SplitNode
  rect?: LayoutRect
}) {
  if (node.type === 'terminal') return null

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
        const key = child.type === 'terminal' ? child.terminalId : firstTerminalId(child) ?? i
        const offsetBeforeThis = sizes.slice(0, i).reduce((a, b) => a + b, 0)
        return (
          <React.Fragment key={key}>
            {i > 0 && (
              <SplitHandleOverlay
                direction={node.direction}
                rect={rect}
                nodeRef={node}
                index={i}
                offsetPct={offsetBeforeThis}
              />
            )}
            <SplitHandlesRenderer node={child} rect={childRect} />
          </React.Fragment>
        )
      })}
    </>
  )
})

function firstTerminalId(node: SplitNode): string | undefined {
  if (node.type === 'terminal') return node.terminalId
  return node.children.length > 0 ? firstTerminalId(node.children[0]) : undefined
}

// ── Drop handler ──

function handlePaneDrop(targetTermId: string, zone: DropZone, e: React.DragEvent) {
  e.preventDefault()
  setGlobalDropTarget(null)
  const raw = e.dataTransfer.getData('application/x-terminal-drag')
  if (!raw) return
  const { termId } = JSON.parse(raw) as { termId: string; workspaceId: string }
  if (termId === targetTermId) return

  const dir: 'horizontal' | 'vertical' = (zone === 'top' || zone === 'bottom') ? 'vertical' : 'horizontal'
  const position: 'before' | 'after' = (zone === 'top' || zone === 'left') ? 'before' : 'after'

  const state = useUIStore.getState()
  const activeWorkspace = state.terminalWorkspaces.find((ws) => ws.id === state.activeWorkspaceId)
  if (!activeWorkspace) return

  const activeGroup = activeWorkspace.groups.find((g) => g.id === activeWorkspace.activeGroupId)
  const activeGroupIds = activeGroup ? collectTerminalIds(activeGroup.layout) : []

  if (activeGroupIds.includes(termId) && activeGroup) {
    const nextWorkspaces = state.terminalWorkspaces.map((ws) => {
      if (ws.id !== activeWorkspace.id) return ws
      const groups = ws.groups.map((g) => {
        if (g.id !== activeGroup.id) return g
        let layout = removeFromTree(g.layout, termId)
        if (!layout) layout = { type: 'terminal', terminalId: targetTermId }
        layout = insertIntoTree(layout, targetTermId, termId, dir, position)
        return { ...g, layout }
      })
      return { ...ws, groups }
    })
    useUIStore.setState({ terminalWorkspaces: nextWorkspaces })
    return
  }

  state.splitTerminalInWorkspace(activeWorkspace.id, targetTermId, termId, dir)
}

function calcZoneFromEvent(el: HTMLElement, e: React.DragEvent): DropZone {
  const rect = el.getBoundingClientRect()
  const relX = (e.clientX - rect.left) / rect.width
  const relY = (e.clientY - rect.top) / rect.height
  if (relY < 0.25) return 'top'
  if (relY > 0.75) return 'bottom'
  if (relX < 0.25) return 'left'
  if (relX > 0.75) return 'right'
  const dists = { top: relY, bottom: 1 - relY, left: relX, right: 1 - relX }
  return Object.entries(dists).sort((a, b) => a[1] - b[1])[0][0] as DropZone
}

// ── Tab Bar ──

const PaneTabBarMemo = memo(function PaneTabBar({
  terminalId,
  isActiveTerminal,
  onActivate,
  onClose,
}: {
  terminalId: string
  isActiveTerminal: boolean
  onActivate: () => void
  onClose: () => void
}) {
  const title = useUIStore(
    useCallback((s) => s.terminalSessions.find((t) => t.id === terminalId)?.title ?? 'Terminal', [terminalId]),
  )

  const handleDragStart = useCallback((e: React.DragEvent) => {
    const workspaceId = useUIStore.getState().activeWorkspaceId
    e.dataTransfer.setData(
      'application/x-terminal-drag',
      JSON.stringify({ termId: terminalId, workspaceId })
    )
    e.dataTransfer.effectAllowed = 'move'
  }, [terminalId])

  return (
    <div
      className={`shrink-0 flex items-center gap-1.5 px-3 py-[4px] text-[13px] border-b cursor-pointer group select-none relative
        ${isActiveTerminal ? 'bg-bg-active border-border-subtle' : 'bg-bg-sidebar border-border-subtle hover:bg-bg-hover'}`}
      onClick={onActivate}
      onDoubleClick={() => useUIStore.getState().unsplitTerminal(terminalId)}
    >
      {isActiveTerminal && <div className="absolute left-0 right-0 bottom-0 h-[1px] bg-status-success" />}
      <div
        draggable
        onDragStart={handleDragStart}
        className="cursor-grab active:cursor-grabbing text-tx-faint hover:text-tx-muted p-0.5"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical size={12} />
      </div>
      <Terminal size={13} className={`shrink-0 ${isActiveTerminal ? 'text-tx-active' : 'text-tx-faint'}`} />
      <span className={`truncate ${isActiveTerminal ? 'text-tx-active font-medium' : 'text-tx-main'}`}>{title}</span>
      <button
        onClick={(e) => { e.stopPropagation(); onClose() }}
        className="ml-auto p-0.5 text-tx-faint hover:text-tx-main opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label="Close terminal"
      >
        <X size={12} />
      </button>
    </div>
  )
})

// ── Split Handle (draggable resize) ──
// Pure DOM drag — no React state during drag, single store update on mouseup.

function SplitHandleOverlay({
  direction,
  rect,
  nodeRef,
  index,
  offsetPct,
}: {
  direction: 'horizontal' | 'vertical'
  rect: LayoutRect
  nodeRef: SplitNode
  index: number
  offsetPct: number
}) {
  const isVertical = direction === 'vertical'
  const handleRef = useRef<HTMLDivElement>(null)

  // Attach native mousedown — no React hooks involved in drag loop
  useEffect(() => {
    const handle = handleRef.current
    if (!handle) return

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const container = document.getElementById('split-handles-container')
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
        // CSS-only: move handle position (no React)
        if (isVertical) handle.style.top = `${rect.top + rect.height * ns.slice(0, index).reduce((a, b) => a + b, 0)}%`
        else handle.style.left = `${rect.left + rect.width * ns.slice(0, index).reduce((a, b) => a + b, 0)}%`
      }

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        // Single store update on release
        if (finalSizes !== startSizes) {
          const state = useUIStore.getState()
          const ws = state.terminalWorkspaces.find((w) => w.id === state.activeWorkspaceId)
          if (!ws) return
          const group = ws.groups.find((g) => g.id === ws.activeGroupId)
          if (!group) return
          function updateNode(n: SplitNode): SplitNode {
            if (n === node && n.type === 'split') return { ...n, sizes: finalSizes }
            if (n.type === 'split') {
              const ch = n.children.map(updateNode)
              return ch.some((c, i) => c !== n.children[i]) ? { ...n, children: ch } : n
            }
            return n
          }
          const newLayout = updateNode(group.layout)
          if (newLayout !== group.layout) {
            useUIStore.setState({
              terminalWorkspaces: state.terminalWorkspaces.map((w) =>
                w.id !== ws.id ? w : { ...w, groups: w.groups.map((g) => g.id === group.id ? { ...g, layout: newLayout } : g) }
              ),
            })
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
    ? { position: 'absolute', top: `${rect.top + rect.height * offsetPct}%`, left: `${rect.left}%`, width: `${rect.width}%`, height: '8px', marginTop: '-4px', cursor: 'row-resize', zIndex: 20 }
    : { position: 'absolute', top: `${rect.top}%`, left: `${rect.left + rect.width * offsetPct}%`, width: '8px', marginLeft: '-4px', height: `${rect.height}%`, cursor: 'col-resize', zIndex: 20 }

  return (
    <div ref={handleRef} style={style} className="pointer-events-auto group">
      <div className={`${isVertical ? 'h-px w-full mt-[3px]' : 'w-px h-full ml-[3px]'} bg-border-subtle group-hover:bg-accent-main/60`} />
    </div>
  )
}
