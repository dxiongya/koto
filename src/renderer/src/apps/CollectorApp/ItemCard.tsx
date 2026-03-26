import { useRef } from 'react'
import { Globe, Twitter, Play, Monitor, Image, X } from 'lucide-react'
import type { CollectedItem } from '../../../../shared/types'
import { getDomain, TYPE_ICONS, TYPE_LABELS } from './shared'

export const ItemCard: React.FC<{ item: CollectedItem; onDelete: (id: string) => void; onOpen: (item: CollectedItem) => void }> = ({ item, onDelete, onOpen }) => {
  const Icon = TYPE_ICONS[item.type]
  const localAsset = item.assetPath ? `lite-asset://collected/${item.assetPath}` : null
  const ogImage = item.meta?.ogImage as string | undefined
  const description = item.note || (item.meta?.description as string | undefined) || ''
  const domain = getDomain(item.url)
  const wasDragged = useRef(false)

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
          ) : (
            <>
              {item.type === 'link' && <Globe size={22} className="text-tx-faint" />}
              {item.type === 'tweet' && <Twitter size={22} className="text-accent-main" />}
              {item.type === 'video' && <div className="w-[30px] h-[30px] rounded-full bg-tx-main/10 flex items-center justify-center"><Play size={13} className="text-tx-main/80" /></div>}
              {item.type === 'screenshot' && <Monitor size={22} className="text-tx-faint" />}
              {item.type === 'image' && <Image size={22} className="text-tx-faint" />}
            </>
          )}
          <button onClick={(e) => { e.stopPropagation(); onDelete(item.id) }} aria-label="Delete"
            className="absolute top-1.5 right-1.5 p-1 rounded bg-bg-app/60 text-tx-faint hover:text-tx-main opacity-0 group-hover:opacity-100 transition-opacity"><X size={10} /></button>
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
          <button onClick={(e) => { e.stopPropagation(); onDelete(item.id) }} aria-label="Delete"
            className="absolute top-2 right-2 p-0.5 rounded text-tx-faint hover:text-tx-main opacity-0 group-hover:opacity-100 transition-opacity"><X size={10} /></button>
        )}
      </div>
    </div>
  )
}
