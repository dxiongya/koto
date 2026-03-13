/**
 * VideoNode — Block-level video/embed display (DecoratorNode).
 * Supports:
 *   - Local videos via lite-asset://videos/{filename}
 *   - YouTube URLs (youtube.com/watch, youtu.be, youtube.com/embed)
 *   - Bilibili URLs (bilibili.com/video)
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

export type VideoAlignment = 'left' | 'center' | 'right'

export interface VideoPayload {
  src: string
  width?: number | 'inherit'
  height?: number | 'inherit'
  alignment?: VideoAlignment
}

export type SerializedVideoNode = Spread<
  {
    src: string
    width?: number | 'inherit'
    height?: number | 'inherit'
    alignment?: VideoAlignment
  },
  SerializedLexicalNode
>

// ── URL helpers ──

/** Extract YouTube video ID from various URL formats */
function getYouTubeId(url: string): string | null {
  try {
    const u = new URL(url)
    // youtu.be/VIDEO_ID
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null
    // youtube.com/watch?v=VIDEO_ID
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v')
      // youtube.com/embed/VIDEO_ID
      const embedMatch = u.pathname.match(/^\/embed\/([^/?]+)/)
      if (embedMatch) return embedMatch[1]
      // youtube.com/shorts/VIDEO_ID
      const shortsMatch = u.pathname.match(/^\/shorts\/([^/?]+)/)
      if (shortsMatch) return shortsMatch[1]
    }
  } catch { /* not a valid URL */ }
  return null
}

/** Extract Bilibili video BV ID */
function getBilibiliId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname.includes('bilibili.com')) {
      const match = u.pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/)
      if (match) return match[1]
    }
  } catch { /* not a valid URL */ }
  return null
}

/** Determine embed type from src */
function getEmbedInfo(src: string): { type: 'local' | 'youtube' | 'bilibili'; embedUrl?: string } {
  const ytId = getYouTubeId(src)
  if (ytId) return { type: 'youtube', embedUrl: `https://www.youtube.com/embed/${ytId}` }
  const bvId = getBilibiliId(src)
  if (bvId) return { type: 'bilibili', embedUrl: `https://player.bilibili.com/player.html?bvid=${bvId}&autoplay=0` }
  return { type: 'local' }
}

/** Check if a URL is a supported video embed URL */
export function isVideoEmbedUrl(url: string): boolean {
  return getYouTubeId(url) !== null || getBilibiliId(url) !== null
}

export class VideoNode extends DecoratorNode<JSX.Element | null> {
  __src: string
  __width?: number | 'inherit'
  __height?: number | 'inherit'
  __alignment?: VideoAlignment

  static getType(): string {
    return 'video'
  }

  static clone(node: VideoNode): VideoNode {
    return new VideoNode(
      node.__src,
      node.__width,
      node.__height,
      node.__alignment,
      node.__key
    )
  }

  constructor(
    src: string,
    width?: number | 'inherit',
    height?: number | 'inherit',
    alignment?: VideoAlignment,
    key?: NodeKey
  ) {
    super(key)
    this.__src = src
    this.__width = width ?? 'inherit'
    this.__height = height ?? 'inherit'
    this.__alignment = alignment ?? 'center'
  }

  exportJSON(): SerializedVideoNode {
    return {
      type: 'video',
      version: 1,
      src: this.__src,
      width: this.__width,
      height: this.__height,
      alignment: this.__alignment
    }
  }

  static importJSON(json: SerializedVideoNode): VideoNode {
    return new VideoNode(json.src, json.width, json.height, json.alignment)
  }

  setWidthAndHeight(width: 'inherit' | number, height: 'inherit' | number): void {
    const writable = this.getWritable()
    writable.__width = width
    writable.__height = height
  }

  setAlignment(alignment: VideoAlignment): void {
    const writable = this.getWritable()
    writable.__alignment = alignment
  }

  isInline(): boolean {
    return false
  }

  createDOM(config: EditorConfig): HTMLElement {
    const div = document.createElement('div')
    div.style.display = 'block'
    div.style.width = '100%'
    const theme = config.theme
    const className = theme.video
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
      <VideoComponent
        src={this.__src}
        width={this.__width}
        height={this.__height}
        alignment={this.__alignment}
        nodeKey={this.getKey()}
      />
    )
  }
}

// ── UI Component ─────────────────────────────────────────────────────────────

const MIN_WIDTH = 200
const DEFAULT_WIDTH = 640
const ASPECT_RATIO = 16 / 9

function VideoComponent({
  src,
  width,
  height,
  alignment,
  nodeKey
}: {
  src: string
  width?: number | 'inherit'
  height?: number | 'inherit'
  alignment?: VideoAlignment
  nodeKey: NodeKey
}) {
  const [editor] = useLexicalComposerContext()
  const containerRef = useRef<HTMLDivElement>(null)
  const mediaRef = useRef<HTMLVideoElement | HTMLIFrameElement | null>(null)
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey)
  const [isResizing, setIsResizing] = useState(false)

  const embed = getEmbedInfo(src)
  const isEmbed = embed.type !== 'local'

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand<MouseEvent>(
        CLICK_COMMAND,
        (payload) => {
          const target = payload.target as Node
          if (containerRef.current?.contains(target)) {
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
      if (!target.closest(`[data-video-key="${nodeKey}"]`)) {
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

    const el = mediaRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
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
      el.style.width = `${newWidth}px`
      el.style.height = `${newWidth / ratio}px`
    }

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      setIsResizing(false)

      editor.update(() => {
        const node = $getNodeByKey(nodeKey)
        if ($isVideoNode(node)) {
          const finalWidth = parseInt(el.style.width, 10)
          node.setWidthAndHeight(finalWidth, finalWidth / ratio)
        }
      })
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  const handleAlign = (align: VideoAlignment) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if ($isVideoNode(node)) node.setAlignment(align)
    })
  }

  const actualWidth = width === 'inherit' ? DEFAULT_WIDTH : width
  const actualHeight = height === 'inherit'
    ? (typeof actualWidth === 'number' ? Math.round(actualWidth / ASPECT_RATIO) : DEFAULT_WIDTH / ASPECT_RATIO)
    : height

  const wrapperMargin: React.CSSProperties =
    alignment === 'center'
      ? { marginLeft: 'auto', marginRight: 'auto' }
      : alignment === 'right'
        ? { marginLeft: 'auto', marginRight: 0 }
        : { marginLeft: 0, marginRight: 'auto' }

  const handleClass = 'absolute w-3 h-3 bg-accent-main border border-border-strong shadow-sm z-10'

  const mediaStyle: React.CSSProperties = {
    width: `${actualWidth}px`,
    height: `${actualHeight}px`,
    objectFit: 'contain',
  }

  return (
    <div
      className="group my-4 select-none outline-none"
      data-video-key={nodeKey}
      style={{ width: '100%' }}
    >
      <div
        ref={containerRef}
        style={{
          ...wrapperMargin,
          width: 'fit-content',
          maxWidth: '100%'
        }}
      >
        <div className="relative" style={{ padding: 4 }}>
          {isEmbed ? (
            <iframe
              ref={(el) => { mediaRef.current = el }}
              src={embed.embedUrl}
              className={`block max-w-full rounded-sm transition-shadow duration-150 ${
                isSelected ? 'ring-2 ring-accent-main ring-offset-2 ring-offset-bg-app' : ''
              }`}
              style={{ ...mediaStyle, border: 'none' }}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <video
              ref={(el) => { mediaRef.current = el }}
              src={src}
              controls
              className={`block max-w-full rounded-sm transition-shadow duration-150 ${
                isSelected ? 'ring-2 ring-accent-main ring-offset-2 ring-offset-bg-app' : ''
              }`}
              style={mediaStyle}
              draggable={false}
            />
          )}

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
                <div className="absolute top-2 right-2 flex items-center gap-1 p-1 bg-bg-popover border border-border-subtle shadow-lg rounded-lg z-20">
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
                            ? 'text-accent-main bg-accent-main/10'
                            : 'text-tx-muted hover:bg-bg-hover hover:text-tx-main'
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
      </div>
    </div>
  )
}

export function $createVideoNode(payload: VideoPayload): VideoNode {
  return $applyNodeReplacement(
    new VideoNode(
      payload.src,
      payload.width,
      payload.height,
      payload.alignment
    )
  )
}

export function $isVideoNode(node: LexicalNode | null | undefined): node is VideoNode {
  return node instanceof VideoNode
}
