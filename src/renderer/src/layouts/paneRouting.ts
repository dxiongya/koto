import type { AppType } from '../../../shared/types'

/**
 * Map a resource string to the app that should open it.
 * Called when a file/resource is dropped onto a pane.
 * Accepts both plain file paths and scheme-prefixed resources (e.g. terminal://ID).
 */
export function resolveAppForFile(path: string): AppType | null {
  // Scheme-prefixed resources
  if (path.startsWith('terminal://')) return 'terminal.app'

  const base = path.split('/').pop() ?? path
  const dot = base.lastIndexOf('.')
  if (dot < 0) return null
  const ext = base.slice(dot + 1).toLowerCase()

  // Notes — markdown family
  if (['md', 'mdx', 'markdown', 'txt'].includes(ext)) return 'notes.app'

  // Images / media — collector is the consumer
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'mp4', 'mov', 'webm'].includes(ext)) return 'collector.app'

  // Unsupported — drop is a no-op
  return null
}

/**
 * Extract the session id from a `terminal://ID` resource URI.
 * Returns null if not a terminal URI.
 */
export function parseTerminalResource(resource: string | null | undefined): string | null {
  if (!resource || !resource.startsWith('terminal://')) return null
  return resource.slice('terminal://'.length)
}
