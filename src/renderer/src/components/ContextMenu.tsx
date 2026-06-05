import React, { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'

export interface ContextMenuItem {
  label: string
  icon?: React.ReactNode
  danger?: boolean
  disabled?: boolean
  separator?: boolean
  onClick: () => void
  /**
   * When present, this entry renders as a single horizontal row of color
   * swatches instead of a normal label-button. Keeps long color pickers
   * (8+ entries) from blowing up the menu vertically. The row's leftmost
   * cell is a "clear" / "default" slot when `onClear` is set.
   */
  swatches?: {
    label?: string
    colors: { name: string; value: string }[]
    selected?: string
    onPick: (value: string) => void
    onClear?: () => void
  }
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

/** Imperatively hide context menu from anywhere */
export function hideContextMenu(): void {
  globalHide?.()
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
      role="menu"
      className="fixed z-[9999] min-w-[160px] py-1 bg-bg-sidebar border border-border-subtle rounded-lg shadow-xl"
      style={{ left: state.x, top: state.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {state.items.map((item, i) => {
        if (item.separator) {
          return <div key={i} role="separator" className="my-1 border-t border-border-subtle" />
        }
        if (item.swatches) {
          const sw = item.swatches
          return (
            <div key={i} className="px-3 py-1.5">
              {sw.label && (
                <div className="text-[10px] text-tx-faint uppercase tracking-wider mb-1.5">{sw.label}</div>
              )}
              <div className="flex items-center gap-1.5">
                {sw.onClear && (
                  <button
                    type="button"
                    title="Default"
                    aria-label="Reset color"
                    onClick={() => { setState(null); sw.onClear!() }}
                    disabled={!sw.selected}
                    className="w-5 h-5 rounded-full border border-tx-faint/40 flex items-center justify-center text-tx-faint hover:text-tx-main hover:border-tx-main disabled:opacity-40 disabled:cursor-default transition-colors"
                  >
                    {/* slash indicates "no color set" */}
                    <span className="block w-3 h-px rotate-45 bg-current" />
                  </button>
                )}
                {sw.colors.map((c) => {
                  const isSelected = sw.selected === c.value
                  return (
                    <button
                      key={c.value}
                      type="button"
                      title={c.name}
                      aria-label={c.name}
                      onClick={() => { setState(null); sw.onPick(c.value) }}
                      // Outline ring when selected; subtle scale on hover.
                      // Border-on-color helps light swatches stand out on
                      // the dark menu surface without adding noise.
                      className={`w-5 h-5 rounded-full transition-transform hover:scale-110
                        ${isSelected ? 'ring-2 ring-offset-2 ring-offset-bg-sidebar ring-tx-main' : 'ring-1 ring-black/30'}`}
                      style={{ backgroundColor: c.value }}
                    />
                  )
                })}
              </div>
            </div>
          )
        }
        return (
          <button
            key={i}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              setState(null)
              item.onClick()
            }}
            // Hover/focus: full accent fill + bg-app text (max contrast against
            // teal). Matches VSCode/macOS native menus where the hovered row
            // visibly inverts. Plain `bg-bg-hover` was too close to the menu
            // surface (bg-bg-sidebar) to read as a state change.
            className={`w-full px-3 py-[5px] text-[13px] text-left flex items-center gap-2 transition-colors
              focus-visible:outline-none
              ${item.disabled ? 'text-tx-faint cursor-default' : ''}
              ${item.danger && !item.disabled ? 'text-status-error hover:bg-status-error hover:text-white focus-visible:bg-status-error focus-visible:text-white' : ''}
              ${!item.danger && !item.disabled ? 'text-tx-main hover:bg-accent-main hover:text-bg-app focus-visible:bg-accent-main focus-visible:text-bg-app' : ''}`}
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
