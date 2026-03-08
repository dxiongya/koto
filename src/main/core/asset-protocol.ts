/**
 * Custom protocol handler for lite-asset:// URLs.
 * Serves images from the workspace .images/ directory.
 *
 * URL format: lite-asset://images/{filename}
 */
import { protocol, net } from 'electron'
import path from 'path'
import { resolveImagePath } from './image-storage'

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
}

export function registerAssetProtocol(): void {
  protocol.handle('lite-asset', (request) => {
    const url = new URL(request.url)
    // lite-asset://images/{filename}
    const pathname = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const host = url.host // "images"
    const filename = host === 'images' ? pathname : `${host}/${pathname}`

    if (!filename) {
      return new Response('Bad Request', { status: 400 })
    }

    const resolved = resolveImagePath(filename)
    if (!resolved) {
      return new Response('Not Found', { status: 404 })
    }

    const ext = path.extname(resolved).toLowerCase()
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'

    return net.fetch(`file://${resolved}`, {
      headers: { 'Content-Type': contentType },
    })
  })
}
