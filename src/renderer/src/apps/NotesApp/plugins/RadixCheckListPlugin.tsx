import { useEffect, useRef, useState, useCallback, type JSX } from 'react'
import { createPortal } from 'react-dom'
import * as Checkbox from '@radix-ui/react-checkbox'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getNearestNodeFromDOMNode } from 'lexical'
import { $isListItemNode, ListItemNode } from '@lexical/list'

const ITEM_SELECTOR = '.editor-checklist .editor-listitem'
const CB_SIZE = 18

interface CheckItem {
  key: string
  checked: boolean
  top: number
  height: number
  left: number
}

function CheckboxButton({
  item,
  onToggle,
  disabled
}: {
  item: CheckItem
  onToggle: (key: string) => void
  disabled: boolean
}): JSX.Element {
  return (
    <Checkbox.Root
      checked={item.checked}
      disabled={disabled}
      className="w-[18px] h-[18px] rounded border border-border-strong flex items-center justify-center bg-bg-app transition-colors data-[state=checked]:bg-accent-main data-[state=checked]:border-accent-main hover:border-accent-main/50"
      style={{
        position: 'absolute',
        left: item.left,
        top: item.top + Math.round((item.height - CB_SIZE) / 2)
      }}
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onToggle(item.key)
      }}
    >
      <Checkbox.Indicator>
        <svg viewBox="0 0 16 16" fill="none" width={12} height={12}>
          <path
            d="M3 8.5l3.2 3.3 6.8-7"
            stroke="var(--color-bg-app)"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Checkbox.Indicator>
    </Checkbox.Root>
  )
}

function getOffsetRelativeTo(
  el: HTMLElement,
  ancestor: HTMLElement
): { top: number; left: number } {
  let top = 0
  let left = 0
  let cur: HTMLElement | null = el
  while (cur && cur !== ancestor) {
    top += cur.offsetTop
    left += cur.offsetLeft
    cur = cur.offsetParent as HTMLElement | null
  }
  return { top, left }
}

export function RadixCheckListPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const [items, setItems] = useState<CheckItem[]>([])
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const liMapRef = useRef<Map<string, HTMLElement>>(new Map())

  const syncPositions = useCallback((): void => {
    const rootEl = editor.getRootElement()
    const overlay = overlayRef.current
    if (!rootEl || !overlay) return

    const editorContainer = overlay.parentElement
    if (!editorContainer) return

    const domItems = rootEl.querySelectorAll<HTMLElement>(ITEM_SELECTOR)
    const next: CheckItem[] = []
    const newMap = new Map<string, HTMLElement>()

    domItems.forEach((li, idx) => {
      li.classList.add('has-radix-cb')

      const { top, left } = getOffsetRelativeTo(li, editorContainer)
      const height = li.offsetHeight

      const checked =
        li.getAttribute('aria-checked') === 'true' ||
        li.classList.contains('editor-listitem-checked')

      const key = String(idx)
      newMap.set(key, li)
      next.push({ key, checked, top, height, left })
    })

    liMapRef.current = newMap
    setItems(next)
  }, [editor])

  const scheduleSync = useCallback((): void => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      syncPositions()
    })
  }, [syncPositions])

  useEffect(() => {
    const rootEl = editor.getRootElement()
    if (!rootEl) return
    const editorContainer = rootEl.parentElement
    if (!editorContainer) return

    const prev = editorContainer.style.position
    if (!prev || prev === 'static') {
      editorContainer.style.position = 'relative'
    }

    const overlay = document.createElement('div')
    overlay.className = 'radix-cb-overlay'
    overlay.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:5;'
    editorContainer.appendChild(overlay)
    overlayRef.current = overlay

    // Make children interactive
    const style = document.createElement('style')
    style.textContent = '.radix-cb-overlay > * { pointer-events: auto; }'
    overlay.appendChild(style)

    scheduleSync()

    const ro = new ResizeObserver(scheduleSync)
    ro.observe(editorContainer)

    return () => {
      ro.disconnect()
      overlay.remove()
      overlayRef.current = null
      if (!prev || prev === 'static') {
        editorContainer.style.position = prev
      }
    }
  }, [editor, scheduleSync])

  useEffect(() => {
    const removeMutation = editor.registerMutationListener(
      ListItemNode,
      scheduleSync,
      { skipInitialization: false }
    )
    const removeUpdate = editor.registerUpdateListener(scheduleSync)
    const removeEditable = editor.registerEditableListener(scheduleSync)

    return () => {
      removeMutation()
      removeUpdate()
      removeEditable()
    }
  }, [editor, scheduleSync])

  const handleToggle = useCallback(
    (key: string): void => {
      const li = liMapRef.current.get(key)
      if (!li) return
      editor.update(() => {
        const node = $getNearestNodeFromDOMNode(li)
        if ($isListItemNode(node)) {
          node.setChecked(node.getChecked() !== true)
        }
      })
    },
    [editor]
  )

  if (!overlayRef.current || items.length === 0) return null

  return createPortal(
    <>
      {items.map((item) => (
        <CheckboxButton
          key={item.key}
          item={item}
          disabled={!editor.isEditable()}
          onToggle={handleToggle}
        />
      ))}
    </>,
    overlayRef.current
  )
}
