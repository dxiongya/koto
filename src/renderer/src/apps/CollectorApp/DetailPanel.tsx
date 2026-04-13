/**
 * Detail Panel — shows full content and metadata for a collected item.
 * Text: full content + copy button
 * Link/Tweet: og:image + title + description + URL + metadata
 * Image: full preview + OCR text + AI description
 */
import { useEffect, useState, useCallback } from 'react'
import { X, Copy, ExternalLink, Check, Link, Type, Clock, Folder, Tag } from 'lucide-react'
import type { CollectedItem } from '../../../../shared/types'
import { getDomain, TYPE_ICONS, TYPE_LABELS } from './shared'

export const DetailPanel: React.FC<{
  item: CollectedItem
  onClose: () => void
  onOpenExternal: (item: CollectedItem) => void
}> = ({ item, onClose, onOpenExternal }) => {
  const Icon = TYPE_ICONS[item.type]
  const domain = getDomain(item.url)
  const localAsset = item.assetPath ? `lite-asset://collected/${item.assetPath}` : null
  const ogImage = item.meta?.ogImage as string | undefined
  const tweetThumb = !localAsset && !ogImage && item.url?.match(/x\.com|twitter\.com/)
    ? ((item.meta?.mediaUrls as string[])?.[0] || item.meta?.thumbnailUrl as string || item.meta?.authorProfileImageUrl as string || null)
    : null
  const ocrText = item.meta?.ocrText as string | undefined
  const imageDesc = item.meta?.imageDescription as string | undefined
  const description = item.meta?.description as string | undefined
  const hasMarkdown = item.meta?.hasMarkdown as boolean | undefined
  const markdownLength = item.meta?.markdownLength as number | undefined

  // Lazy-load OG image for links without any image
  const [lazyOgImage, setLazyOgImage] = useState<string | null>(null)
  useEffect(() => {
    if (localAsset || ogImage || tweetThumb || !item.url) return
    // Fetch OG image via URL meta and cache in item
    let cancelled = false
    window.api.url.fetchMeta(item.url).then((res: any) => {
      if (cancelled || !res.ok || !res.data?.image) return
      setLazyOgImage(res.data.image)
      // Cache in meta so it doesn't need to fetch again
      window.api.collector.update(item.id, { meta: { ...item.meta, ogImage: res.data.image } }).catch(() => {})
    }).catch(() => {})
    return () => { cancelled = true }
  }, [item.id, item.url, localAsset, ogImage, tweetThumb])

  const displayImage = localAsset || ogImage || tweetThumb || lazyOgImage

  const [markdown, setMarkdown] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Load markdown for links
  useEffect(() => {
    if (hasMarkdown) {
      window.api.collector.getMarkdown(item.id).then((res) => {
        if (res.ok && res.data) setMarkdown(res.data)
      })
    }
  }, [item.id, hasMarkdown])

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [])

  const timeAgo = (() => {
    const diff = Date.now() - item.createdAt
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    return `${days}d ago`
  })()

  return (
    <div className="fixed inset-0 z-[9999] flex" onClick={onClose}>
      {/* Backdrop */}
      <div className="flex-1" />

      {/* Panel — right side */}
      <div
        className="w-[440px] h-full bg-bg-sidebar border-l border-border-subtle shadow-2xl flex flex-col overflow-hidden"
        style={{ animation: 'slide-in-right 0.15s ease' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center gap-3 px-5 py-4 border-b border-border-subtle">
          <Icon size={16} className="text-accent-main shrink-0" />
          <div className="flex-1 min-w-0">
            <h2 className="text-[14px] text-tx-main font-medium truncate">{item.type === 'text' ? item.title.split('\n')[0].slice(0, 120) : item.title}</h2>
            <div className="flex items-center gap-2 text-[11px] text-tx-faint mt-0.5">
              <span>{TYPE_LABELS[item.type]}</span>
              {domain && <><span>·</span><span>{domain}</span></>}
              <span>·</span>
              <span>{timeAgo}</span>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 text-tx-faint hover:text-tx-main transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Content — scrollable */}
        <div className="flex-1 overflow-y-auto">
          {/* Image preview */}
          {displayImage && (
            <div className="w-full max-h-[280px] overflow-hidden bg-bg-app">
              <img src={displayImage} alt="" className="w-full object-contain max-h-[280px]"
                onError={(e) => { (e.target as HTMLElement).style.display = 'none' }} />
            </div>
          )}

          <div className="px-5 py-4 space-y-4">
            {/* URL */}
            {item.url && (
              <div>
                <div className="text-[10px] text-tx-faint uppercase tracking-wider mb-1">URL</div>
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-accent-main truncate flex-1">{item.url}</span>
                  <button onClick={() => handleCopy(item.url!)} className="p-1 text-tx-faint hover:text-tx-main shrink-0" title="Copy URL">
                    {copied ? <Check size={12} className="text-status-success" /> : <Copy size={12} />}
                  </button>
                  <button onClick={() => onOpenExternal(item)} className="p-1 text-tx-faint hover:text-accent-main shrink-0" title="Open in browser">
                    <ExternalLink size={12} />
                  </button>
                </div>
              </div>
            )}

            {/* Description / Note */}
            {(item.note || description) && item.type !== 'text' && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-tx-faint uppercase tracking-wider">Description</span>
                  <button onClick={() => handleCopy(item.note || description || '')} className="p-1 text-tx-faint hover:text-tx-main" title="Copy">
                    <Copy size={10} />
                  </button>
                </div>
                <p className="text-[12px] text-tx-main/80 leading-relaxed">{item.note || description}</p>
              </div>
            )}

            {/* Text content — full display with copy */}
            {item.type === 'text' && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-tx-faint uppercase tracking-wider">Content</span>
                  <button
                    onClick={() => handleCopy(item.title)}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] text-tx-faint hover:text-accent-main border border-border-subtle rounded hover:border-accent-main/30 transition-colors"
                  >
                    {copied ? <><Check size={10} className="text-status-success" /> Copied</> : <><Copy size={10} /> Copy</>}
                  </button>
                </div>
                <pre className="text-[13px] text-tx-main/90 leading-relaxed whitespace-pre-wrap bg-bg-app rounded-md p-3 max-h-[300px] overflow-y-auto">{item.title}</pre>
              </div>
            )}

            {/* OCR Text (images) */}
            {ocrText && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-tx-faint uppercase tracking-wider">Extracted Text (OCR)</span>
                  <button onClick={() => handleCopy(ocrText)} className="p-1 text-tx-faint hover:text-tx-main" title="Copy">
                    <Copy size={10} />
                  </button>
                </div>
                <p className="text-[12px] text-tx-main/70 leading-relaxed bg-bg-app rounded-md p-3">{ocrText}</p>
              </div>
            )}

            {/* AI Description (images) */}
            {imageDesc && (
              <div>
                <div className="text-[10px] text-tx-faint uppercase tracking-wider mb-1">AI Description</div>
                <p className="text-[12px] text-tx-main/70 leading-relaxed">{imageDesc}</p>
              </div>
            )}

            {/* Markdown content preview */}
            {markdown && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-tx-faint uppercase tracking-wider">Page Content ({markdownLength ? `${Math.round(markdownLength / 1000)}k chars` : ''})</span>
                  <button onClick={() => handleCopy(markdown)} className="p-1 text-tx-faint hover:text-tx-main" title="Copy markdown">
                    <Copy size={10} />
                  </button>
                </div>
                <pre className="text-[11px] text-tx-main/60 leading-relaxed whitespace-pre-wrap bg-bg-app rounded-md p-3 max-h-[200px] overflow-y-auto">{markdown.slice(0, 2000)}{markdown.length > 2000 ? '\n...' : ''}</pre>
              </div>
            )}

            {/* Metadata */}
            <div>
              <div className="text-[10px] text-tx-faint uppercase tracking-wider mb-2">Metadata</div>
              <div className="space-y-1.5 text-[11px]">
                <div className="flex items-center gap-2">
                  <Tag size={10} className="text-tx-faint" />
                  <span className="text-tx-faint">Type:</span>
                  <span className="text-tx-muted">{item.type}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Folder size={10} className="text-tx-faint" />
                  <span className="text-tx-faint">Group:</span>
                  <span className="text-tx-muted">{item.group}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock size={10} className="text-tx-faint" />
                  <span className="text-tx-faint">Collected:</span>
                  <span className="text-tx-muted">{new Date(item.createdAt).toLocaleString()}</span>
                </div>
                {item.meta?.domain && (
                  <div className="flex items-center gap-2">
                    <Link size={10} className="text-tx-faint" />
                    <span className="text-tx-faint">Domain:</span>
                    <span className="text-tx-muted">{item.meta.domain as string}</span>
                  </div>
                )}
                {item.meta?.hasMarkdown && (
                  <div className="flex items-center gap-2">
                    <Type size={10} className="text-tx-faint" />
                    <span className="text-tx-faint">Markdown:</span>
                    <span className="text-status-success">✓ Saved</span>
                  </div>
                )}
                {item.meta?.contentHash && (
                  <div className="flex items-center gap-2">
                    <Tag size={10} className="text-tx-faint" />
                    <span className="text-tx-faint">Hash:</span>
                    <span className="text-tx-muted font-mono">{(item.meta.contentHash as string).slice(0, 12)}</span>
                  </div>
                )}
                {item.meta?.duplicateOf && (
                  <div className="flex items-center gap-2">
                    <span className="text-status-warning">⚠ Duplicate of {(item.meta.duplicateOf as string).slice(0, 8)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
