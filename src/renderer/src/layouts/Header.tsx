import React from 'react'
import { PanelLeft } from 'lucide-react'
import { useUIStore } from '../store/useUIStore'

export const Header: React.FC = () => {
  const currentApp = useUIStore((s) => s.currentApp)
  const activeFilePath = useUIStore((s) => s.activeFilePath)
  const workspacePath = useUIStore((s) => s.workspacePath)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)

  // Build breadcrumb from active file path relative to workspace
  const breadcrumb: string[] = [currentApp]
  if (activeFilePath && workspacePath) {
    const rel = activeFilePath.startsWith(workspacePath)
      ? activeFilePath.slice(workspacePath.length + 1)
      : activeFilePath
    breadcrumb.push(...rel.split('/'))
  } else if (activeFilePath) {
    breadcrumb.push(...activeFilePath.split('/').filter(Boolean).slice(-4))
  }

  return (
    <div
      className={`h-12 flex items-center px-6 shrink-0 bg-transparent text-[13px] text-tx-muted transition-all ${
        !sidebarOpen ? 'pl-[80px]' : ''
      }`}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div 
        className="flex items-center gap-2 mr-4"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded-md hover:bg-bg-hover text-tx-faint hover:text-tx-main transition-colors shrink-0"
          title="Toggle Sidebar"
        >
          <PanelLeft size={16} strokeWidth={1.5} />
        </button>
      </div>

      <div className="flex-1 flex items-center gap-2 truncate font-mono">
        {breadcrumb.length > 0 ? (
          breadcrumb.map((seg, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="opacity-40">/</span>}
              <span className={i === breadcrumb.length - 1 ? 'text-tx-main' : ''}>{seg}</span>
            </React.Fragment>
          ))
        ) : (
          <span className="opacity-0">.</span>
        )}
      </div>
    </div>
  )
}
