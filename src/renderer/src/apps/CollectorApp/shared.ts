import { Link, Image, Video, Twitter, Monitor, Type } from 'lucide-react'
import type { CollectedItemType } from '../../../../shared/types'

/** Extract domain from URL, returns empty string on failure */
export function getDomain(url?: string): string {
  if (!url) return ''
  try { return new URL(url).hostname.replace('www.', '') } catch { return '' }
}

export const TYPE_ICONS: Record<CollectedItemType, React.FC<{ size?: number; className?: string }>> = {
  link: Link,
  image: Image,
  video: Video,
  tweet: Twitter,
  screenshot: Monitor,
  text: Type,
}

export const TYPE_LABELS: Record<CollectedItemType, string> = {
  link: 'LINK',
  image: 'IMAGE',
  video: 'VIDEO',
  tweet: 'TWEET',
  screenshot: 'SCREENSHOT',
  text: 'TEXT',
}

export interface ToastState {
  message: string
  status: 'loading' | 'success' | 'error'
}
