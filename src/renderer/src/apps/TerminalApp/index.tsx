import React, { useRef, useEffect, useCallback } from 'react'
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

  // Find active workspace and its active group
  const activeWorkspace = terminalWorkspaces.find((ws) => ws.id === activeWorkspaceId)
  const activeGroup = activeWorkspace?.groups.find((g) => g.id === activeWorkspace.activeGroupId)
  const activeGroupTerminalIds = activeGroup?.terminalIds ?? []

  const blurClass = showCommandPalette
    ? 'opacity-50 transition-opacity duration-200'
    : 'transition-opacity duration-200'

  return (
    <div className={`flex-1 flex flex-col overflow-hidden ${blurClass}`}>
      <div className="flex-1 overflow-hidden bg-bg-app p-1 relative">
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

        {/* Split-pane overlay: renders the split layout on top */}
        {activeGroupTerminalIds.length > 1 && (
          <div className="absolute inset-0 flex z-10 pointer-events-none">
            {activeGroupTerminalIds.map((tid, idx) => (
              <React.Fragment key={tid}>
                {idx > 0 && <SplitHandle />}
                <SplitPaneOverlay
                  terminalId={tid}
                  isActiveTerminal={tid === activeTerminalId}
                  onActivate={() => setActiveTerminalId(tid)}
                />
              </React.Fragment>
            ))}
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

/** Clickable overlay for each split pane to handle activation and border highlight */
function SplitPaneOverlay({
  terminalId,
  isActiveTerminal,
  onActivate,
}: {
  terminalId: string
  isActiveTerminal: boolean
  onActivate: () => void
}) {
  return (
    <div
      className="flex-1 relative pointer-events-auto"
      style={{
        borderTop: isActiveTerminal ? '2px solid var(--accent-main)' : '2px solid transparent',
      }}
      onClick={onActivate}
    >
      {/* This div just captures clicks; the actual terminal renders underneath */}
      <div className="absolute inset-0" style={{ pointerEvents: 'none' }} />
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
