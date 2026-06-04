import { useRef, useState, useEffect } from 'react'
import { Globe, Twitter, Play, Monitor, Image, X, BookOpen, Copy, ExternalLink } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { CollectedItem } from '../../../../shared/types'
import { getDomain, TYPE_ICONS, TYPE_LABELS } from './shared'
import { setResourcePayload } from '../../layouts/resourceDrag'

// Shared button styling for the hover toolbar that sits on top of an
// item's thumbnail image. Theme-independent on purpose — the chip is
// always over an arbitrary image, so we use a fixed dark scrim + bright
// icon so contrast holds in light, dark, and high-contrast themes alike.
// `backdrop-blur-sm` softens busy images underneath. Each consumer adds
// its own `hover:text-*` for the final icon color.
const OVERLAY_BTN_CLS =
  'p-1 rounded bg-black/55 text-white/85 backdrop-blur-sm hover:bg-black/75 transition-colors shadow-[0_1px_3px_rgba(0,0,0,0.25)]'

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
  const displayTitle = item.type === 'text' ? item.title.split('\n')[0].slice(0, 120) : item.title
  const description = item.type === 'text'
    ? (item.title.includes('\n') ? item.title.slice(item.title.indexOf('\n') + 1).trim() : '')
    : (item.note || (item.meta?.description as string | undefined) || '')
  const domain = getDomain(item.url)
  const wasDragged = useRef(false)

  // Lazy-load OG image for links without any image
  const [lazyOg, setLazyOg] = useState<string | null>(null)
  const hasNoImage = !localAsset && !ogImage && !tweetThumbnail

  // Copy targets — `path` is the in-app asset URL (drop into a note and it
  // resolves), `source` is the origin URL where the item was collected from.
  // Both fall back to the item title so the menu is never a no-op.
  const copyPath = (): void => {
    const text = localAsset || item.url || item.title
    void navigator.clipboard.writeText(text)
  }
  const copySource = (): void => {
    const text = item.url || item.title
    void navigator.clipboard.writeText(text)
  }
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
      onDragStart={(e) => {
        wasDragged.current = true
        // ── In-app MIME types (consumed by other Lite panes/apps) ──
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

        // ── External-app MIME types (consumed by chat inputs, browsers,
        //    text fields outside Lite) ─────────────────────────────────
        // text/plain: works as a fallback in basically every text input.
        //   - text items: the note body itself
        //   - link/tweet/video items: the URL
        //   - image/screenshot items with no URL: the title (filename-ish)
        const plainText = item.type === 'text'
          ? (item.note || item.title)
          : (item.url || item.title)
        if (plainText) e.dataTransfer.setData('text/plain', plainText)
        // text/uri-list: browsers and link inputs auto-resolve this to a
        // navigable URL.
        if (item.url) e.dataTransfer.setData('text/uri-list', item.url)

        // OS-level file drag lives on a dedicated handle (see ExternalDragHandle
        // below) — calling it in parallel with the HTML5 drag locked up the
        // input loop and prevented subsequent drags from starting.

        // 'copyMove' (not just 'move') so target handlers that set
        // dropEffect='copy' are compatible — otherwise the browser resolves
        // the drop to 'none' and silently drops the event.
        e.dataTransfer.effectAllowed = 'copyMove'
      }}
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
            {item.assetPath && (
              <ExternalDragHandle assetPath={item.assetPath} variant="overlay" />
            )}
            <CopyMenu onCopyPath={copyPath} onCopySource={copySource} variant="overlay" />
            {onSendToWiki && (
              <button onClick={(e) => { e.stopPropagation(); onSendToWiki(item.id) }} aria-label="Send to Wiki"
                title="Send to Wiki"
                className={OVERLAY_BTN_CLS + ' hover:text-accent-main'}><BookOpen size={11} /></button>
            )}
            <button onClick={(e) => { e.stopPropagation(); onDelete(item.id) }} aria-label="Delete"
              className={OVERLAY_BTN_CLS + ' hover:text-white'}><X size={11} /></button>
          </div>
        </div>
      )}
      <div className={`p-2.5 flex flex-col gap-1 ${item.type === 'text' ? 'relative' : ''}`}>
        <div className="flex items-center gap-1.5">
          <Icon size={9} className="text-tx-faint shrink-0" />
          <span className="text-[9px] text-tx-faint tracking-wide">{TYPE_LABELS[item.type]}</span>
          {domain && <><span className="text-[9px] text-tx-faint">·</span><span className="text-[9px] text-tx-faint truncate">{domain}</span></>}
          {item.meta?.postedAt && <><span className="text-[9px] text-tx-faint">·</span><span className="text-[9px] text-tx-faint">{new Date(item.meta.postedAt as string).toLocaleDateString()}</span></>}
        </div>
        <span className="text-[12px] text-tx-main font-medium leading-snug line-clamp-2">{displayTitle}</span>
        {description && <span className="text-[10px] text-tx-faint leading-relaxed line-clamp-2">{description}</span>}
        {item.meta?.duplicateOf && (
          <div className="flex items-center gap-1.5 mt-1 px-2 py-1 rounded bg-status-warning/10 text-[9px] text-status-warning cursor-pointer hover:bg-status-warning/15 transition-colors"
            onClick={(e) => { e.stopPropagation(); onOpen({ ...item, id: item.meta!.duplicateOf as string } as CollectedItem) }}>
            <span>⚠ Duplicate</span><span className="text-status-warning/60">·</span><span>View original →</span>
          </div>
        )}
        {item.type === 'text' && (
          <div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <CopyMenu onCopyPath={copyPath} onCopySource={copySource} variant="bare" />
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

const CopyMenu: React.FC<{
  onCopyPath: () => void
  onCopySource: () => void
  // `overlay` sits on top of the thumbnail (semi-opaque chip), `bare` sits on
  // a plain card surface (no chip background) — matches the two existing
  // toolbar treatments in ItemCard.
  variant: 'overlay' | 'bare'
}> = ({ onCopyPath, onCopySource, variant }) => {
  const triggerCls =
    variant === 'overlay'
      ? `${OVERLAY_BTN_CLS} hover:text-white`
      : 'p-0.5 rounded text-tx-faint hover:text-tx-main transition-colors'
  const stop = (e: React.SyntheticEvent): void => e.stopPropagation()
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Copy"
          title="Copy"
          onClick={stop}
          onPointerDown={stop}
          className={triggerCls}
        >
          <Copy size={variant === 'overlay' ? 11 : 10} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="bottom"
          align="end"
          sideOffset={4}
          onClick={stop}
          className="z-50 min-w-[140px] rounded-md py-1 bg-bg-popover border border-border-subtle shadow-[0_4px_16px_rgba(0,0,0,0.25)]"
        >
          <DropdownMenu.Item
            onSelect={onCopyPath}
            className="px-3 py-1.5 text-[11px] text-tx-muted outline-none cursor-pointer hover:text-tx-main hover:bg-bg-hover"
          >
            Copy path
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={onCopySource}
            className="px-3 py-1.5 text-[11px] text-tx-muted outline-none cursor-pointer hover:text-tx-main hover:bg-bg-hover"
          >
            Copy source
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// Dedicated handle for OS-level file drag (Finder, Photoshop, Slack
// upload, etc.). Must live on its own draggable element — combining
// `webContents.startDrag()` with the card's HTML5 drag in the same
// dragstart locks the input loop and prevents subsequent drags.
//
// Pattern (per Electron docs): preventDefault to cancel the HTML5 drag,
// then immediately ask main to begin a native drag from the still-held
// mouse button.
const ExternalDragHandle: React.FC<{
  assetPath: string
  variant: 'overlay' | 'bare'
}> = ({ assetPath, variant }) => {
  const cls =
    variant === 'overlay'
      ? `${OVERLAY_BTN_CLS} hover:text-white cursor-grab active:cursor-grabbing`
      : 'p-0.5 rounded text-tx-faint hover:text-tx-main transition-colors cursor-grab active:cursor-grabbing'
  return (
    <div
      draggable
      aria-label="Drag to other app"
      title="Drag to other app (Finder, Photoshop, etc.)"
      onClick={(e) => e.stopPropagation()}
      onDragStart={(e) => {
        e.preventDefault()
        e.stopPropagation()
        window.api.shell.startDrag(assetPath)
      }}
      className={cls}
    >
      <ExternalLink size={variant === 'overlay' ? 11 : 10} />
    </div>
  )
}
