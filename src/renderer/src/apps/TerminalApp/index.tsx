import React, { useRef, useEffect } from 'react'
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

  const blurClass = showCommandPalette
    ? 'opacity-50 transition-opacity duration-200'
    : 'transition-opacity duration-200'

  return (
    <div className={`flex-1 flex flex-col overflow-hidden ${blurClass}`}>
      <div className="flex-1 overflow-hidden bg-bg-app p-1 relative">
        {terminalSessions.map((session) => (
          <TerminalPane
            key={session.id}
            terminalId={session.id}
            initialBuffer={session._restoredBuffer}
            isActive={session.id === activeTerminalId}
          />
        ))}
        {terminalSessions.length === 0 && (
          <div className="flex items-center justify-center h-full text-tx-faint text-sm">
            Create a terminal from the sidebar
          </div>
        )}
      </div>
    </div>
  )
}

/** Individual terminal pane — always mounted, visibility toggled */
function TerminalPane({
  terminalId,
  initialBuffer,
  isActive,
}: {
  terminalId: string
  initialBuffer?: string
  isActive: boolean
}) {
  const ref = useRef<TerminalViewHandle | null>(null)

  useEffect(() => {
    terminalRefs.set(terminalId, ref)
    return () => {
      terminalRefs.delete(terminalId)
    }
  }, [terminalId])

  return (
    <div
      className="absolute inset-0"
      style={{ visibility: isActive ? 'visible' : 'hidden', zIndex: isActive ? 1 : 0 }}
    >
      <TerminalView ref={ref} terminalId={terminalId} initialBuffer={initialBuffer} />
    </div>
  )
}
