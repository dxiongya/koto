import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Link, Image, Video, Twitter, Monitor, Type, Globe, Play, X, ChevronDown, Layers, Folder } from 'lucide-react'
import { useUIStore } from '../../store/useUIStore'
import type { CollectedItem, CollectedItemType } from '../../../../shared/types'

const TYPE_ICONS: Record<CollectedItemType, React.FC<{ size?: number; className?: string }>> = {
  link: Link,
  image: Image,
  video: Video,
  tweet: Twitter,
  screenshot: Monitor,
  text: Type,
}

const TYPE_LABELS: Record<CollectedItemType, string> = {
  link: 'LINK',
  image: 'IMAGE',
  video: 'VIDEO',
  tweet: 'TWEET',
  screenshot: 'SCREENSHOT',
  text: 'TEXT',
}

// ── Collect Panel ──

const CollectPanel: React.FC<{ onClose: () => void; onCollected: () => void; groups: string[] }> = ({ onClose, onCollected, groups }) => {
  const [inputValue, setInputValue] = useState('')
  const [selectedGroup, setSelectedGroup] = useState('all')
  const [showGroupMenu, setShowGroupMenu] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [detected, setDetected] = useState<{ type: CollectedItemType; title: string; url?: string; domain?: string } | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Auto-detect type on input change
  useEffect(() => {
    const val = inputValue.trim()
    if (!val) { setDetected(null); return }

    // URL detection
    try {
      const url = new URL(val)
      const domain = url.hostname.replace('www.', '')

      // Tweet detection
      if (domain === 'twitter.com' || domain === 'x.com') {
        setDetected({ type: 'tweet', title: `Tweet from ${url.pathname.split('/')[1] || 'unknown'}`, url: val, domain })
        return
      }
      // Video detection
      if (domain === 'youtube.com' || domain === 'youtu.be' || domain === 'bilibili.com') {
        setDetected({ type: 'video', title: 'Video', url: val, domain })
        return
      }
      // Generic link
      setDetected({ type: 'link', title: domain, url: val, domain })
    } catch {
      // Plain text
      setDetected({ type: 'text', title: val.slice(0, 60), url: undefined, domain: undefined })
    }
  }, [inputValue])

  const handleSubmit = useCallback(async () => {
    if (!detected || submitting) return
    setSubmitting(true)
    try {
      let title = detected.title
      let description = ''
      let ogImage = ''
      const meta: Record<string, unknown> = detected.domain ? { domain: detected.domain } : {}

      // Fetch full meta for URL types
      if (detected.url && (detected.type === 'link' || detected.type === 'tweet' || detected.type === 'video')) {
        try {
          const metaRes = await window.api.url.fetchMeta(detected.url)
          if (metaRes.ok && metaRes.data) {
            if (metaRes.data.title) title = metaRes.data.title
            if (metaRes.data.description) description = metaRes.data.description
            if (metaRes.data.image) ogImage = metaRes.data.image
            meta.description = metaRes.data.description || ''
            meta.ogImage = metaRes.data.image || ''
          }
        } catch { /* use fallback */ }
      }

      const addRes = await window.api.collector.add({
        type: detected.type,
        title,
        note: description,
        url: detected.url,
        group: selectedGroup,
        source: 'paste',
        meta,
      })
      onCollected()
      onClose()

      // Fire-and-forget: fetch markdown for link types (for search/embedding later)
      if (addRes.ok && detected.url && (detected.type === 'link' || detected.type === 'tweet')) {
        window.api.collector.fetchMarkdown(addRes.data.id, detected.url).catch(() => {})
      }
    } finally {
      setSubmitting(false)
    }
  }, [detected, selectedGroup, submitting, onCollected, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'Enter' && e.metaKey && detected) { e.preventDefault(); handleSubmit() }
  }, [onClose, detected, handleSubmit])

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh] bg-black/40" onClick={onClose}>
      <div
        className="w-[400px] bg-bg-popover border border-border-strong rounded-xl shadow-2xl p-4 flex flex-col gap-3.5"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-[14px] text-tx-main font-medium">Collect</span>
          <button onClick={onClose} className="text-tx-faint hover:text-tx-muted transition-colors p-0.5">
            <X size={14} />
          </button>
        </div>

        {/* Input */}
        <div className={`rounded-md border ${detected ? 'border-accent-main' : 'border-border-subtle'} bg-bg-hover p-3 transition-colors`}>
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Paste or type a URL, text, or drop an image here..."
            rows={3}
            className="w-full bg-transparent text-[12px] text-tx-main placeholder-tx-faint outline-none resize-none"
          />
          {detected && (
            <div className="flex items-center gap-1.5 mt-1.5">
              {(() => { const Icon = TYPE_ICONS[detected.type]; return <Icon size={10} className="text-accent-main" /> })()}
              <span className="text-[10px] text-accent-main">{TYPE_LABELS[detected.type]} detected</span>
            </div>
          )}
        </div>

        {/* Preview for URL types */}
        {detected?.url && detected.domain && (
          <div className="flex items-center gap-2.5 p-2.5 bg-bg-active rounded-md">
            <div className="w-10 h-10 rounded bg-[#1a2332] flex items-center justify-center shrink-0">
              <Globe size={16} className="text-[#2a4a6b]" />
            </div>
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[12px] text-tx-main font-medium truncate">{detected.title}</span>
              <span className="text-[10px] text-tx-faint truncate">{detected.domain}</span>
            </div>
          </div>
        )}

        {/* Group select */}
        <div className="flex items-center gap-2 relative">
          <span className="text-[11px] text-tx-faint">Add to:</span>
          <button
            onClick={() => setShowGroupMenu(!showGroupMenu)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-border-strong text-[11px] text-tx-muted"
          >
            {selectedGroup === 'all' ? <Layers size={11} /> : <Folder size={11} />}
            {selectedGroup === 'all' ? 'All Items' : selectedGroup}
            <ChevronDown size={10} className="text-tx-faint" />
          </button>
          {showGroupMenu && (
            <div className="absolute top-full left-10 mt-1 bg-bg-sidebar border border-border-subtle rounded-md shadow-lg py-1 z-10 min-w-[120px]">
              <button onClick={() => { setSelectedGroup('all'); setShowGroupMenu(false) }}
                className="w-full text-left px-3 py-1.5 text-[11px] text-tx-muted hover:bg-bg-hover flex items-center gap-2">
                <Layers size={11} /> All Items
              </button>
              {groups.map((g) => (
                <button key={g} onClick={() => { setSelectedGroup(g); setShowGroupMenu(false) }}
                  className="w-full text-left px-3 py-1.5 text-[11px] text-tx-muted hover:bg-bg-hover flex items-center gap-2">
                  <Folder size={11} /> {g}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3.5 py-1.5 text-[12px] text-tx-muted rounded-md border border-border-strong hover:bg-bg-hover transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!detected || submitting}
            className="px-3.5 py-1.5 text-[12px] text-[#111] font-medium rounded-md bg-accent-main hover:opacity-90 transition-opacity flex items-center gap-1.5 disabled:opacity-40"
          >
            <Plus size={12} />
            {submitting ? 'Saving...' : 'Collect'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Item Card ──

const ItemCard: React.FC<{ item: CollectedItem; onDelete: (id: string) => void }> = ({ item, onDelete }) => {
  const Icon = TYPE_ICONS[item.type]
  const ogImage = item.meta?.ogImage as string | undefined
  const description = item.note || (item.meta?.description as string | undefined) || ''
  const domain = (() => { try { return item.url ? new URL(item.url).hostname.replace('www.', '') : '' } catch { return '' } })()

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-collector-item', item.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      className="group flex flex-col bg-bg-hover rounded-md border border-border-subtle overflow-hidden hover:border-border-strong transition-colors cursor-grab active:cursor-grabbing"
    >
      {/* Thumbnail area */}
      {item.type !== 'text' && (
        <div className="w-full h-[100px] bg-[#161616] flex items-center justify-center relative overflow-hidden">
          {ogImage ? (
            <img src={ogImage} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
          ) : (
            <>
              {item.type === 'link' && <Globe size={22} className="text-[#2a4a6b]" />}
              {item.type === 'tweet' && <Twitter size={22} className="text-[#1d9bf0]" />}
              {item.type === 'video' && (
                <div className="w-[30px] h-[30px] rounded-full bg-white/10 flex items-center justify-center">
                  <Play size={13} className="text-white/80" />
                </div>
              )}
              {item.type === 'screenshot' && <Monitor size={22} className="text-tx-faint" />}
              {item.type === 'image' && <Image size={22} className="text-tx-faint" />}
            </>
          )}
          {/* Delete on hover */}
          <button
            onClick={() => onDelete(item.id)}
            className="absolute top-1.5 right-1.5 p-1 rounded bg-black/40 text-tx-faint hover:text-tx-main opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X size={10} />
          </button>
        </div>
      )}
      {/* Body */}
      <div className={`p-2.5 flex flex-col gap-1 ${item.type === 'text' ? 'relative' : ''}`}>
        {/* Type + domain */}
        <div className="flex items-center gap-1.5">
          <Icon size={9} className="text-tx-faint shrink-0" />
          <span className="text-[9px] text-tx-faint tracking-wide">{TYPE_LABELS[item.type]}</span>
          {domain && (
            <>
              <span className="text-[9px] text-tx-faint">·</span>
              <span className="text-[9px] text-tx-faint truncate">{domain}</span>
            </>
          )}
        </div>
        {/* Title */}
        <span className="text-[12px] text-tx-main font-medium leading-snug line-clamp-2">{item.title}</span>
        {/* Description */}
        {description && (
          <span className="text-[10px] text-tx-faint leading-relaxed line-clamp-2">{description}</span>
        )}
        {/* Text type delete */}
        {item.type === 'text' && (
          <button
            onClick={() => onDelete(item.id)}
            className="absolute top-2 right-2 p-0.5 rounded text-tx-faint hover:text-tx-main opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X size={10} />
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main App ──

export const CollectorApp: React.FC = () => {
  const showCommandPalette = useUIStore((s) => s.showCommandPalette)
  const activeFilter = useUIStore((s) => s.appStates['collector.app'].activeFilePath) || 'all'
  const [items, setItems] = useState<CollectedItem[]>([])
  const [groups, setGroups] = useState<string[]>([])
  const [showCollectPanel, setShowCollectPanel] = useState(false)

  const blurClass = showCommandPalette
    ? 'opacity-50 transition-opacity duration-200'
    : 'transition-opacity duration-200'

  const loadItems = useCallback(async () => {
    const [itemsRes, groupsRes] = await Promise.all([
      window.api.collector.list(),
      window.api.collector.groups(),
    ])
    if (itemsRes.ok) setItems(itemsRes.data)
    if (groupsRes.ok) setGroups(groupsRes.data)
  }, [])

  useEffect(() => { loadItems() }, [loadItems])

  const handleDelete = useCallback(async (id: string) => {
    await window.api.collector.delete(id)
    loadItems()
  }, [loadItems])

  // Determine if activeFilter is a type or group
  const isTypeFilter = activeFilter in TYPE_LABELS
  const filteredItems = activeFilter === 'all'
    ? items
    : isTypeFilter
      ? items.filter((i) => i.type === activeFilter)
      : items.filter((i) => i.group === activeFilter)

  // Display name for header
  const filterLabel = activeFilter === 'all'
    ? 'All Items'
    : isTypeFilter
      ? TYPE_LABELS[activeFilter as CollectedItemType]
      : activeFilter

  return (
    <div className={`flex-1 flex flex-col p-8 pt-6 gap-5 overflow-hidden ${blurClass}`}>
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[15px] text-tx-main font-medium">{filterLabel}</span>
          <span className="text-[12px] text-tx-faint">{filteredItems.length}</span>
        </div>
        <button
          onClick={() => setShowCollectPanel(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-tx-muted border border-border-strong rounded-md hover:bg-bg-hover transition-colors"
        >
          <Plus size={12} />
          Collect
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto">
        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-tx-faint">
            <Layers size={28} />
            <span className="text-[13px]">No items yet</span>
            <button
              onClick={() => setShowCollectPanel(true)}
              className="text-[12px] text-accent-main hover:underline"
            >
              Collect your first item
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2.5 pb-4">
            {filteredItems.map((item) => (
              <ItemCard key={item.id} item={item} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>

      {/* Collect Panel — portaled to body to escape overflow clipping */}
      {showCollectPanel && createPortal(
        <CollectPanel
          onClose={() => setShowCollectPanel(false)}
          onCollected={loadItems}
          groups={groups}
        />,
        document.body,
      )}
    </div>
  )
}
