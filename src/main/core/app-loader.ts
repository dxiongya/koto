/**
 * App Loader — discovers third-party apps and serves them via lite-app:// protocol.
 *
 * Directory structure:
 *   {liteHome}/apps/{appId}/
 *     app.json   - manifest
 *     index.js   - bundled React component (UMD or ESM)
 *
 * Protocol: lite-app://{appId}/{file}
 */
import { protocol, net } from 'electron'
import fs from 'fs'
import path from 'path'
import { getLiteHome } from './lite-home'

export interface AppManifestFile {
  id: string
  name: string
  icon: string
  version: string
  description: string
  entry: string
  permissions: string[]
}

/** Scan {liteHome}/apps/ for third-party app manifests */
export function discoverApps(): AppManifestFile[] {
  const appsDir = path.join(getLiteHome(), 'apps')
  if (!fs.existsSync(appsDir)) {
    fs.mkdirSync(appsDir, { recursive: true })
    return []
  }

  const results: AppManifestFile[] = []
  const entries = fs.readdirSync(appsDir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const manifestPath = path.join(appsDir, entry.name, 'app.json')
    if (!fs.existsSync(manifestPath)) continue

    try {
      const raw = fs.readFileSync(manifestPath, 'utf-8')
      const manifest = JSON.parse(raw) as AppManifestFile
      // Validate required fields
      if (manifest.id && manifest.name && manifest.entry) {
        manifest.id = manifest.id || entry.name
        results.push(manifest)
        console.log(`[Apps] Discovered: ${manifest.name} (${manifest.id})`)
      }
    } catch (e) {
      console.warn(`[Apps] Invalid manifest in ${entry.name}:`, e)
    }
  }

  return results
}

/** Register lite-app:// protocol to serve app files */
export function registerAppProtocol(): void {
  protocol.handle('lite-app', (request) => {
    const url = new URL(request.url)
    const appId = url.host
    const filePath = decodeURIComponent(url.pathname).replace(/^\/+/, '')

    if (!appId || !filePath) {
      return new Response('Bad Request', { status: 400 })
    }

    const resolved = path.join(getLiteHome(), 'apps', appId, filePath)

    // Security: ensure resolved path is inside the app directory
    const appDir = path.join(getLiteHome(), 'apps', appId)
    if (!resolved.startsWith(appDir)) {
      return new Response('Forbidden', { status: 403 })
    }

    if (!fs.existsSync(resolved)) {
      return new Response('Not Found', { status: 404 })
    }

    const ext = path.extname(resolved).toLowerCase()
    const contentTypes: Record<string, string> = {
      '.js': 'application/javascript',
      '.mjs': 'application/javascript',
      '.json': 'application/json',
      '.css': 'text/css',
      '.html': 'text/html',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
    }

    return net.fetch(`file://${resolved}`, {
      headers: { 'Content-Type': contentTypes[ext] || 'application/octet-stream' },
    })
  })
}
