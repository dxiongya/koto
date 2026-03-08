/**
 * ImageNode — Block-level image display (DecoratorNode).
 * Uses lite-asset://images/{filename} protocol URLs.
 */
import {
  DecoratorNode,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
  $applyNodeReplacement,
  $getNodeByKey,
  $createParagraphNode,
  COMMAND_PRIORITY_LOW,
  CLICK_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND
} from 'lexical'
import { useState, useRef, useEffect, type JSX } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection'
import { mergeRegister } from '@lexical/utils'
import { AlignLeft, AlignCenter, AlignRight } from 'lucide-react'

export type ImageAlignment = 'left' | 'center' | 'right'

export interface ImagePayload {
  src: string
  alt?: string
  width?: number | 'inherit'
  height?: number | 'inherit'
  alignment?: ImageAlignment
}

export type SerializedImageNode = Spread<
  {
    src: string
    alt: string
    width?: number | 'inherit'
    height?: number | 'inherit'
    alignment?: ImageAlignment
  },
  SerializedLexicalNode
>

export class ImageNode extends DecoratorNode<JSX.Element | null> {
  __src: string
  __alt: string
  __width?: number | 'inherit'
  __height?: number | 'inherit'
  __alignment?: ImageAlignment

  static getType(): string {
    return 'image'
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(
      node.__src,
      node.__alt,
      node.__width,
      node.__height,
      node.__alignment,
      node.__key
    )
  }

  constructor(
    src: string,
    alt?: string,
    width?: number | 'inherit',
    height?: number | 'inherit',
    alignment?: ImageAlignment,
    key?: NodeKey
  ) {
    super(key)
    this.__src = src
    this.__alt = alt ?? ''
    this.__width = width ?? 'inherit'
    this.__height = height ?? 'inherit'
    this.__alignment = alignment ?? 'center'
  }

  exportJSON(): SerializedImageNode {
    return {
      type: 'image',
      version: 1,
      src: this.__src,
      alt: this.__alt,
      width: this.__width,
      height: this.__height,
      alignment: this.__alignment
    }
  }

  static importJSON(json: SerializedImageNode): ImageNode {
    return new ImageNode(json.src, json.alt, json.width, json.height, json.alignment)
  }

  setWidthAndHeight(width: 'inherit' | number, height: 'inherit' | number): void {
    const writable = this.getWritable()
    writable.__width = width
    writable.__height = height
  }

  setAlignment(alignment: ImageAlignment): void {
    const writable = this.getWritable()
    writable.__alignment = alignment
  }

  setAlt(alt: string): void {
    const writable = this.getWritable()
    writable.__alt = alt
  }

  isInline(): boolean {
    return false
  }

  createDOM(config: EditorConfig): HTMLElement {
    const div = document.createElement('div')
    div.style.display = 'block'
    div.style.width = '100%'
    const theme = config.theme
    const className = theme.image
    if (className !== undefined) {
      div.className = className
    }
    return div
  }

  updateDOM(): boolean {
    return false
  }

  decorate(_editor: LexicalEditor, _config: EditorConfig): JSX.Element {
    return (
      <ImageComponent
        src={this.__src}
        alt={this.__alt}
        width={this.__width}
        height={this.__height}
        alignment={this.__alignment}
        nodeKey={this.getKey()}
      />
    )
  }
}

// ── UI Component ─────────────────────────────────────────────────────────────

const MIN_WIDTH = 100

function ImageComponent({
  src,
  alt,
  width,
  height,
  alignment,
  nodeKey
}: {
  src: string
  alt: string
  width?: number | 'inherit'
  height?: number | 'inherit'
  alignment?: ImageAlignment
  nodeKey: NodeKey
}) {
  const [editor] = useLexicalComposerContext()
  const imageRef = useRef<HTMLImageElement>(null)
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey)
  const [isResizing, setIsResizing] = useState(false)
  const [altText, setAltText] = useState(alt)

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand<MouseEvent>(
        CLICK_COMMAND,
        (payload) => {
          if (payload.target === imageRef.current) {
            if (payload.shiftKey) {
              setSelected(!isSelected)
            } else {
              clearSelection()
              setSelected(true)
            }
            return true
          }
          return false
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(
        KEY_DELETE_COMMAND,
        (payload) => {
          if (isSelected) {
            editor.update(() => {
              const node = $getNodeByKey(nodeKey)
              if (node) node.remove()
            })
            payload.preventDefault()
            return true
          }
          return false
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        (payload) => {
          if (isSelected) {
            editor.update(() => {
              const node = $getNodeByKey(nodeKey)
              if (node) node.remove()
            })
            payload.preventDefault()
            return true
          }
          return false
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (payload) => {
          if (!isSelected) return false
          payload?.preventDefault()
          editor.update(() => {
            const node = $getNodeByKey(nodeKey)
            if (!node) return
            const paragraph = $createParagraphNode()
            node.insertAfter(paragraph)
            paragraph.selectStart()
          })
          return true
        },
        COMMAND_PRIORITY_LOW
      )
    )
  }, [isSelected, editor, clearSelection, setSelected, nodeKey])

  useEffect(() => {
    const onGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest(`[data-image-key="${nodeKey}"]`)) {
        if (isSelected) clearSelection()
      }
    }
    document.addEventListener('mousedown', onGlobalClick)
    return () => document.removeEventListener('mousedown', onGlobalClick)
  }, [isSelected, clearSelection, nodeKey])

  const handleResizeStart = (
    e: React.MouseEvent,
    direction: 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w'
  ) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)

    const img = imageRef.current
    if (!img) return
    const rect = img.getBoundingClientRect()
    const startX = e.clientX
    const startY = e.clientY
    const startWidth = rect.width
    const startHeight = rect.height
    const ratio = startWidth / startHeight

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX
      const deltaY = moveEvent.clientY - startY
      let newWidth = startWidth

      if (alignment === 'center') {
        if (direction.includes('e')) newWidth = startWidth + deltaX * 2
        else if (direction.includes('w')) newWidth = startWidth - deltaX * 2
        else if (direction.includes('s')) newWidth = startWidth + deltaY * ratio * 2
        else if (direction.includes('n')) newWidth = startWidth - deltaY * ratio * 2
      } else if (alignment === 'right') {
        if (direction.includes('w')) newWidth = startWidth - deltaX
        else if (direction.includes('s')) newWidth = startWidth + deltaY * ratio
        else if (direction.includes('n')) newWidth = startWidth - deltaY * ratio
      } else {
        if (direction.includes('e')) newWidth = startWidth + deltaX
        else if (direction.includes('s')) newWidth = startWidth + deltaY * ratio
        else if (direction.includes('n')) newWidth = startWidth - deltaY * ratio
      }

      newWidth = Math.max(newWidth, MIN_WIDTH)
      img.style.width = `${newWidth}px`
      img.style.height = `${newWidth / ratio}px`
    }

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      setIsResizing(false)

      editor.update(() => {
        const node = $getNodeByKey(nodeKey)
        if ($isImageNode(node)) {
          const finalWidth = parseInt(img.style.width, 10)
          node.setWidthAndHeight(finalWidth, finalWidth / ratio)
        }
      })
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  const handleAlign = (align: ImageAlignment) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if ($isImageNode(node)) node.setAlignment(align)
    })
  }

  const handleAltSave = () => {
    if (altText === alt) return
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if ($isImageNode(node)) node.setAlt(altText)
    })
  }

  const actualWidth = width === 'inherit' ? 'auto' : width
  const actualHeight = height === 'inherit' ? 'auto' : height

  const wrapperMargin: React.CSSProperties =
    alignment === 'center'
      ? { marginLeft: 'auto', marginRight: 'auto' }
      : alignment === 'right'
        ? { marginLeft: 'auto', marginRight: 0 }
        : { marginLeft: 0, marginRight: 'auto' }

  const handleClass = 'absolute w-3 h-3 bg-[#5eead4] border border-[#333] shadow-sm z-10'

  return (
    <div
      className="group my-4 select-none outline-none"
      data-image-key={nodeKey}
      style={{ width: '100%' }}
    >
      <div
        style={{
          ...wrapperMargin,
          width: 'fit-content',
          maxWidth: '100%'
        }}
      >
        <div className="relative" style={{ padding: 4 }}>
          <img
            ref={imageRef}
            src={src}
            alt={alt}
            className={`block max-w-full rounded-sm transition-shadow duration-150 ${
              isSelected ? 'ring-2 ring-[#5eead4] ring-offset-2 ring-offset-[#111]' : ''
            }`}
            style={{
              width: actualWidth === 'auto' ? 'auto' : `${actualWidth}px`,
              height: actualHeight === 'auto' ? 'auto' : `${actualHeight}px`,
              objectFit: 'contain',
              cursor: 'pointer'
            }}
            draggable={false}
          />

          {isSelected && (
            <>
              <div className={`${handleClass} cursor-nwse-resize`} style={{ top: -2, left: -2 }} onMouseDown={(e) => handleResizeStart(e, 'nw')} />
              <div className={`${handleClass} cursor-ns-resize`} style={{ top: -2, left: '50%', transform: 'translateX(-50%)' }} onMouseDown={(e) => handleResizeStart(e, 'n')} />
              <div className={`${handleClass} cursor-nesw-resize`} style={{ top: -2, right: -2 }} onMouseDown={(e) => handleResizeStart(e, 'ne')} />
              <div className={`${handleClass} cursor-ew-resize`} style={{ top: '50%', left: -2, transform: 'translateY(-50%)' }} onMouseDown={(e) => handleResizeStart(e, 'w')} />
              <div className={`${handleClass} cursor-ew-resize`} style={{ top: '50%', right: -2, transform: 'translateY(-50%)' }} onMouseDown={(e) => handleResizeStart(e, 'e')} />
              <div className={`${handleClass} cursor-nesw-resize`} style={{ bottom: -2, left: -2 }} onMouseDown={(e) => handleResizeStart(e, 'sw')} />
              <div className={`${handleClass} cursor-ns-resize`} style={{ bottom: -2, left: '50%', transform: 'translateX(-50%)' }} onMouseDown={(e) => handleResizeStart(e, 's')} />
              <div className={`${handleClass} cursor-nwse-resize`} style={{ bottom: -2, right: -2 }} onMouseDown={(e) => handleResizeStart(e, 'se')} />

              {!isResizing && (
                <div className="absolute top-2 right-2 flex items-center gap-1 p-1 bg-[#1e1e1e] border border-white/10 shadow-lg rounded-lg z-20">
                  {(['left', 'center', 'right'] as const).map((align) => {
                    const Icon = align === 'left' ? AlignLeft : align === 'center' ? AlignCenter : AlignRight
                    return (
                      <button
                        key={align}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                        onClick={() => handleAlign(align)}
                        className={`p-1 rounded-md transition-colors ${
                          alignment === align
                            ? 'text-[#5eead4] bg-[#5eead4]/10'
                            : 'text-[#888] hover:bg-white/5 hover:text-[#ccc]'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>

        <div className="mt-1 max-w-full">
          <input
            type="text"
            value={altText}
            onChange={(e) => setAltText(e.target.value)}
            onBlur={handleAltSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { handleAltSave(); e.currentTarget.blur() }
              if (e.key === 'Escape') { setAltText(alt); e.currentTarget.blur() }
            }}
            placeholder="Add description..."
            className="w-full text-center bg-transparent border-b border-transparent hover:border-white/10 focus:border-[#5eead4]/50 text-[13px] text-[#555] focus:text-[#999] px-1 py-1 outline-none transition-colors placeholder:text-[#333]"
          />
        </div>
      </div>
    </div>
  )
}

export function $createImageNode(payload: ImagePayload): ImageNode {
  return $applyNodeReplacement(
    new ImageNode(
      payload.src,
      payload.alt,
      payload.width,
      payload.height,
      payload.alignment
    )
  )
}

export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode {
  return node instanceof ImageNode
}
