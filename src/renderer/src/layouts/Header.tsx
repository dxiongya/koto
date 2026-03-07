import React from 'react'
import { useUIStore } from '../store/useUIStore'

export const Header: React.FC = () => {
  const currentApp = useUIStore((s) => s.currentApp)
  const activeFilePath = useUIStore((s) => s.activeFilePath)
  const workspacePath = useUIStore((s) => s.workspacePath)

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
      className="h-12 flex items-center px-6 shrink-0 bg-transparent text-[13px] text-[#8b8b8b]"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex-1 flex items-center gap-2 truncate font-mono">
        {breadcrumb.length > 0 ? (
          breadcrumb.map((seg, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="opacity-40">/</span>}
              <span className={i === breadcrumb.length - 1 ? 'text-[#e5e5e5]' : ''}>{seg}</span>
            </React.Fragment>
          ))
        ) : (
          <span className="opacity-0">.</span>
        )}
      </div>
    </div>
  )
}
