/**
 * Video storage for workspace videos.
 * Videos are stored in {liteHome}/videos/vid-{uuid}.{ext}
 */
import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { getLiteHome } from './lite-home'

const MIME_TO_EXT: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/ogg': '.ogg',
  'video/quicktime': '.mov',
  'video/x-msvideo': '.avi',
  'video/x-matroska': '.mkv',
}

function getVideosDir(): string {
  const home = getLiteHome()
  if (!home) throw new Error('Lite Home not initialized')
  return path.join(home, 'videos')
}

async function ensureVideosDir(): Promise<string> {
  const dir = getVideosDir()
  await fs.mkdir(dir, { recursive: true })
  return dir
}

function generateFilename(ext: string): string {
  return `vid-${randomUUID().slice(0, 8)}${ext}`
}

/** Save video from raw buffer (e.g. clipboard paste) */
export async function saveVideo(
  data: ArrayBuffer,
  mimeType: string
): Promise<string> {
  const dir = await ensureVideosDir()
  const ext = MIME_TO_EXT[mimeType] || '.mp4'
  const filename = generateFilename(ext)
  const filePath = path.join(dir, filename)
  await fs.writeFile(filePath, Buffer.from(data))
  return filename
}

/** Save video from a local file path (copy it) */
export async function saveVideoFromPath(localPath: string): Promise<string> {
  const dir = await ensureVideosDir()
  const ext = path.extname(localPath).toLowerCase() || '.mp4'
  const filename = generateFilename(ext)
  const filePath = path.join(dir, filename)
  await fs.copyFile(localPath, filePath)
  return filename
}

/** Delete a video by filename */
export async function deleteVideo(filename: string): Promise<void> {
  const dir = getVideosDir()
  const filePath = path.join(dir, filename)
  // Security: ensure the resolved path is inside videos dir
  const resolved = path.resolve(filePath)
  if (!resolved.startsWith(path.resolve(dir) + path.sep)) {
    throw new Error('Access denied')
  }
  await fs.unlink(resolved)
}

/** Resolve video filename to absolute file path (for protocol handler) */
export function resolveVideoPath(filename: string): string | null {
  const home = getLiteHome()
  if (!home) return null
  const dir = path.join(home, 'videos')
  const filePath = path.resolve(path.join(dir, filename))
  // Security check
  if (!filePath.startsWith(path.resolve(dir) + path.sep) && filePath !== path.resolve(dir)) {
    return null
  }
  if (!fsSync.existsSync(filePath)) return null
  return filePath
}
