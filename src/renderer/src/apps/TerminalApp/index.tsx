import React, { useRef, useEffect, useCallback, useState, useMemo, memo } from 'react'
import { Terminal, X, GripVertical } from 'lucide-react'
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

// ── Drop state management via ref + targeted re-renders ──
// Instead of context (which re-renders all consumers), use a simple pub/sub
let _dropTarget: { terminalId: string; zone: DropZone } | null = null
const _dropListeners = new Set<() => void>()

function setGlobalDropTarget(v: { terminalId: string; zone: DropZone } | null) {
  // Skip if same target and zone
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

// Stable selectors — avoid subscribing to entire arrays
const selectShowCommandPalette = (s: { showCommandPalette: boolean }) => s.showCommandPalette
const selectActiveTerminalId = (s: { activeTerminalId: string | null }) => s.activeTerminalId
const selectHasTerminals = (s: { terminalSessions: { id: string }[] }) => s.terminalSessions.length > 0
const selectActiveLayout = (s: {
  terminalWorkspaces: { id: string; groups: { id: string; layout: SplitNode }[]; activeGroupId: string | null }[]
  activeWorkspaceId: string | null
}): SplitNode | null => {
  const ws = s.terminalWorkspaces.find((w) => w.id === s.activeWorkspaceId)
  if (!ws) return null
  const g = ws.groups.find((gr) => gr.id === ws.activeGroupId)
  return g?.layout ?? null
}

export const TerminalApp: React.FC = () => {
  const showCommandPalette = useUIStore(selectShowCommandPalette)
  const activeTerminalId = useUIStore(selectActiveTerminalId)
  const hasTerminals = useUIStore(selectHasTerminals)
  const activeLayout = useUIStore(selectActiveLayout, (a, b) => a === b)

  // ── H3: Keyboard navigation for split panes ──
  // Cmd+Opt+←/→ = prev/next pane, Cmd+Opt+W = close pane
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
        {activeLayout ? (
          <div className="absolute inset-0">
            <SplitTreeRenderer
              node={activeLayout}
              activeTerminalId={activeTerminalId}
            />
          </div>
        ) : (
          <FallbackTerminals activeTerminalId={activeTerminalId} />
        )}

        {!hasTerminals && (
          <div className="flex items-center justify-center h-full text-tx-faint text-sm">
            Open a folder to start
          </div>
        )}
      </div>
    </div>
  )
}

/** Fallback when no layout tree — don't mount invisible xterm instances */
const FallbackTerminals = memo(function FallbackTerminals(_props: { activeTerminalId: string | null }) {
  // No layout = no visible terminals. Don't render hidden xterm instances.
  return null
})

// ── Drop handler (stable, reads from store at call time) ──

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

  // Already in same group → rearrange within the tree
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

  // New terminal → use store action
  state.splitTerminalInWorkspace(activeWorkspace.id, targetTermId, termId, dir)
}

// ── Tree Renderer ──

const SplitTreeRenderer = memo(function SplitTreeRenderer({
  node,
  activeTerminalId,
}: {
  node: SplitNode
  activeTerminalId: string | null
}) {
  if (node.type === 'terminal') {
    return (
      <TerminalLeafMemo
        terminalId={node.terminalId}
        isActive={node.terminalId === activeTerminalId}
      />
    )
  }

  const isVertical = node.direction === 'vertical'
  return (
    <div className={`w-full h-full flex ${isVertical ? 'flex-col' : 'flex-row'}`}>
      {node.children.map((child, idx) => {
        // Stable key: leaf → terminalId, split → first leaf's id (cheaper than full traversal)
        const key = child.type === 'terminal' ? child.terminalId : firstTerminalId(child) ?? idx
        return (
          <React.Fragment key={key}>
            {idx > 0 && <SplitHandle direction={node.direction} />}
            <div className="flex-1 min-w-0 min-h-0">
              <SplitTreeRenderer
                node={child}
                activeTerminalId={activeTerminalId}
              />
            </div>
          </React.Fragment>
        )
      })}
    </div>
  )
})

/** O(depth) — walks left edge only, avoids full tree traversal of collectTerminalIds */
function firstTerminalId(node: SplitNode): string | undefined {
  if (node.type === 'terminal') return node.terminalId
  return node.children.length > 0 ? firstTerminalId(node.children[0]) : undefined
}

// ── Terminal Leaf (with per-pane drop zone) ──

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

const TerminalLeafMemo = memo(function TerminalLeaf({
  terminalId,
  isActive,
}: {
  terminalId: string
  isActive: boolean
}) {
  const paneRef = useRef<HTMLDivElement>(null)
  const myDrop = useDropTargetFor(terminalId)

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
    if (!paneRef.current?.contains(related)) {
      setGlobalDropTarget(null)
    }
  }, [])

  const handleDropEvent = useCallback((e: React.DragEvent) => {
    e.stopPropagation()
    if (paneRef.current) {
      handlePaneDrop(terminalId, calcZoneFromEvent(paneRef.current, e), e)
    }
  }, [terminalId])

  const handleActivate = useCallback(() => {
    useUIStore.getState().setActiveTerminalId(terminalId)
  }, [terminalId])

  const handleClose = useCallback(() => {
    window.api.terminal.close(terminalId)
    useUIStore.getState().removeTerminalSession(terminalId)
  }, [terminalId])

  return (
    <div
      ref={paneRef}
      className="w-full h-full flex flex-col relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDropEvent}
    >
      <PaneTabBarMemo
        terminalId={terminalId}
        isActiveTerminal={isActive}
        onActivate={handleActivate}
        onClose={handleClose}
      />
      <div className="flex-1 relative min-h-0">
        <TerminalPaneMemo
          terminalId={terminalId}
          isActive={isActive}
          isVisible
        />
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
      className={`shrink-0 flex items-center gap-1.5 px-2 h-[28px] text-[11px] border-b cursor-pointer group select-none
        ${isActiveTerminal ? 'bg-bg-active border-accent-main/30' : 'bg-bg-sidebar border-border-subtle hover:bg-bg-hover'}`}
      onClick={onActivate}
    >
      <div
        draggable
        onDragStart={handleDragStart}
        className="cursor-grab active:cursor-grabbing text-tx-faint hover:text-tx-muted p-0.5 -ml-0.5"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical size={10} />
      </div>
      <Terminal size={11} className={isActiveTerminal ? 'text-accent-main' : 'text-tx-faint'} />
      <span className={`truncate ${isActiveTerminal ? 'text-accent-main font-medium' : 'text-tx-muted'}`}>{title}</span>
      <div className="ml-auto flex items-center gap-1">
        {isActiveTerminal && <div className="w-1.5 h-1.5 rounded-full bg-accent-main" title="Active" />}
        <button
          onClick={(e) => { e.stopPropagation(); onClose() }}
          className="p-0.5 text-tx-faint hover:text-tx-main opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Close terminal"
        >
          <X size={11} />
        </button>
      </div>
    </div>
  )
})

// ── Split Handle ──

const SplitHandle = memo(function SplitHandle({ direction }: { direction: 'horizontal' | 'vertical' }) {
  const isVertical = direction === 'vertical'
  return (
    <div
      className={`shrink-0
        ${isVertical
          ? 'h-px w-full bg-border-subtle cursor-row-resize hover:bg-border-strong'
          : 'w-px h-full bg-border-subtle cursor-col-resize hover:bg-border-strong'
        }`}
      style={{ zIndex: 5 }}
    />
  )
})

// ── Terminal Pane ──

const TerminalPaneMemo = memo(function TerminalPane({
  terminalId,
  isActive,
  isVisible,
  initialBuffer,
}: {
  terminalId: string
  initialBuffer?: string
  isActive: boolean
  isVisible: boolean
}) {
  const ref = useRef<TerminalViewHandle | null>(null)

  useEffect(() => {
    terminalRefs.set(terminalId, ref)
    return () => { terminalRefs.delete(terminalId) }
  }, [terminalId])

  // Auto-focus xterm when terminal becomes active
  useEffect(() => {
    if (isActive && isVisible) {
      // Small delay to ensure xterm canvas is ready
      const id = requestAnimationFrame(() => ref.current?.focus())
      return () => cancelAnimationFrame(id)
    }
  }, [isActive, isVisible])

  const style: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    visibility: isVisible ? 'visible' : 'hidden',
    zIndex: isVisible ? 1 : 0,
  }

  const handleClick = useCallback(() => ref.current?.focus(), [])

  return (
    <div style={style} onClick={handleClick}>
      <TerminalView ref={ref} terminalId={terminalId} initialBuffer={initialBuffer} />
    </div>
  )
})
