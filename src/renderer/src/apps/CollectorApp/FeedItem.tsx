import { useEffect, useState, useRef } from 'react'
import { ExternalLink, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { CollectedItem } from '../../../../shared/types'
import { getDomain, TYPE_ICONS, TYPE_LABELS } from './shared'

export const FeedItem: React.FC<{ item: CollectedItem; onDelete: (id: string) => void; onOpen: (item: CollectedItem) => void }> = ({ item, onDelete, onOpen }) => {
  const Icon = TYPE_ICONS[item.type]
  const localAsset = item.assetPath ? `lite-asset://collected/${item.assetPath}` : null
  const ogImage = item.meta?.ogImage as string | undefined
  const tweetThumbnail = !localAsset && !ogImage && item.url?.match(/x\.com|twitter\.com/)
    ? ((item.meta?.mediaUrls as string[])?.[0] || item.meta?.thumbnailUrl as string || item.meta?.authorProfileImageUrl as string || null)
    : null
  const domain = getDomain(item.url)
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [visible, setVisible] = useState(false)
  const feedRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const el = feedRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect() } },
      { rootMargin: '200px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || !item.meta?.hasMarkdown) return
    window.api.collector.getMarkdown(item.id).then((res) => {
      if (res.ok && res.data) setMarkdown(res.data)
    })
  }, [visible, item.id, item.meta?.hasMarkdown])

  const contentPreview = markdown || item.note || (item.meta?.description as string) || (item.meta?.ocrText as string) || ''
  const isLong = contentPreview.length > 600
  const displayContent = expanded ? contentPreview : contentPreview.slice(0, 600)
  const hasImage = !!(localAsset || ogImage || tweetThumbnail)
  const timeAgo = (() => {
    const diff = Date.now() - item.createdAt
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}m`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h`
    const days = Math.floor(hrs / 24)
    if (days < 30) return `${days}d`
    return new Date(item.createdAt).toLocaleDateString()
  })()

  return (
    <article ref={feedRef} className="group relative">
      <div className="absolute left-0 top-6 bottom-6 w-px bg-border-subtle group-hover:bg-accent-main/30 transition-colors" />
      <div className="pl-5">
        <div className="flex items-center gap-2 mb-2">
          <Icon size={11} className="text-tx-faint" />
          <span className="text-[10px] text-tx-faint uppercase tracking-wider">{TYPE_LABELS[item.type]}</span>
          {domain && <><span className="text-[10px] text-tx-faint">·</span><span className="text-[10px] text-tx-faint">{domain}</span></>}
          <span className="text-[10px] text-tx-faint">·</span>
          <span className="text-[10px] text-tx-faint">{timeAgo}</span>
          <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {item.url && <button onClick={() => onOpen(item)} aria-label="Open in browser" className="p-1 text-tx-faint hover:text-accent-main transition-colors"><ExternalLink size={11} /></button>}
            <button onClick={(e) => { e.stopPropagation(); onDelete(item.id) }} aria-label="Delete" className="p-1 text-tx-faint hover:text-tx-main transition-colors"><X size={11} /></button>
          </div>
        </div>

        {item.meta?.duplicateOf && (
          <div className="flex items-center gap-2 px-3 py-1.5 mb-2 rounded-md bg-status-warning/10 border border-status-warning/20 text-[11px] text-status-warning">
            <span>⚠ Duplicate resource</span><span className="text-status-warning/60">·</span>
            <button onClick={(e) => { e.stopPropagation(); onOpen({ ...item, id: item.meta!.duplicateOf as string } as CollectedItem) }} className="hover:underline">View original →</button>
          </div>
        )}

        <h3 className="text-[15px] text-tx-main leading-snug mb-3 cursor-pointer hover:text-accent-main transition-colors"
          onClick={() => item.url ? onOpen(item) : (localAsset && onOpen(item))}>{item.title}</h3>

        {hasImage && (
          <div className="mb-3 rounded-md overflow-hidden max-h-[280px] cursor-pointer" onClick={() => onOpen(item)}>
            <img src={localAsset || ogImage || tweetThumbnail || ''} alt="" className="w-full object-cover" onError={(e) => { (e.target as HTMLElement).style.display = 'none' }} />
          </div>
        )}

        {contentPreview && (
          <div className="mb-2">
            {markdown ? (
              <div className="
                max-w-none text-[13px] leading-[1.75] text-tx-main/85
                [&_h1]:text-[17px] [&_h1]:text-tx-main [&_h1]:font-medium [&_h1]:mt-5 [&_h1]:mb-2
                [&_h2]:text-[15px] [&_h2]:text-tx-main/95 [&_h2]:font-medium [&_h2]:mt-4 [&_h2]:mb-2
                [&_h3]:text-[14px] [&_h3]:text-tx-main/90 [&_h3]:font-medium [&_h3]:mt-3 [&_h3]:mb-1.5
                [&_p]:my-2 [&_a]:text-accent-main [&_a]:no-underline hover:[&_a]:underline
                [&_strong]:text-tx-main [&_strong]:font-medium [&_em]:text-tx-main/80
                [&_code]:text-[12px] [&_code]:text-accent-main [&_code]:bg-bg-active [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded
                [&_pre]:bg-bg-active [&_pre]:rounded-md [&_pre]:p-4 [&_pre]:my-3 [&_pre]:text-[12px] [&_pre]:leading-relaxed [&_pre]:overflow-x-auto
                [&_pre_code]:bg-transparent [&_pre_code]:p-0
                [&_blockquote]:border-l-2 [&_blockquote]:border-accent-main/30 [&_blockquote]:pl-4 [&_blockquote]:my-3 [&_blockquote]:text-tx-muted
                [&_img]:rounded-md [&_img]:max-h-[240px] [&_img]:my-3
                [&_table]:text-[12px] [&_table]:w-full [&_table]:my-3
                [&_th]:text-left [&_th]:text-tx-muted [&_th]:font-medium [&_th]:pb-2 [&_th]:border-b [&_th]:border-border-subtle
                [&_td]:py-1.5 [&_td]:text-tx-main/70 [&_td]:border-b [&_td]:border-border-subtle/50
                [&_li]:my-0.5 [&_ul]:my-2 [&_ul]:pl-4 [&_ul]:list-disc [&_ul]:marker:text-tx-faint
                [&_ol]:my-2 [&_ol]:pl-4 [&_ol]:list-decimal [&_ol]:marker:text-tx-faint
                [&_hr]:border-border-subtle [&_hr]:my-4 overflow-hidden">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayContent}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-[13px] text-tx-main/85 leading-[1.75] whitespace-pre-wrap">{displayContent}</p>
            )}
            {isLong && (
              <button onClick={() => setExpanded(!expanded)} className="text-[12px] text-tx-faint hover:text-accent-main transition-colors mt-1">
                {expanded ? '↑ Show less' : '↓ Show more'}
              </button>
            )}
          </div>
        )}
      </div>
      <div className="h-px bg-border-subtle/50 mt-5 ml-5" />
    </article>
  )
}
