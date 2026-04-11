import { useEffect, useState, useCallback, useRef } from 'react'
import { Plus, Globe, X, ChevronDown, Layers, Folder } from 'lucide-react'
import type { CollectedItemType } from '../../../../shared/types'
import { TYPE_ICONS, TYPE_LABELS } from './shared'

export const CollectPanel: React.FC<{ onClose: () => void; onCollected: () => void; groups: string[] }> = ({ onClose, onCollected, groups }) => {
  const [inputValue, setInputValue] = useState('')
  const [selectedGroup, setSelectedGroup] = useState('all')
  const [showGroupMenu, setShowGroupMenu] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [detected, setDetected] = useState<{ type: CollectedItemType; title: string; url?: string; domain?: string } | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const val = inputValue.trim()
    if (!val) { setDetected(null); return }
    try {
      const url = new URL(val)
      const domain = url.hostname.replace('www.', '')
      if (domain === 'twitter.com' || domain === 'x.com') {
        setDetected({ type: 'tweet', title: `Tweet from ${url.pathname.split('/')[1] || 'unknown'}`, url: val, domain })
        return
      }
      if (domain === 'youtube.com' || domain === 'youtu.be' || domain === 'bilibili.com') {
        setDetected({ type: 'video', title: 'Video', url: val, domain })
        return
      }
      setDetected({ type: 'link', title: domain, url: val, domain })
    } catch {
      setDetected({ type: 'text', title: val.split('\n')[0].slice(0, 120), url: undefined, domain: undefined })
    }
  }, [inputValue])

  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null)

  useEffect(() => {
    if (!detected?.url) { setDuplicateWarning(null); return }
    window.api.collector.checkDuplicate(detected.url).then((res) => {
      setDuplicateWarning(res.ok && res.data ? `Already collected as "${res.data.title}"` : null)
    }).catch(() => setDuplicateWarning(null))
  }, [detected?.url])

  const handleSubmit = useCallback(async () => {
    if (!detected || submitting) return
    setSubmitting(true)
    try {
      let title = detected.title
      let description = ''
      const meta: Record<string, unknown> = detected.domain ? { domain: detected.domain } : {}

      if (detected.url && (detected.type === 'link' || detected.type === 'tweet' || detected.type === 'video')) {
        try {
          const metaRes = await window.api.url.fetchMeta(detected.url)
          if (metaRes.ok && metaRes.data) {
            if (metaRes.data.title) title = metaRes.data.title
            if (metaRes.data.description) description = metaRes.data.description
            meta.description = metaRes.data.description || ''
            meta.ogImage = metaRes.data.image || ''
          }
        } catch {}
      }

      const addRes = await window.api.collector.add({
        type: detected.type, title, note: description, url: detected.url,
        group: selectedGroup, source: 'paste', meta,
      })
      onCollected()
      onClose()

      if (addRes.ok) {
        const itemId = addRes.data.id
        if (detected.url && (detected.type === 'link' || detected.type === 'tweet')) {
          window.api.collector.fetchMarkdown(itemId, detected.url)
            .then(() => window.api.collector.embedItem(itemId)).catch(() => {})
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
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh] bg-bg-app/60" onClick={onClose}>
      <div className="w-[400px] bg-bg-popover border border-border-strong rounded-xl shadow-2xl p-4 flex flex-col gap-3.5"
        onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="flex items-center justify-between">
          <span className="text-[14px] text-tx-main font-medium">Collect</span>
          <button onClick={onClose} aria-label="Close" className="text-tx-faint hover:text-tx-muted transition-colors p-0.5"><X size={14} /></button>
        </div>

        <div className={`rounded-md border ${detected ? 'border-accent-main' : 'border-border-subtle'} bg-bg-hover p-3 transition-colors`}>
          <textarea ref={inputRef} value={inputValue} onChange={(e) => setInputValue(e.target.value)}
            placeholder="Paste or type a URL, text, or drop an image here..." rows={3}
            className="w-full bg-transparent text-[12px] text-tx-main placeholder-tx-faint outline-none focus-visible:ring-1 focus-visible:ring-accent-main/50 resize-none" />
          {detected && (
            <div className="flex items-center gap-1.5 mt-1.5">
              {(() => { const Icon = TYPE_ICONS[detected.type]; return <Icon size={10} className="text-accent-main" /> })()}
              <span className="text-[10px] text-accent-main">{TYPE_LABELS[detected.type]} detected</span>
            </div>
          )}
        </div>

        {detected?.url && detected.domain && (
          <div className="flex items-center gap-2.5 p-2.5 bg-bg-active rounded-md">
            <div className="w-10 h-10 rounded bg-bg-sidebar flex items-center justify-center shrink-0">
              <Globe size={16} className="text-tx-faint" />
            </div>
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[12px] text-tx-main font-medium truncate">{detected.title}</span>
              <span className="text-[10px] text-tx-faint truncate">{detected.domain}</span>
            </div>
          </div>
        )}

        {duplicateWarning && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-status-warning/10 text-status-warning text-[11px]">
            <span>⚠</span><span>{duplicateWarning}</span>
          </div>
        )}

        <div className="flex items-center gap-2 relative">
          <span className="text-[11px] text-tx-faint">Add to:</span>
          <button onClick={() => setShowGroupMenu(!showGroupMenu)} aria-expanded={showGroupMenu} aria-haspopup="true"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-border-strong text-[11px] text-tx-muted">
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

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3.5 py-1.5 text-[12px] text-tx-muted rounded-md border border-border-strong hover:bg-bg-hover transition-colors">Cancel</button>
          <button onClick={handleSubmit} disabled={!detected || submitting}
            className="px-3.5 py-1.5 text-[12px] text-bg-app font-medium rounded-md bg-accent-main hover:opacity-90 transition-opacity flex items-center gap-1.5 disabled:opacity-40">
            <Plus size={12} />{submitting ? 'Saving...' : 'Collect'}
          </button>
        </div>
      </div>
    </div>
  )
}
