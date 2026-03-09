import React, { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'

export interface ContextMenuItem {
  label: string
  icon?: React.ReactNode
  danger?: boolean
  disabled?: boolean
  separator?: boolean
  onClick: () => void
}

interface ContextMenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

let globalShow: ((state: ContextMenuState) => void) | null = null
let globalHide: (() => void) | null = null

/** Imperatively show context menu from anywhere */
export function showContextMenu(x: number, y: number, items: ContextMenuItem[]): void {
  globalShow?.({ x, y, items })
}

/** Hook for use in onContextMenu handlers */
export function useContextMenu() {
  return useCallback((e: React.MouseEvent, items: ContextMenuItem[]) => {
    e.preventDefault()
    e.stopPropagation()
    showContextMenu(e.clientX, e.clientY, items)
  }, [])
}

/** Mount this once at root level */
export const ContextMenuProvider: React.FC = () => {
  const [state, setState] = useState<ContextMenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    globalShow = setState
    globalHide = () => setState(null)
    return () => {
      globalShow = null
      globalHide = null
    }
  }, [])

  // Close on click outside or escape
  useEffect(() => {
    if (!state) return
    const handleClick = () => setState(null)
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setState(null)
    }
    window.addEventListener('mousedown', handleClick)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('mousedown', handleClick)
      window.removeEventListener('keydown', handleKey)
    }
  }, [state])

  // Reposition if off-screen
  useEffect(() => {
    if (!state || !menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    let { x, y } = state
    let changed = false
    if (rect.right > window.innerWidth) { x = window.innerWidth - rect.width - 4; changed = true }
    if (rect.bottom > window.innerHeight) { y = window.innerHeight - rect.height - 4; changed = true }
    if (changed) setState({ ...state, x, y })
  }, [state?.items])

  if (!state) return null

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[160px] py-1 bg-bg-sidebar border border-border-subtle rounded-lg shadow-xl"
      style={{ left: state.x, top: state.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {state.items.map((item, i) => {
        if (item.separator) {
          return <div key={i} className="my-1 border-t border-border-subtle" />
        }
        return (
          <button
            key={i}
            disabled={item.disabled}
            onClick={() => {
              setState(null)
              item.onClick()
            }}
            className={`w-full px-3 py-[5px] text-[13px] text-left flex items-center gap-2 transition-colors
              ${item.disabled ? 'text-tx-faint cursor-default' : ''}
              ${item.danger && !item.disabled ? 'text-red-400 hover:bg-red-500/10' : ''}
              ${!item.danger && !item.disabled ? 'text-tx-main hover:bg-bg-hover' : ''}`}
          >
            {item.icon && <span className="w-4 h-4 flex items-center justify-center shrink-0">{item.icon}</span>}
            <span>{item.label}</span>
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
