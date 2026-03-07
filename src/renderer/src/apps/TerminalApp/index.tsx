import React, { useCallback, useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useUIStore } from '../../store/useUIStore'
import { TerminalView } from './TerminalView'

interface TerminalTab {
  id: string
  title: string
}

export const TerminalApp: React.FC = () => {
  const showCommandPalette = useUIStore((s) => s.showCommandPalette)
  const workspacePath = useUIStore((s) => s.workspacePath)
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)

  // Create first terminal on mount
  useEffect(() => {
    if (tabs.length === 0) {
      createTab()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const createTab = useCallback(async () => {
    const res = await window.api.terminal.create(workspacePath ?? undefined)
    if (res.ok) {
      const newTab: TerminalTab = {
        id: res.data,
        title: `Terminal ${tabs.length + 1}`,
      }
      setTabs((prev) => [...prev, newTab])
      setActiveTabId(res.data)
    }
  }, [workspacePath, tabs.length])

  const closeTab = useCallback(
    (tabId: string) => {
      window.api.terminal.close(tabId)
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== tabId)
        if (activeTabId === tabId) {
          setActiveTabId(next.length > 0 ? next[next.length - 1].id : null)
        }
        return next
      })
    },
    [activeTabId],
  )

  const blurClass = showCommandPalette
    ? 'filter blur-[3px] opacity-50 transition-all duration-300'
    : 'transition-all duration-300'

  return (
    <div className={`flex-1 flex flex-col overflow-hidden ${blurClass}`}>
      {/* Tab bar */}
      <div className="flex items-center bg-[#161616] border-b border-white/8 shrink-0">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => setActiveTabId(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 text-[13px] cursor-pointer border-r border-white/5
              ${activeTabId === tab.id ? 'bg-[#111111] text-white' : 'text-[#888] hover:text-[#ccc]'}`}
          >
            <span>{tab.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.id)
              }}
              className="opacity-0 group-hover:opacity-100 hover:text-white transition-opacity p-0.5"
              style={{ opacity: activeTabId === tab.id ? 0.5 : 0 }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button
          onClick={createTab}
          className="p-2 text-[#666] hover:text-[#ccc] transition-colors"
          title="New Terminal"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Terminal content */}
      <div className="flex-1 overflow-hidden bg-[#111111] p-1">
        {activeTabId ? (
          <TerminalView key={activeTabId} terminalId={activeTabId} />
        ) : (
          <div className="flex items-center justify-center h-full text-[#555] text-sm">
            No terminal open
          </div>
        )}
      </div>
    </div>
  )
}
