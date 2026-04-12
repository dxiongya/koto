import { useRef, useState, useEffect } from 'react'
import { Globe, Twitter, Play, Monitor, Image, X, BookOpen } from 'lucide-react'
import type { CollectedItem } from '../../../../shared/types'
import { getDomain, TYPE_ICONS, TYPE_LABELS } from './shared'

export const ItemCard: React.FC<{
  item: CollectedItem
  onDelete: (id: string) => void
  onOpen: (item: CollectedItem) => void
  onSendToWiki?: (id: string) => void
}> = ({ item, onDelete, onOpen, onSendToWiki }) => {
  const Icon = TYPE_ICONS[item.type]
  const localAsset = item.assetPath ? `lite-asset://collected/${item.assetPath}` : null
  const ogImage = item.meta?.ogImage as string | undefined
  // For X/Twitter bookmarks: use stored media or author profile image
  const tweetThumbnail = !localAsset && !ogImage && item.url?.match(/x\.com|twitter\.com/)
    ? ((item.meta?.mediaUrls as string[])?.[0]
      || item.meta?.thumbnailUrl as string
      || item.meta?.authorProfileImageUrl as string
      || null)
    : null
  const description = item.note || (item.meta?.description as string | undefined) || ''
  const domain = getDomain(item.url)
  const wasDragged = useRef(false)

  // Lazy-load OG image for links without any image
  const [lazyOg, setLazyOg] = useState<string | null>(null)
  const hasNoImage = !localAsset && !ogImage && !tweetThumbnail
  useEffect(() => {
    if (!hasNoImage || !item.url || item.type === 'text') return
    let cancelled = false
    window.api.url.fetchMeta(item.url).then((res: any) => {
      if (cancelled || !res.ok || !res.data?.image) return
      setLazyOg(res.data.image)
      window.api.collector.update(item.id, { meta: { ...item.meta, ogImage: res.data.image } }).catch(() => {})
    }).catch(() => {})
    return () => { cancelled = true }
  }, [item.id, item.url, hasNoImage])

  return (
    <div
      draggable
      onDragStart={(e) => { wasDragged.current = true; e.dataTransfer.setData('application/x-collector-item', item.id); e.dataTransfer.effectAllowed = 'move' }}
      onDragEnd={() => { setTimeout(() => { wasDragged.current = false }, 100) }}
      onClick={() => { if (!wasDragged.current) onOpen(item) }}
      className="group flex flex-col bg-bg-hover rounded-md border border-border-subtle overflow-hidden hover:border-border-strong transition-colors cursor-pointer"
    >
      {item.type !== 'text' && (
        <div className="w-full h-[100px] bg-bg-sidebar flex items-center justify-center relative overflow-hidden">
          {localAsset ? (
            item.type === 'video' ? <video src={localAsset} className="w-full h-full object-cover" muted /> : <img src={localAsset} alt="" className="w-full h-full object-cover" />
          ) : ogImage ? (
            <img src={ogImage} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
          ) : tweetThumbnail ? (
            <img src={tweetThumbnail} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
          ) : lazyOg ? (
            <img src={lazyOg} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
          ) : (
            <>
              {item.type === 'link' && <Globe size={22} className="text-tx-faint" />}
              {item.type === 'tweet' && <Twitter size={22} className="text-accent-main" />}
              {item.type === 'video' && <div className="w-[30px] h-[30px] rounded-full bg-tx-main/10 flex items-center justify-center"><Play size={13} className="text-tx-main/80" /></div>}
              {item.type === 'screenshot' && <Monitor size={22} className="text-tx-faint" />}
              {item.type === 'image' && <Image size={22} className="text-tx-faint" />}
            </>
          )}
          <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {onSendToWiki && (
              <button onClick={(e) => { e.stopPropagation(); onSendToWiki(item.id) }} aria-label="Send to Wiki"
                title="Send to Wiki"
                className="p-1 rounded bg-bg-app/60 text-tx-faint hover:text-accent-main transition-colors"><BookOpen size={10} /></button>
            )}
            <button onClick={(e) => { e.stopPropagation(); onDelete(item.id) }} aria-label="Delete"
              className="p-1 rounded bg-bg-app/60 text-tx-faint hover:text-tx-main transition-colors"><X size={10} /></button>
          </div>
        </div>
      )}
      <div className={`p-2.5 flex flex-col gap-1 ${item.type === 'text' ? 'relative' : ''}`}>
        <div className="flex items-center gap-1.5">
          <Icon size={9} className="text-tx-faint shrink-0" />
          <span className="text-[9px] text-tx-faint tracking-wide">{TYPE_LABELS[item.type]}</span>
          {domain && <><span className="text-[9px] text-tx-faint">·</span><span className="text-[9px] text-tx-faint truncate">{domain}</span></>}
        </div>
        <span className="text-[12px] text-tx-main font-medium leading-snug line-clamp-2">{item.title}</span>
        {description && <span className="text-[10px] text-tx-faint leading-relaxed line-clamp-2">{description}</span>}
        {item.meta?.duplicateOf && (
          <div className="flex items-center gap-1.5 mt-1 px-2 py-1 rounded bg-status-warning/10 text-[9px] text-status-warning cursor-pointer hover:bg-status-warning/15 transition-colors"
            onClick={(e) => { e.stopPropagation(); onOpen({ ...item, id: item.meta!.duplicateOf as string } as CollectedItem) }}>
            <span>⚠ Duplicate</span><span className="text-status-warning/60">·</span><span>View original →</span>
          </div>
        )}
        {item.type === 'text' && (
          <div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {onSendToWiki && (
              <button onClick={(e) => { e.stopPropagation(); onSendToWiki(item.id) }} aria-label="Send to Wiki"
                title="Send to Wiki"
                className="p-0.5 rounded text-tx-faint hover:text-accent-main transition-colors"><BookOpen size={10} /></button>
            )}
            <button onClick={(e) => { e.stopPropagation(); onDelete(item.id) }} aria-label="Delete"
              className="p-0.5 rounded text-tx-faint hover:text-tx-main transition-colors"><X size={10} /></button>
          </div>
        )}
      </div>
    </div>
  )
}
