import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Plus, X, Layers, Loader2, Sparkles, LayoutGrid, List, BookOpen, Search } from 'lucide-react'
import { useUIStore } from '../../store/useUIStore'
import type { CollectedItem, CollectedItemType } from '../../../../shared/types'
import { TYPE_ICONS, TYPE_LABELS, type ToastState } from './shared'
import { CollectPanel } from './CollectPanel'
import { ItemCard } from './ItemCard'
import { ItemListRow } from './ItemListRow'
import { FeedItem } from './FeedItem'
import { CollectToast } from './CollectToast'
import { DetailPanel } from './DetailPanel'

const PAGE_SIZE = 50

export const CollectorApp: React.FC = () => {
  const showCommandPalette = useUIStore((s) => s.showCommandPalette)
  const activeFilter = useUIStore((s) => s.appStates['collector.app'].activeFilePath) || 'all'
  const collectorVersion = useUIStore((s) => s.collectorVersion)
  const bumpVersion = useUIStore((s) => s.bumpCollectorVersion)
  const [items, setItems] = useState<CollectedItem[]>([])
  const [groups, setGroups] = useState<string[]>([])
  const [showCollectPanel, setShowCollectPanel] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [hasEmbeddingKey, setHasEmbeddingKey] = useState(true)
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'feed'>('grid')
  const [typeFilter, setTypeFilter] = useState<CollectedItemType | 'all'>('all')
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [detailItem, setDetailItem] = useState<CollectedItem | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<CollectedItem[] | null>(null)
  const [searching, setSearching] = useState(false)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  const blurClass = showCommandPalette ? 'opacity-50 transition-opacity duration-200' : 'transition-opacity duration-200'

  // ── Data loading ──

  // Server-side group filtering — load only items for the active group
  const groupParam = activeFilter !== 'all' && !(['link','image','video','tweet','text','screenshot'].includes(activeFilter)) ? activeFilter : undefined

  const loadItems = useCallback(async () => {
    const [itemsRes, groupsRes, countRes] = await Promise.all([
      window.api.collector.list(PAGE_SIZE, 0, groupParam),
      window.api.collector.groups(),
      window.api.collector.count(groupParam),
    ])
    if (itemsRes.ok) { setItems(itemsRes.data); setHasMore(itemsRes.data.length >= PAGE_SIZE) }
    if (groupsRes.ok) setGroups(groupsRes.data)
    if (countRes.ok) setTotalCount(countRes.data)
  }, [groupParam])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    const res = await window.api.collector.list(PAGE_SIZE, items.length, groupParam)
    if (res.ok) { setItems((prev) => [...prev, ...res.data]); setHasMore(res.data.length >= PAGE_SIZE) }
    setLoadingMore(false)
  }, [items.length, loadingMore, hasMore, groupParam])

  useEffect(() => { loadItems() }, [loadItems, activeFilter, collectorVersion])

  const loadMoreRef = useRef(loadMore)
  loadMoreRef.current = loadMore

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const handleScroll = (): void => { if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) loadMoreRef.current() }
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    window.api.collector.getEmbeddingKey().then((res) => { setHasEmbeddingKey(res.ok && !!res.data) })
  }, [])

  // ── Search ──

  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults(null); setSearching(false); return }
    setSearching(true)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(async () => {
      const res = await window.api.collector.search(searchQuery.trim())
      if (res.ok) setSearchResults(res.data.map((r: { item: CollectedItem }) => r.item))
      setSearching(false)
    }, 300)
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
  }, [searchQuery])

  // ── Actions ──

  const handleDelete = useCallback(async (id: string) => {
    await window.api.collector.delete(id)
    bumpVersion()
  }, [bumpVersion])

  const handleOpen = useCallback((item: CollectedItem) => {
    setDetailItem(item)
  }, [])

  const handleOpenExternal = useCallback((item: CollectedItem) => {
    if (item.url) window.api.shell.openExternal(item.url)
    else if (item.assetPath) setPreviewImage(`lite-asset://collected/${item.assetPath}`)
  }, [])

  // ── Quick collect (paste/drop) ──

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
    } catch {}

    let duplicateOf: string | undefined
    if (url) {
      try { const dupRes = await window.api.collector.checkDuplicate(url); if (dupRes.ok && dupRes.data) duplicateOf = dupRes.data.id } catch {}
    }

    setToast({ message: url ? `Collecting ${TYPE_LABELS[type].toLowerCase()} · ${domain}...` : 'Collecting text...', status: 'loading' })

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

    if (duplicateOf) meta.duplicateOf = duplicateOf

    const addRes = await window.api.collector.add({
      type, title, note: description, url,
      group: activeFilter !== 'all' && !(activeFilter in TYPE_LABELS) ? activeFilter : 'all',
      source: 'paste', meta,
    })
    bumpVersion()

    if (addRes.ok && duplicateOf) {
      setToast({ message: `Collected (duplicate) · ${title.slice(0, 35)}`, status: 'success' })
    } else if (addRes.ok) {
      setToast({ message: `Collected · ${title.slice(0, 40)}${title.length > 40 ? '...' : ''}`, status: 'success' })
      const itemId = addRes.data.id
      if (url && (type === 'link' || type === 'tweet')) {
        window.api.collector.fetchMarkdown(itemId, url).then(() => window.api.collector.embedItem(itemId)).catch(() => {})
      } else {
        window.api.collector.embedItem(itemId).catch(() => {})
      }
    } else {
      setToast({ message: 'Failed to collect', status: 'error' })
    }
  }, [activeFilter, bumpVersion])

  const quickCollectFile = useCallback(async (file: File) => {
    const mime = file.type
    let type: CollectedItemType = 'image'
    if (mime.startsWith('video/')) type = 'video'
    else if (mime.startsWith('image/')) type = file.name.toLowerCase().includes('screenshot') ? 'screenshot' : 'image'
    else return

    setToast({ message: `Collecting ${type === 'video' ? 'video' : 'image'} · ${file.name}...`, status: 'loading' })
    try {
      const buffer = await file.arrayBuffer()
      const dupMeta: Record<string, unknown> = {}
      try { const dupRes = await window.api.collector.checkDuplicateHash(buffer); if (dupRes.ok && dupRes.data) dupMeta.duplicateOf = dupRes.data.id } catch {}

      const title = file.name.replace(/\.[^.]+$/, '') || `${type} ${new Date().toLocaleString()}`
      const addRes = await window.api.collector.add({
        type, title,
        group: activeFilter !== 'all' && !(activeFilter in TYPE_LABELS) ? activeFilter : 'all',
        source: 'paste', assetData: buffer, assetMimeType: mime,
        meta: Object.keys(dupMeta).length > 0 ? dupMeta : undefined,
      })
      bumpVersion()

      if (addRes.ok && dupMeta.duplicateOf) setToast({ message: `Collected (duplicate) · ${title.slice(0, 35)}`, status: 'success' })
      else if (addRes.ok) { setToast({ message: `Collected · ${title.slice(0, 40)}`, status: 'success' }); window.api.collector.embedItem(addRes.data.id).catch(() => {}) }
      else setToast({ message: 'Failed to collect file', status: 'error' })
    } catch {
      setToast({ message: 'Failed to collect file', status: 'error' })
    }
  }, [activeFilter, bumpVersion])

  // ── Paste & Drop ──

  const quickCollectRef = useRef(quickCollect)
  quickCollectRef.current = quickCollect
  const quickCollectFileRef = useRef(quickCollectFile)
  quickCollectFileRef.current = quickCollectFile

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent): void => {
      const tag = (document.activeElement as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const files = e.clipboardData?.files
      if (files && files.length > 0) {
        e.preventDefault()
        for (const file of Array.from(files)) { if (file.type.startsWith('image/') || file.type.startsWith('video/')) quickCollectFileRef.current(file) }
        return
      }
      const text = e.clipboardData?.getData('text/plain')?.trim()
      if (text) { e.preventDefault(); quickCollectRef.current(text) }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragOver(false)
    if (e.dataTransfer.types.includes('application/x-collector-item')) return
    if (e.dataTransfer.files.length > 0) {
      for (const file of Array.from(e.dataTransfer.files)) { if (file.type.startsWith('image/') || file.type.startsWith('video/')) quickCollectFileRef.current(file) }
      return
    }
    const text = e.dataTransfer.getData('text/plain')?.trim() || e.dataTransfer.getData('text/uri-list')?.trim()
    if (text) quickCollectRef.current(text)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-collector-item')) return
    e.preventDefault(); setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => setIsDragOver(false), [])

  // ── Filtering ──

  // Group filtering is now server-side. Only type filtering done client-side.
  const groupFiltered = items
  const typeFiltered = typeFilter === 'all' ? groupFiltered : groupFiltered.filter((i) => i.type === typeFilter)
  const filteredItems = searchResults !== null ? searchResults : typeFiltered
  const filterLabel = activeFilter === 'all' ? 'All Items' : activeFilter

  const typeCounts = useMemo(() => {
    const counts: Partial<Record<CollectedItemType, number>> = {}
    for (const item of groupFiltered) counts[item.type] = (counts[item.type] || 0) + 1
    return counts
  }, [groupFiltered])

  // ── Render ──

  return (
    <div className={`flex-1 flex flex-col p-8 pt-6 gap-5 overflow-hidden relative ${blurClass}`}
      onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}>

      {isDragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-bg-app/80 border-2 border-dashed border-accent-main/40 rounded-lg pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-accent-main"><Plus size={24} /><span className="text-[13px] font-medium">Drop to collect</span></div>
        </div>
      )}

      {!hasEmbeddingKey && (
        <button onClick={() => useUIStore.getState().setCurrentApp('settings.app')}
          className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-md border border-border-subtle bg-bg-hover text-[11px] text-tx-faint hover:text-tx-muted hover:border-border-strong transition-colors">
          <Sparkles size={12} className="text-accent-main" /><span>Configure Gemini API key in Settings for semantic search</span>
        </button>
      )}

      {/* Search + Header */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[15px] text-tx-main font-medium shrink-0">{searchResults !== null ? 'Search' : filterLabel}</span>
          <span className="text-[12px] text-tx-faint shrink-0">{filteredItems.length}</span>
        </div>
        <div className="flex-1 max-w-[280px]">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-bg-hover border border-border-subtle focus-within:border-accent-main/40 transition-colors">
            <Search size={12} className={searching ? 'text-accent-main animate-pulse' : 'text-tx-faint'} />
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search..."
              className="flex-1 bg-transparent text-[12px] text-tx-main outline-none placeholder-tx-faint" />
            {searchQuery && <button onClick={() => { setSearchQuery(''); setSearchResults(null) }} aria-label="Clear search" className="text-tx-faint hover:text-tx-main"><X size={11} /></button>}
          </div>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <div className="flex items-center border border-border-strong rounded-md overflow-hidden">
            <button onClick={() => setViewMode('grid')} aria-label="Grid view" className={`p-1.5 transition-colors ${viewMode === 'grid' ? 'bg-bg-active text-tx-main' : 'text-tx-faint hover:text-tx-muted'}`}><LayoutGrid size={13} /></button>
            <button onClick={() => setViewMode('list')} aria-label="List view" className={`p-1.5 transition-colors ${viewMode === 'list' ? 'bg-bg-active text-tx-main' : 'text-tx-faint hover:text-tx-muted'}`}><List size={13} /></button>
            <button onClick={() => setViewMode('feed')} aria-label="Feed view" className={`p-1.5 transition-colors ${viewMode === 'feed' ? 'bg-bg-active text-tx-main' : 'text-tx-faint hover:text-tx-muted'}`}><BookOpen size={13} /></button>
          </div>
          <button onClick={() => setShowCollectPanel(true)} className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-tx-muted border border-border-strong rounded-md hover:bg-bg-hover transition-colors">
            <Plus size={12} />Collect
          </button>
        </div>
      </div>

      {/* Type filter chips */}
      {Object.keys(typeCounts).length > 1 && (
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          <button onClick={() => setTypeFilter('all')} className={`px-2.5 py-1 text-[11px] rounded-md transition-colors ${typeFilter === 'all' ? 'bg-accent-main text-bg-app font-medium' : 'text-tx-muted border border-border-strong hover:bg-bg-hover'}`}>
            All {groupFiltered.length}
          </button>
          {(Object.entries(typeCounts) as [CollectedItemType, number][]).map(([t, count]) => {
            const Icon = TYPE_ICONS[t]
            return (
              <button key={t} onClick={() => setTypeFilter(typeFilter === t ? 'all' : t)}
                className={`px-2.5 py-1 text-[11px] rounded-md flex items-center gap-1.5 transition-colors ${typeFilter === t ? 'bg-accent-main text-bg-app font-medium' : 'text-tx-muted border border-border-strong hover:bg-bg-hover'}`}>
                <Icon size={11} />{TYPE_LABELS[t]} {count}
              </button>
            )
          })}
        </div>
      )}

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-tx-faint">
            <Layers size={28} />
            <span className="text-[13px]">{searchResults !== null ? 'No results found' : 'No items yet'}</span>
            {searchResults === null && <button onClick={() => setShowCollectPanel(true)} className="text-[12px] text-accent-main hover:underline">Collect your first item</button>}
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-4 gap-2.5 pb-4">
            {filteredItems.map((item) => <ItemCard key={item.id} item={item} onDelete={handleDelete} onOpen={handleOpen} />)}
          </div>
        ) : viewMode === 'list' ? (
          <div className="flex flex-col gap-px pb-4">
            {filteredItems.map((item) => <ItemListRow key={item.id} item={item} onDelete={handleDelete} onOpen={handleOpen} />)}
          </div>
        ) : (
          <div className="flex flex-col gap-6 pb-8 max-w-[640px] mx-auto w-full">
            {filteredItems.map((item) => <FeedItem key={item.id} item={item} onDelete={handleDelete} onOpen={handleOpen} />)}
          </div>
        )}
        {loadingMore && <div className="flex justify-center py-4"><Loader2 size={16} className="text-tx-faint animate-spin" /></div>}
        {!hasMore && filteredItems.length > PAGE_SIZE && <div className="text-center py-3 text-[11px] text-tx-faint">All {totalCount} items loaded</div>}
      </div>

      {showCollectPanel && createPortal(<CollectPanel onClose={() => setShowCollectPanel(false)} onCollected={bumpVersion} groups={groups} />, document.body)}
      {toast && <CollectToast toast={toast} onDone={() => setToast(null)} />}
      {previewImage && createPortal(
        <div className="fixed inset-0 z-[9999] bg-bg-app/90 flex items-center justify-center cursor-pointer" onClick={() => setPreviewImage(null)}>
          <button onClick={() => setPreviewImage(null)} aria-label="Close" className="absolute top-4 right-4 p-2 text-tx-main/60 hover:text-tx-main transition-colors"><X size={20} /></button>
          <img src={previewImage} alt="" className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
        </div>, document.body
      )}
      {detailItem && createPortal(
        <DetailPanel item={detailItem} onClose={() => setDetailItem(null)} onOpenExternal={handleOpenExternal} />,
        document.body
      )}
    </div>
  )
}
