import { X } from 'lucide-react'
import type { CollectedItem } from '../../../../shared/types'
import { getDomain, TYPE_ICONS, TYPE_LABELS } from './shared'
import { setResourcePayload } from '../../layouts/resourceDrag'

export const ItemListRow: React.FC<{ item: CollectedItem; onDelete: (id: string) => void; onOpen: (item: CollectedItem) => void }> = ({ item, onDelete, onOpen }) => {
  const Icon = TYPE_ICONS[item.type]
  const domain = getDomain(item.url)
  const localAsset = item.assetPath ? `lite-asset://collected/${item.assetPath}` : null
  const ogImage = item.meta?.ogImage as string | undefined
  const tweetThumb = !localAsset && !ogImage && item.url?.match(/x\.com|twitter\.com/)
    ? ((item.meta?.mediaUrls as string[])?.[0] || item.meta?.thumbnailUrl as string || item.meta?.authorProfileImageUrl as string || null)
    : null
  const thumb = localAsset || ogImage || tweetThumb

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-collector-item', item.id)
        setResourcePayload(e.dataTransfer, {
          kind: 'collector-item',
          itemId: item.id,
          itemType: item.type,
          title: item.title,
          url: item.url,
          assetPath: item.assetPath,
          note: item.note,
        })
        e.dataTransfer.effectAllowed = 'copyMove'
      }}
      onClick={() => onOpen(item)}
      className="group flex items-center gap-3 px-3 py-2 rounded-md hover:bg-bg-hover transition-colors cursor-pointer"
    >
      <div className="w-10 h-10 rounded bg-bg-sidebar flex items-center justify-center shrink-0 overflow-hidden">
        {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
          : <Icon size={16} className="text-tx-faint" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] text-tx-main truncate">{item.title}</div>
        <div className="flex items-center gap-1.5 text-[10px] text-tx-faint">
          <Icon size={9} /><span>{TYPE_LABELS[item.type]}</span>
          {domain && <><span>·</span><span>{domain}</span></>}
          {item.meta?.duplicateOf && <span className="text-status-warning">· duplicate</span>}
        </div>
      </div>
      <span className="text-[10px] text-tx-faint shrink-0">{new Date(item.createdAt).toLocaleDateString()}</span>
      <button onClick={(e) => { e.stopPropagation(); onDelete(item.id) }} aria-label="Delete"
        className="p-1 text-tx-faint hover:text-tx-main opacity-0 group-hover:opacity-100 transition-opacity shrink-0"><X size={11} /></button>
    </div>
  )
}
