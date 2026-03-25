import { useCallback, useRef, useEffect, type JSX } from 'react'

interface ResizeHandleProps {
  /** 'left' = drag resizes from left edge, 'right' = from right edge */
  side: 'left' | 'right'
  /** Current width in px */
  width: number
  /** Called with new width while dragging */
  onResize: (width: number) => void
  /** Optional min/max */
  minWidth?: number
  maxWidth?: number
  /** Optional callback when drag ends */
  onResizeEnd?: (width: number) => void
}

/**
 * Invisible drag handle rendered on a panel edge.
 * Shows a subtle highlight on hover / drag.
 */
export function ResizeHandle({
  side,
  width,
  onResize,
  minWidth = 120,
  maxWidth = 500,
  onResizeEnd,
}: ResizeHandleProps): JSX.Element {
  const dragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)
  const handleRef = useRef<HTMLDivElement>(null)
  const widthRef = useRef(width)
  widthRef.current = width

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragging.current = true
      startX.current = e.clientX
      startWidth.current = widthRef.current
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      handleRef.current?.classList.add('resize-handle-active')
    },
    [],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 20 : 4
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onResize(Math.max(minWidth, Math.min(maxWidth, width - step)))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        onResize(Math.max(minWidth, Math.min(maxWidth, width + step)))
      }
    },
    [width, minWidth, maxWidth, onResize],
  )

  useEffect(() => {
    const onMouseMove = (e: MouseEvent): void => {
      if (!dragging.current) return
      const delta = side === 'right'
        ? startX.current - e.clientX
        : e.clientX - startX.current
      const next = Math.round(Math.min(maxWidth, Math.max(minWidth, startWidth.current + delta)))
      onResize(next)
    }

    const onMouseUp = (): void => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      handleRef.current?.classList.remove('resize-handle-active')
      onResizeEnd?.(startWidth.current)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [side, minWidth, maxWidth, onResize, onResizeEnd])

  return (
    <div
      ref={handleRef}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-label="Resize panel"
      tabIndex={0}
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
      className={`resize-handle ${side === 'left' ? 'resize-handle-left' : 'resize-handle-right'} focus-visible:bg-accent-main/30`}
    />
  )
}
