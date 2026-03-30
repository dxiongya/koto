import React from 'react'
import { PanelLeft } from 'lucide-react'
import { useUIStore } from '../store/useUIStore'

export const Header: React.FC = () => {
  const currentApp = useUIStore((s) => s.currentApp)
  const activeFilePath = useUIStore((s) => s.getActiveFilePath())
  const liteHome = useUIStore((s) => s.liteHome)
  const codeProjectPath = useUIStore((s) => s.codeProjectPath)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)

  // Build breadcrumb relative to the appropriate root
  const breadcrumb: string[] = [currentApp]
  if (activeFilePath) {
    let rel = activeFilePath
    // Strip liteHome prefix for notes/collector/browser
    if (liteHome && activeFilePath.startsWith(liteHome)) {
      rel = activeFilePath.slice(liteHome.length + 1)
    }
    // Strip project prefix for code.app
    else if (codeProjectPath && activeFilePath.startsWith(codeProjectPath)) {
      rel = activeFilePath.slice(codeProjectPath.length + 1)
    }
    breadcrumb.push(...rel.split('/').filter(Boolean))
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
          className="p-1.5 rounded-md hover:bg-bg-hover text-tx-faint hover:text-tx-main transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-main/50"
          aria-label="Toggle sidebar"
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
