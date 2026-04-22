/**
 * Unified cross-app drag protocol.
 *
 * Every draggable resource (sidebar file, collector item, terminal session)
 * ships the same MIME type `application/x-lite-resource` carrying a JSON
 * payload describing the resource. Drop handlers in any app read this type,
 * inspect `kind`, and decide how to consume it.
 *
 * Legacy MIME types (`application/x-lite-file`, `application/x-collector-item`,
 * `application/x-lite-pane`) continue to be set alongside for backward
 * compatibility with existing drop handlers (pane/tab moves, etc.).
 */

export const RESOURCE_DRAG_TYPE = 'application/x-lite-resource'
export const FILE_DRAG_TYPE = 'application/x-lite-file'

export type LiteResource =
  | {
      kind: 'file'
      /** Absolute path on disk */
      path: string
      /** Display name (basename by default) */
      title?: string
      /** Mime-hinting file extension without dot, lowercased (e.g. "md", "png") */
      ext?: string
    }
  | {
      kind: 'terminal'
      /** Current PTY session id (unstable across restarts) */
      sessionId: string
      /** Terminal display title */
      title?: string
      /** Current working directory, when known */
      cwd?: string
    }
  | {
      kind: 'collector-item'
      /** Row id in the collector store */
      itemId: string
      /** Collector type: link | image | video | tweet | text | note | screenshot */
      itemType: string
      /** Display title */
      title?: string
      /** External URL for link/tweet/video */
      url?: string
      /** Relative path under Lite's collected/ directory for image/video/screenshot */
      assetPath?: string
      /** Free-text note/description on the item */
      note?: string
    }

/** Serialize a resource payload onto a DataTransfer. */
export function setResourcePayload(dt: DataTransfer, resource: LiteResource): void {
  try {
    dt.setData(RESOURCE_DRAG_TYPE, JSON.stringify(resource))
  } catch {
    /* some browsers disallow setData during certain phases */
  }
  // Legacy aliases so existing drop handlers keep working.
  if (resource.kind === 'file') {
    dt.setData(FILE_DRAG_TYPE, resource.path)
  } else if (resource.kind === 'terminal') {
    dt.setData(FILE_DRAG_TYPE, `terminal://${resource.sessionId}`)
  }
}

/** Try to parse a resource payload from a DataTransfer. */
export function getResourcePayload(dt: DataTransfer): LiteResource | null {
  const raw = dt.getData(RESOURCE_DRAG_TYPE)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && typeof parsed.kind === 'string') {
      return parsed as LiteResource
    }
  } catch {
    /* malformed payload — ignore */
  }
  return null
}

/** Narrow a resource payload to file kind. */
export function asFileResource(
  r: LiteResource | null,
): Extract<LiteResource, { kind: 'file' }> | null {
  return r && r.kind === 'file' ? r : null
}

/** Narrow a resource payload to collector-item kind. */
export function asCollectorResource(
  r: LiteResource | null,
): Extract<LiteResource, { kind: 'collector-item' }> | null {
  return r && r.kind === 'collector-item' ? r : null
}

/** Narrow a resource payload to terminal kind. */
export function asTerminalResource(
  r: LiteResource | null,
): Extract<LiteResource, { kind: 'terminal' }> | null {
  return r && r.kind === 'terminal' ? r : null
}

/** Detect whether a DataTransfer's types array contains a Lite resource of any kind. */
export function hasResourceType(types: readonly string[] | DOMStringList): boolean {
  const t = types as readonly string[]
  for (let i = 0; i < t.length; i++) {
    if (t[i] === RESOURCE_DRAG_TYPE || t[i] === FILE_DRAG_TYPE) return true
  }
  return false
}
