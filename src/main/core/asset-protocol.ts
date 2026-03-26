/**
 * Custom protocol handler for lite-asset:// URLs.
 * Serves images and videos from the workspace directories.
 *
 * URL format: lite-asset://images/{filename}
 *             lite-asset://videos/{filename}
 */
import { protocol, net } from 'electron'
import path from 'path'
import fs from 'fs'
import { resolveImagePath } from './image-storage'
import { resolveVideoPath } from './video-storage'
import { getLiteHome } from './lite-home'

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
}

export function registerAssetProtocol(): void {
  protocol.handle('lite-asset', (request) => {
    const url = new URL(request.url)
    const pathname = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const host = url.host // "images" or "videos"

    if (!pathname) {
      return new Response('Bad Request', { status: 400 })
    }

    let resolved: string | null = null
    if (host === 'images') {
      resolved = resolveImagePath(pathname)
    } else if (host === 'videos') {
      resolved = resolveVideoPath(pathname)
    } else if (host === 'collected') {
      // Serve collected assets: lite-asset://collected/assets/{filename}
      const filePath = path.join(getLiteHome(), 'collected', pathname)
      if (fs.existsSync(filePath)) resolved = filePath
    }

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
