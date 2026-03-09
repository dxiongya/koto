import React from 'react'
import { useUIStore } from '../../store/useUIStore'
import { TerminalView } from './TerminalView'

export const TerminalApp: React.FC = () => {
  const showCommandPalette = useUIStore((s) => s.showCommandPalette)
  const activeTerminalId = useUIStore((s) => s.activeTerminalId)

  const blurClass = showCommandPalette
    ? 'filter blur-[3px] opacity-50 transition-all duration-300'
    : 'transition-all duration-300'

  return (
    <div className={`flex-1 flex flex-col overflow-hidden ${blurClass}`}>
      <div className="flex-1 overflow-hidden bg-bg-app p-1">
        {activeTerminalId ? (
          <TerminalView key={activeTerminalId} terminalId={activeTerminalId} />
        ) : (
          <div className="flex items-center justify-center h-full text-tx-faint text-sm">
            Create a terminal from the sidebar
          </div>
        )}
      </div>
    </div>
  )
}
