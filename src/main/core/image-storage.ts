/**
 * Image storage for workspace images.
 * Images are stored in {workspacePath}/.images/{uuid}.{ext}
 */
import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { getLiteHome } from './lite-home'

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
}

function getImagesDir(): string {
  const home = getLiteHome()
  if (!home) throw new Error('Lite Home not initialized')
  return path.join(home, 'images')
}

async function ensureImagesDir(): Promise<string> {
  const dir = getImagesDir()
  await fs.mkdir(dir, { recursive: true })
  return dir
}

function generateFilename(ext: string): string {
  return `img-${randomUUID().slice(0, 8)}${ext}`
}

/** Save image from raw buffer (e.g. clipboard paste) */
export async function saveImage(
  data: ArrayBuffer,
  mimeType: string
): Promise<string> {
  const dir = await ensureImagesDir()
  const ext = MIME_TO_EXT[mimeType] || '.png'
  const filename = generateFilename(ext)
  const filePath = path.join(dir, filename)
  await fs.writeFile(filePath, Buffer.from(data))
  return filename
}

/** Save image from a URL (download it) */
export async function saveImageFromUrl(imageUrl: string): Promise<string> {
  const dir = await ensureImagesDir()

  const response = await fetch(imageUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(12000),
  })

  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`)
  }

  const contentType = response.headers.get('content-type') || 'image/png'
  const mimeBase = contentType.split(';')[0].trim()
  const ext = MIME_TO_EXT[mimeBase] || path.extname(new URL(imageUrl).pathname) || '.png'
  const filename = generateFilename(ext)
  const filePath = path.join(dir, filename)

  const buffer = Buffer.from(await response.arrayBuffer())
  await fs.writeFile(filePath, buffer)
  return filename
}

/** Save image from a local file path (copy it) */
export async function saveImageFromPath(localPath: string): Promise<string> {
  const dir = await ensureImagesDir()
  const ext = path.extname(localPath).toLowerCase() || '.png'
  const filename = generateFilename(ext)
  const filePath = path.join(dir, filename)
  await fs.copyFile(localPath, filePath)
  return filename
}

/** Delete an image by filename */
export async function deleteImage(filename: string): Promise<void> {
  const dir = getImagesDir()
  const filePath = path.join(dir, filename)
  // Security: ensure the resolved path is inside .images
  const resolved = path.resolve(filePath)
  if (!resolved.startsWith(path.resolve(dir) + path.sep)) {
    throw new Error('Access denied')
  }
  await fs.unlink(resolved)
}

/** Resolve image filename to absolute file path (for protocol handler) */
export function resolveImagePath(filename: string): string | null {
  const home = getLiteHome()
  if (!home) return null
  const dir = path.join(home, 'images')
  const filePath = path.resolve(path.join(dir, filename))
  // Security check
  if (!filePath.startsWith(path.resolve(dir) + path.sep) && filePath !== path.resolve(dir)) {
    return null
  }
  if (!fsSync.existsSync(filePath)) return null
  return filePath
}
