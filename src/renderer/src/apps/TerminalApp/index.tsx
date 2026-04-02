import React, { useRef, useEffect, useCallback, useState } from 'react'
import { Terminal, X } from 'lucide-react'
import { useUIStore } from '../../store/useUIStore'
import { TerminalView } from './TerminalView'
import type { TerminalViewHandle } from './TerminalView'

/** Global registry so the before-unload handler can serialize all terminals */
const terminalRefs = new Map<string, React.RefObject<TerminalViewHandle | null>>()

export function getTerminalRefs(): Map<string, React.RefObject<TerminalViewHandle | null>> {
  return terminalRefs
}

export const TerminalApp: React.FC = () => {
  const showCommandPalette = useUIStore((s) => s.showCommandPalette)
  const activeTerminalId = useUIStore((s) => s.activeTerminalId)
  const terminalSessions = useUIStore((s) => s.terminalSessions)
  const terminalWorkspaces = useUIStore((s) => s.terminalWorkspaces)
  const activeWorkspaceId = useUIStore((s) => s.activeWorkspaceId)
  const setActiveTerminalId = useUIStore((s) => s.setActiveTerminalId)
  const splitTerminalInWorkspace = useUIStore((s) => s.splitTerminalInWorkspace)
  const [dropSide, setDropSide] = useState<'left' | 'right' | null>(null)

  // Find active workspace and its active group
  const activeWorkspace = terminalWorkspaces.find((ws) => ws.id === activeWorkspaceId)
  const activeGroup = activeWorkspace?.groups.find((g) => g.id === activeWorkspace.activeGroupId)
  const activeGroupTerminalIds = activeGroup?.terminalIds ?? []

  const blurClass = showCommandPalette
    ? 'opacity-50 transition-opacity duration-200'
    : 'transition-opacity duration-200'

  const handleMainDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-terminal-drag')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const midX = rect.left + rect.width / 2
    setDropSide(e.clientX < midX ? 'left' : 'right')
  }, [])

  const handleMainDragLeave = useCallback(() => setDropSide(null), [])

  const handleMainDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDropSide(null)
    const raw = e.dataTransfer.getData('application/x-terminal-drag')
    if (!raw || !activeWorkspace || !activeTerminalId) return
    const { termId } = JSON.parse(raw) as { termId: string; workspaceId: string }
    if (termId === activeTerminalId) return
    splitTerminalInWorkspace(activeWorkspace.id, activeTerminalId, termId)
  }, [activeWorkspace, activeTerminalId, splitTerminalInWorkspace])

  return (
    <div className={`flex-1 flex flex-col overflow-hidden ${blurClass}`}>
      <div className="flex-1 overflow-hidden relative"
        onDragOver={handleMainDragOver} onDragLeave={handleMainDragLeave} onDrop={handleMainDrop}>
        {/* Render all terminals (always mounted for PTY persistence) */}
        {terminalSessions.map((session) => {
          const inActiveGroup = activeGroupTerminalIds.includes(session.id)
          return (
            <TerminalPane
              key={session.id}
              terminalId={session.id}
              initialBuffer={session._restoredBuffer}
              isActive={session.id === activeTerminalId}
              isVisible={inActiveGroup}
              activeGroupTerminalIds={activeGroupTerminalIds}
            />
          )
        })}

        {/* Tab bar + split pane overlays */}
        {activeGroupTerminalIds.length > 0 && (
          <div className="absolute inset-0 flex z-10 pointer-events-none">
            {activeGroupTerminalIds.map((tid, idx) => (
              <React.Fragment key={tid}>
                {idx > 0 && <SplitHandle />}
                <SplitPaneOverlay
                  terminalId={tid}
                  isActiveTerminal={tid === activeTerminalId}
                  onActivate={() => setActiveTerminalId(tid)}
                  onClose={() => {
                    window.api.terminal.close(tid)
                    useUIStore.getState().removeTerminalSession(tid)
                  }}
                />
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Drop preview overlay */}
        {dropSide && (
          <div className="absolute inset-0 z-50 flex pointer-events-none">
            <div className={`flex-1 transition-colors ${dropSide === 'left' ? 'bg-accent-main/10 border-2 border-dashed border-accent-main/40 rounded-md m-1' : ''}`} />
            <div className={`flex-1 transition-colors ${dropSide === 'right' ? 'bg-accent-main/10 border-2 border-dashed border-accent-main/40 rounded-md m-1' : ''}`} />
          </div>
        )}

        {terminalSessions.length === 0 && (
          <div className="flex items-center justify-center h-full text-tx-faint text-sm">
            Open a folder to start
          </div>
        )}
      </div>
    </div>
  )
}

/** Split pane overlay — only the tab bar captures events, terminal area is transparent */
function SplitPaneOverlay({
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
  const session = useUIStore((s) => s.terminalSessions.find((t) => t.id === terminalId))
  const title = session?.title || 'Terminal'

  return (
    <div className="flex-1 flex flex-col pointer-events-none">
      {/* Tab bar — only this captures events */}
      <div
        className={`shrink-0 flex items-center gap-2 px-3 h-[28px] text-[11px] border-b pointer-events-auto cursor-pointer group
          ${isActiveTerminal ? 'bg-bg-active border-accent-main/30' : 'bg-bg-sidebar border-border-subtle hover:bg-bg-hover'}`}
        onClick={onActivate}
      >
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
      {/* Terminal area — fully transparent to let xterm receive all events */}
      <div className="flex-1" />
    </div>
  )
}

/** 1px resize handle between split panes */
function SplitHandle() {
  return (
    <div
      className="w-px bg-border-subtle shrink-0 pointer-events-auto cursor-col-resize hover:bg-border-strong transition-colors"
      style={{ zIndex: 20 }}
    />
  )
}

/** Individual terminal pane — always mounted, visibility toggled */
function TerminalPane({
  terminalId,
  initialBuffer,
  isActive,
  isVisible,
  activeGroupTerminalIds,
}: {
  terminalId: string
  initialBuffer?: string
  isActive: boolean
  isVisible: boolean
  activeGroupTerminalIds: string[]
}) {
  const ref = useRef<TerminalViewHandle | null>(null)

  // Determine layout position within the group for split rendering
  const isSplit = isVisible && activeGroupTerminalIds.length > 1
  const splitIndex = isSplit ? activeGroupTerminalIds.indexOf(terminalId) : -1
  const splitCount = isSplit ? activeGroupTerminalIds.length : 1

  useEffect(() => {
    terminalRefs.set(terminalId, ref)
    return () => {
      terminalRefs.delete(terminalId)
    }
  }, [terminalId])

  // For split view: position each terminal in its fraction of the container
  const style: React.CSSProperties = isSplit
    ? {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: `${(splitIndex / splitCount) * 100}%`,
        width: `${(1 / splitCount) * 100}%`,
        visibility: 'visible',
        zIndex: 1,
      }
    : {
        position: 'absolute',
        inset: 0,
        visibility: isVisible ? 'visible' : 'hidden',
        zIndex: isVisible ? 1 : 0,
      }

  return (
    <div style={style}>
      <TerminalView ref={ref} terminalId={terminalId} initialBuffer={initialBuffer} />
    </div>
  )
}
