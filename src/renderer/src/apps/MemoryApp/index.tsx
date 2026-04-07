/**
 * Memory App — Human-readable view of AI memories.
 * Browse wings/rooms, view memories, see knowledge graph stats.
 */
import { useState, useEffect, useCallback } from 'react'
import { Brain, ChevronRight, ChevronDown, Trash2, Search, Network } from 'lucide-react'
import { useUIStore } from '../../store/useUIStore'

interface MemoryItem {
  id: string; wingId: string; roomId: string; content: string; summary: string;
  hall: string; importance: number; source: string; createdAt: number
}

interface TaxonomyWing {
  id: string; name: string; count: number
  rooms: { id: string; name: string; count: number }[]
}

export const MemoryApp: React.FC = () => {
  const [taxonomy, setTaxonomy] = useState<TaxonomyWing[]>([])
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [selectedWing, setSelectedWing] = useState<string | null>(null)
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null)
  const [expandedWings, setExpandedWings] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<MemoryItem[]>([])
  const [kgStats, setKgStats] = useState<{ entities: number; triples: number; activeFacts: number } | null>(null)
  const [identity, setIdentity] = useState('')
  const showCommandPalette = useUIStore((s) => s.showCommandPalette)

  const loadTaxonomy = useCallback(async () => {
    const res = await window.api.memory.taxonomy()
    if (res.ok) setTaxonomy(res.data.wings)
  }, [])

  const loadMemories = useCallback(async (wing?: string, room?: string) => {
    const res = await window.api.memory.list(wing || undefined, room || undefined, 100)
    if (res.ok) setMemories(res.data)
  }, [])

  const loadKgStats = useCallback(async () => {
    const res = await window.api.memory.kgStats()
    if (res.ok) setKgStats(res.data)
  }, [])

  useEffect(() => {
    loadTaxonomy()
    loadKgStats()
    window.api.memory.getContext().then((res: any) => {
      if (res.ok && res.data.identity) setIdentity(res.data.identity)
    })
  }, [])

  useEffect(() => {
    loadMemories(selectedWing || undefined, selectedRoom || undefined)
  }, [selectedWing, selectedRoom, loadMemories])

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) { setSearchResults([]); return }
    const res = await window.api.memory.search(searchQuery)
    if (res.ok) setSearchResults(res.data)
  }, [searchQuery])

  useEffect(() => {
    if (searchQuery.length >= 2) {
      const timer = setTimeout(handleSearch, 300)
      return () => clearTimeout(timer)
    }
    setSearchResults([])
  }, [searchQuery, handleSearch])

  const handleDelete = useCallback(async (id: string) => {
    await window.api.memory.delete(id)
    loadMemories(selectedWing || undefined, selectedRoom || undefined)
    loadTaxonomy()
  }, [selectedWing, selectedRoom, loadMemories, loadTaxonomy])

  const toggleWing = (wingId: string) => {
    setExpandedWings(prev => {
      const next = new Set(prev)
      if (next.has(wingId)) next.delete(wingId); else next.add(wingId)
      return next
    })
  }

  const displayMemories = searchQuery ? searchResults : memories
  const blurClass = showCommandPalette ? 'opacity-50' : ''

  return (
    <div className={`flex-1 flex overflow-hidden ${blurClass}`}>
      {/* Sidebar: Wing/Room tree */}
      <div className="w-[220px] shrink-0 border-r border-border-subtle overflow-y-auto py-3">
        {/* Identity */}
        {identity && (
          <div className="px-3 mb-3 pb-3 border-b border-border-subtle">
            <div className="text-[10px] text-tx-faint uppercase tracking-wider mb-1">Identity</div>
            <div className="text-[11px] text-tx-muted leading-relaxed">{identity.slice(0, 150)}</div>
          </div>
        )}

        {/* All memories */}
        <button
          onClick={() => { setSelectedWing(null); setSelectedRoom(null) }}
          className={`w-full px-3 py-1.5 text-left text-[13px] flex items-center gap-2 ${!selectedWing ? 'text-tx-active font-medium' : 'text-tx-main hover:bg-bg-hover'}`}
        >
          <Brain size={13} />
          <span>All Memories</span>
          <span className="ml-auto text-[11px] text-tx-faint">{taxonomy.reduce((a, w) => a + w.count, 0)}</span>
        </button>

        {/* Wings */}
        {taxonomy.map(wing => (
          <div key={wing.id}>
            <button
              onClick={() => { toggleWing(wing.id); setSelectedWing(wing.id); setSelectedRoom(null) }}
              className={`w-full px-3 py-1.5 text-left text-[13px] flex items-center gap-1.5 ${selectedWing === wing.id && !selectedRoom ? 'text-tx-active font-medium' : 'text-tx-main hover:bg-bg-hover'}`}
            >
              {expandedWings.has(wing.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span className="truncate flex-1">{wing.name}</span>
              <span className="text-[11px] text-tx-faint">{wing.count}</span>
            </button>
            {expandedWings.has(wing.id) && wing.rooms.map(room => (
              <button
                key={room.id}
                onClick={() => { setSelectedWing(wing.id); setSelectedRoom(room.id) }}
                className={`w-full pl-8 pr-3 py-1 text-left text-[12px] flex items-center gap-1.5 ${selectedRoom === room.id ? 'text-tx-active' : 'text-tx-muted hover:bg-bg-hover'}`}
              >
                <span className="truncate flex-1">{room.name}</span>
                <span className="text-[10px] text-tx-faint">{room.count}</span>
              </button>
            ))}
          </div>
        ))}

        {/* KG Stats */}
        {kgStats && kgStats.entities > 0 && (
          <div className="px-3 mt-3 pt-3 border-t border-border-subtle">
            <div className="flex items-center gap-1.5 text-[11px] text-tx-faint">
              <Network size={11} />
              <span>{kgStats.entities} entities · {kgStats.activeFacts} facts</span>
            </div>
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Search bar */}
        <div className="shrink-0 px-4 py-2 border-b border-border-subtle flex items-center gap-2">
          <Search size={13} className="text-tx-faint" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search memories..."
            className="flex-1 bg-transparent text-[13px] text-tx-main outline-none placeholder:text-tx-faint"
          />
          {selectedWing && !searchQuery && (
            <span className="text-[11px] text-tx-faint">{selectedWing}{selectedRoom ? ` / ${selectedRoom}` : ''}</span>
          )}
        </div>

        {/* Memory list */}
        <div className="flex-1 overflow-y-auto">
          {displayMemories.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-tx-faint text-sm gap-2">
              <Brain size={28} />
              <span>{searchQuery ? 'No results' : 'No memories yet'}</span>
              <span className="text-[11px]">AI stores memories via MCP tools</span>
            </div>
          ) : (
            <div className="py-2">
              {displayMemories.map(mem => (
                <div key={mem.id} className="group px-4 py-3 hover:bg-bg-hover border-b border-border-subtle/50">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] text-tx-faint bg-bg-hover px-1.5 py-0.5 rounded">{mem.hall}</span>
                    <span className="text-[10px] text-tx-faint">{mem.wingId} / {mem.roomId}</span>
                    {'★'.repeat(mem.importance)}{'☆'.repeat(5 - mem.importance)}
                    <span className="ml-auto text-[10px] text-tx-faint">{new Date(mem.createdAt).toLocaleString()}</span>
                    <button
                      onClick={() => handleDelete(mem.id)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-tx-faint hover:text-status-error"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                  {mem.summary && <div className="text-[12px] text-tx-active mb-1">{mem.summary}</div>}
                  <div className="text-[12px] text-tx-main leading-relaxed whitespace-pre-wrap">{mem.content}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
