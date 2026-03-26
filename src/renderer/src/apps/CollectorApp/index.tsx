import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Link, Image, Video, Twitter, Monitor, Type, Globe, Play, X, ChevronDown, Layers, Folder, Check, Loader2, Sparkles } from 'lucide-react'
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

      // Fire-and-forget: markdown + embedding
      if (addRes.ok) {
        const itemId = addRes.data.id
        if (detected.url && (detected.type === 'link' || detected.type === 'tweet')) {
          window.api.collector.fetchMarkdown(itemId, detected.url)
            .then(() => window.api.collector.embedItem(itemId))
            .catch(() => {})
        } else {
          window.api.collector.embedItem(itemId).catch(() => {})
        }
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
  // Resolve thumbnail: local asset or og:image
  const localAsset = item.assetPath ? `lite-asset://collected/${item.assetPath}` : null
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
          {localAsset ? (
            item.type === 'video' ? (
              <video src={localAsset} className="w-full h-full object-cover" muted />
            ) : (
              <img src={localAsset} alt="" className="w-full h-full object-cover" />
            )
          ) : ogImage ? (
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

// ── Collect Toast ──

interface ToastState {
  message: string
  status: 'loading' | 'success' | 'error'
}

const CollectToast: React.FC<{ toast: ToastState; onDone: () => void }> = ({ toast, onDone }) => {
  useEffect(() => {
    if (toast.status !== 'loading') {
      const t = setTimeout(onDone, 2000)
      return () => clearTimeout(t)
    }
  }, [toast.status, onDone])

  return (
    <div
      className="fixed bottom-6 right-6 z-[9999] flex items-center gap-2.5 px-4 py-2.5 bg-bg-popover border border-border-strong rounded-lg shadow-xl"
      style={{ animation: 'toast-in 0.2s ease' }}
    >
      {toast.status === 'loading' && <Loader2 size={14} className="text-accent-main animate-spin" />}
      {toast.status === 'success' && <Check size={14} className="text-status-success" />}
      {toast.status === 'error' && <X size={14} className="text-status-error" />}
      <span className="text-[12px] text-tx-main">{toast.message}</span>
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
  const [toast, setToast] = useState<ToastState | null>(null)
  const [hasEmbeddingKey, setHasEmbeddingKey] = useState(true) // assume true until checked

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

  const [isDragOver, setIsDragOver] = useState(false)

  useEffect(() => { loadItems() }, [loadItems, activeFilter])

  // Check embedding key status
  useEffect(() => {
    window.api.collector.getEmbeddingKey().then((res) => {
      setHasEmbeddingKey(res.ok && !!res.data)
    })
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    await window.api.collector.delete(id)
    loadItems()
  }, [loadItems])

  // Quick collect: auto-detect type and collect immediately
  const quickCollect = useCallback(async (input: string) => {
    const val = input.trim()
    if (!val) return

    let type: CollectedItemType = 'text'
    let url: string | undefined
    let domain = ''

    try {
      const parsed = new URL(val)
      domain = parsed.hostname.replace('www.', '')
      url = val
      if (domain === 'twitter.com' || domain === 'x.com') type = 'tweet'
      else if (domain === 'youtube.com' || domain === 'youtu.be' || domain === 'bilibili.com') type = 'video'
      else type = 'link'
    } catch { /* plain text */ }

    const typeLabel = TYPE_LABELS[type]

    // Show toast
    if (url) {
      setToast({ message: `Collecting ${typeLabel.toLowerCase()} · ${domain}...`, status: 'loading' })
    } else {
      setToast({ message: 'Collecting text...', status: 'loading' })
    }

    // Fetch meta for URLs
    let title = type === 'text' ? val.slice(0, 80) : domain
    let description = ''
    const meta: Record<string, unknown> = domain ? { domain } : {}

    if (url) {
      setToast({ message: `Fetching page info · ${domain}...`, status: 'loading' })
      try {
        const metaRes = await window.api.url.fetchMeta(url)
        if (metaRes.ok && metaRes.data) {
          if (metaRes.data.title) title = metaRes.data.title
          if (metaRes.data.description) { description = metaRes.data.description; meta.description = description }
          if (metaRes.data.image) meta.ogImage = metaRes.data.image
        }
      } catch {}
    }

    const addRes = await window.api.collector.add({
      type, title, note: description, url,
      group: activeFilter !== 'all' && !(activeFilter in TYPE_LABELS) ? activeFilter : 'all',
      source: 'paste', meta,
    })
    loadItems()

    if (addRes.ok) {
      setToast({ message: `Collected · ${title.slice(0, 40)}${title.length > 40 ? '...' : ''}`, status: 'success' })
      // Fire-and-forget: markdown extraction + embedding
      const itemId = addRes.data.id
      if (url && (type === 'link' || type === 'tweet')) {
        window.api.collector.fetchMarkdown(itemId, url)
          .then(() => window.api.collector.embedItem(itemId))
          .catch(() => {})
      } else {
        window.api.collector.embedItem(itemId).catch(() => {})
      }
    } else {
      setToast({ message: 'Failed to collect', status: 'error' })
    }
  }, [activeFilter, loadItems])

  // Quick collect file (image, video, etc.)
  const quickCollectFile = useCallback(async (file: File) => {
    const mime = file.type
    let type: CollectedItemType = 'image'
    if (mime.startsWith('video/')) type = 'video'
    else if (mime.startsWith('image/')) type = file.name.toLowerCase().includes('screenshot') ? 'screenshot' : 'image'
    else return // unsupported file type

    const label = type === 'video' ? 'video' : 'image'
    setToast({ message: `Collecting ${label} · ${file.name}...`, status: 'loading' })

    try {
      const buffer = await file.arrayBuffer()
      const title = file.name.replace(/\.[^.]+$/, '') || `${type} ${new Date().toLocaleString()}`
      const targetGroup = activeFilter !== 'all' && !(activeFilter in TYPE_LABELS) ? activeFilter : 'all'

      const addRes = await window.api.collector.add({
        type,
        title,
        group: targetGroup,
        source: 'paste',
        assetData: buffer,
        assetMimeType: mime,
      })
      loadItems()

      if (addRes.ok) {
        setToast({ message: `Collected · ${title.slice(0, 40)}`, status: 'success' })
        // Fire-and-forget embedding (multimodal for images)
        window.api.collector.embedItem(addRes.data.id).catch(() => {})
      } else {
        setToast({ message: 'Failed to collect file', status: 'error' })
      }
    } catch {
      setToast({ message: 'Failed to collect file', status: 'error' })
    }
  }, [activeFilter, loadItems])

  // Paste handler: Cmd+V — images, files, or text/URL
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent): void => {
      const tag = (document.activeElement as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      // Check for files (images from clipboard)
      const files = e.clipboardData?.files
      if (files && files.length > 0) {
        e.preventDefault()
        for (const file of Array.from(files)) {
          if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
            quickCollectFile(file)
          }
        }
        return
      }

      // Fallback: text/URL
      const text = e.clipboardData?.getData('text/plain')?.trim()
      if (text) {
        e.preventDefault()
        quickCollect(text)
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [quickCollect, quickCollectFile])

  // Drop handler — files or text/URL
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.types.includes('application/x-collector-item')) return

    // Check for dropped files
    if (e.dataTransfer.files.length > 0) {
      for (const file of Array.from(e.dataTransfer.files)) {
        if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
          quickCollectFile(file)
        }
      }
      return
    }

    // Text/URL
    const text = e.dataTransfer.getData('text/plain')?.trim() || e.dataTransfer.getData('text/uri-list')?.trim()
    if (text) quickCollect(text)
  }, [quickCollect, quickCollectFile])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-collector-item')) return
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => setIsDragOver(false), [])

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
    <div
      className={`flex-1 flex flex-col p-8 pt-6 gap-5 overflow-hidden relative ${blurClass}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Drag overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-bg-app/80 border-2 border-dashed border-accent-main/40 rounded-lg pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-accent-main">
            <Plus size={24} />
            <span className="text-[13px] font-medium">Drop to collect</span>
          </div>
        </div>
      )}
      {/* Embedding hint — link to Settings */}
      {!hasEmbeddingKey && (
        <button
          onClick={() => useUIStore.getState().setCurrentApp('settings.app')}
          className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-md border border-border-subtle bg-bg-hover text-[11px] text-tx-faint hover:text-tx-muted hover:border-border-strong transition-colors"
        >
          <Sparkles size={12} className="text-accent-main" />
          <span>Configure Gemini API key in Settings for semantic search</span>
        </button>
      )}

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

      {/* Toast */}
      {toast && <CollectToast toast={toast} onDone={() => setToast(null)} />}
    </div>
  )
}
