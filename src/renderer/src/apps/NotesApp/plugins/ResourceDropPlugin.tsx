/**
 * ResourceDropPlugin — accept cross-app resources dropped into the Lexical editor.
 *
 * Handles `application/x-lite-resource` payloads:
 *   - file (markdown/text)  → `[title](file://path)` link
 *   - file (image)          → ImageNode pointing at file://path
 *   - collector image/screenshot → ImageNode (lite-asset://collected/...)
 *   - collector video       → VideoNode
 *   - collector link / tweet → CalloutNode with title + url
 *   - collector note / text → CalloutNode with title + note
 *   - terminal              → `[title](terminal://sessionId)` link
 *
 * Falls back to Lexical's default paste behavior when the drop has no
 * recognized resource payload (so images dropped from outside the app still
 * go through ImagePlugin).
 */
import { useEffect, type JSX } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  DRAGOVER_COMMAND,
  DROP_COMMAND,
  type LexicalNode,
  type RangeSelection,
} from 'lexical'
import { $createLinkNode } from '@lexical/link'
import { $createImageNode } from '../nodes/ImageNode'
import { $createVideoNode } from '../nodes/VideoNode'
import { $createCalloutNode } from '../nodes/CalloutNode'
import {
  FILE_DRAG_TYPE,
  getResourcePayload,
  hasResourceType,
  type LiteResource,
} from '../../../layouts/resourceDrag'

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'])
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm'])

export function ResourceDropPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    const unsubOver = editor.registerCommand(
      DRAGOVER_COMMAND,
      (event) => {
        if (!event.dataTransfer) return false
        if (hasResourceType(event.dataTransfer.types)) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          return true
        }
        return false
      },
      COMMAND_PRIORITY_HIGH,
    )

    const unsubDrop = editor.registerCommand(
      DROP_COMMAND,
      (event) => {
        const dt = event.dataTransfer
        if (!dt) return false

        // Prefer the unified resource payload. Fall back to the legacy file
        // path MIME so drags from older code paths still insert something.
        let resource = getResourcePayload(dt)
        if (!resource) {
          const legacyPath = dt.getData(FILE_DRAG_TYPE)
          if (legacyPath && !legacyPath.startsWith('terminal://')) {
            resource = {
              kind: 'file',
              path: legacyPath,
              title: legacyPath.split('/').pop() || legacyPath,
              ext: legacyPath.split('.').pop()?.toLowerCase(),
            }
          } else if (legacyPath?.startsWith('terminal://')) {
            resource = { kind: 'terminal', sessionId: legacyPath.slice('terminal://'.length) }
          }
        }
        if (!resource) return false

        event.preventDefault()
        editor.update(() => {
          ensureSelection((sel) => {
            const nodes = buildNodesFromResource(resource!)
            if (nodes.length === 0) return
            $insertNodes(nodes)
            void sel
          })
        })
        return true
      },
      COMMAND_PRIORITY_HIGH,
    )

    return () => {
      unsubOver()
      unsubDrop()
    }
  }, [editor])

  return null
}

function ensureSelection(cb: (sel: RangeSelection) => void): void {
  const sel = $getSelection()
  if ($isRangeSelection(sel)) return cb(sel)
  $getRoot().selectEnd()
  const fallback = $getSelection()
  if ($isRangeSelection(fallback)) cb(fallback)
}

function buildNodesFromResource(r: LiteResource): LexicalNode[] {
  if (r.kind === 'file') {
    const ext = r.ext ?? r.path.split('.').pop()?.toLowerCase()
    if (ext && IMAGE_EXTS.has(ext)) {
      return [$createImageNode({ src: `file://${r.path}` }), $createParagraphNode()]
    }
    if (ext && VIDEO_EXTS.has(ext)) {
      return [$createVideoNode({ src: `file://${r.path}` }), $createParagraphNode()]
    }
    return [linkParagraph(r.title ?? basename(r.path), `file://${r.path}`)]
  }

  if (r.kind === 'terminal') {
    return [linkParagraph(r.title ?? 'Terminal', `terminal://${r.sessionId}`)]
  }

  if (r.kind === 'collector-item') {
    const title = r.title || 'Untitled'
    switch (r.itemType) {
      case 'image':
      case 'screenshot':
        if (r.assetPath) {
          return [
            $createImageNode({ src: `lite-asset://collected/${r.assetPath}` }),
            $createParagraphNode(),
          ]
        }
        break
      case 'video':
        if (r.assetPath) {
          return [
            $createVideoNode({ src: `lite-asset://collected/${r.assetPath}` }),
            $createParagraphNode(),
          ]
        }
        break
      case 'link':
      case 'tweet':
        if (r.url) {
          return [infoCallout(title, r.url, r.note)]
        }
        break
      case 'note':
      case 'text':
      default:
        return [infoCallout(title, r.url, r.note)]
    }
    // Fallback: title + URL as a link paragraph.
    return [linkParagraph(title, r.url ?? '')]
  }

  return []
}

function linkParagraph(label: string, url: string): LexicalNode {
  const p = $createParagraphNode()
  if (url) {
    const link = $createLinkNode(url)
    link.append($createTextNode(label))
    p.append(link)
  } else {
    p.append($createTextNode(label))
  }
  return p
}

/** A callout with a bold title + optional URL link + optional note paragraph. */
function infoCallout(title: string, url: string | undefined, note: string | undefined): LexicalNode {
  const callout = $createCalloutNode('note')
  const titleP = $createParagraphNode()
  if (url) {
    const link = $createLinkNode(url)
    link.append($createTextNode(title))
    titleP.append(link)
  } else {
    const text = $createTextNode(title)
    text.setFormat('bold')
    titleP.append(text)
  }
  callout.append(titleP)
  if (note && note.trim()) {
    const noteP = $createParagraphNode()
    noteP.append($createTextNode(note.trim()))
    callout.append(noteP)
  }
  return callout
}

function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}
