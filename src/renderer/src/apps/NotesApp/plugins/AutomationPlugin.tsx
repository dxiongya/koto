/**
 * AutomationPlugin — Persistent automation badges on tables/headings,
 * right-click "Automate with AI", and scroll-to from Settings.
 */
import { useEffect, useState, useRef, useCallback, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
} from 'lexical'
import {
  $isTableNode,
  $isTableRowNode,
  $isTableCellNode,
  $findTableNode,
} from '@lexical/table'
import { $isHeadingNode } from '@lexical/rich-text'
import { Zap, X, Loader2, Send, CheckCircle2, AlertCircle, RotateCcw, Brain } from 'lucide-react'
import { showContextMenu } from '../../../components/ContextMenu'
import { useUIStore } from '../../../store/useUIStore'
import type { Automation, AutomationSnapshot, AutomationTargetType, AutomationInterval } from '../../../../../shared/types'

const INTERVAL_OPTIONS: Array<{ value: AutomationInterval; label: string }> = [
  { value: 5, label: '5 min' },
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: 360, label: '6 hours' },
  { value: 720, label: '12 hours' },
  { value: 1440, label: '24 hours' },
]

const INTERVAL_SHORT: Record<number, string> = {
  5: '5m', 15: '15m', 30: '30m', 60: '1h', 360: '6h', 720: '12h', 1440: '24h',
}

interface AutomationTarget {
  type: AutomationTargetType
  identifier: string
  displayLabel: string
}

// ── Badge tracking ──

interface BadgeInfo {
  key: string
  type: 'table' | 'section'
  automation: Automation
  rect: DOMRect
}

function formatTime(ts: number | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function timeAgo(ts: number | null): string {
  if (!ts) return 'never'
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
  return `${Math.floor(diff / 86400_000)}d ago`
}

export function AutomationPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const [showDialog, setShowDialog] = useState(false)
  const [target, setTarget] = useState<AutomationTarget | null>(null)
  const [badges, setBadges] = useState<BadgeInfo[]>([])
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafRef = useRef(0)

  const handleMouseEnter = useCallback((id: string) => {
    if (hoverTimeoutRef.current) { clearTimeout(hoverTimeoutRef.current); hoverTimeoutRef.current = null }
    setHoveredId(id)
  }, [])

  const handleMouseLeave = useCallback(() => {
    hoverTimeoutRef.current = setTimeout(() => setHoveredId(null), 300)
  }, [])

  // ── Scan editor for matching nodes and compute rects ──
  const computeBadges = useCallback((automations: Automation[]) => {
    if (automations.length === 0) { setBadges([]); return }

    editor.getEditorState().read(() => {
      const newBadges: BadgeInfo[] = []
      const root = $getRoot()

      for (const node of root.getChildren()) {
        if ($isTableNode(node)) {
          const rows = node.getChildren()
          if (rows.length === 0) continue
          const firstRow = rows[0]
          if (!$isTableRowNode(firstRow)) continue
          const headers = firstRow.getChildren()
            .filter($isTableCellNode)
            .map(cell => cell.getTextContent().trim())

          const match = automations.find(a => {
            if (a.target.type !== 'table' || !a.target.tableIdentifier) return false
            const autoCells = a.target.tableIdentifier.toLowerCase().split('|').map(h => h.trim())
            const nodeCells = headers.map(h => h.toLowerCase())
            return autoCells.every(ac => nodeCells.some(nc => nc.includes(ac)))
          })

          if (match) {
            const elem = editor.getElementByKey(node.getKey())
            if (elem) {
              newBadges.push({ key: node.getKey(), type: 'table', automation: match, rect: elem.getBoundingClientRect() })
            }
          }
        }

        if ($isHeadingNode(node)) {
          const text = node.getTextContent().trim()
          const match = automations.find(a => {
            if (a.target.type !== 'section' || !a.target.sectionHeading) return false
            return a.target.sectionHeading.trim().replace(/^#+\s*/, '') === text
          })

          if (match) {
            const elem = editor.getElementByKey(node.getKey())
            if (elem) {
              newBadges.push({ key: node.getKey(), type: 'section', automation: match, rect: elem.getBoundingClientRect() })
            }
          }
        }
      }
      setBadges(newBadges)
    })
  }, [editor])

  // ── Load automations and refresh badges ──
  useEffect(() => {
    const activeFilePath = useUIStore.getState().appStates['notes.app'].activeFilePath
    if (!activeFilePath) { setBadges([]); return }

    let cancelled = false
    let cachedAutomations: Automation[] = []

    const loadAndCompute = (): void => {
      window.api.automation.list().then(res => {
        if (cancelled || !res.ok) return
        cachedAutomations = res.data.filter(a => a.target.filePath === activeFilePath)
        computeBadges(cachedAutomations)
      })
    }

    const recomputePositions = (): void => {
      computeBadges(cachedAutomations)
    }

    loadAndCompute()

    // Refresh data on automation events
    const unsub = window.api.automation.onRunEvent(() => {
      setTimeout(loadAndCompute, 400)
    })

    // Recompute positions on editor changes
    let timer: ReturnType<typeof setTimeout>
    const unregister = editor.registerUpdateListener(() => {
      clearTimeout(timer)
      timer = setTimeout(recomputePositions, 200)
    })

    // Recompute on scroll/resize
    const scrollParent = editor.getRootElement()?.closest('.overflow-y-auto') as HTMLElement | null
    const onScroll = (): void => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(recomputePositions)
    }
    scrollParent?.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', recomputePositions)

    return () => {
      cancelled = true
      clearTimeout(timer)
      cancelAnimationFrame(rafRef.current)
      unregister()
      unsub()
      scrollParent?.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', recomputePositions)
    }
  }, [editor, computeBadges])

  // ── Listen for scroll-to events from Settings ──
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent).detail as { targetType: string; identifier: string }
      if (!detail) return

      editor.getEditorState().read(() => {
        const root = $getRoot()

        if (detail.targetType === 'table' && detail.identifier) {
          const targetHeaders = detail.identifier.toLowerCase().split('|').map(h => h.trim())
          for (const node of root.getChildren()) {
            if (!$isTableNode(node)) continue
            const rows = node.getChildren()
            if (rows.length === 0) continue
            const firstRow = rows[0]
            if (!$isTableRowNode(firstRow)) continue
            const headers = firstRow.getChildren()
              .filter($isTableCellNode)
              .map(cell => cell.getTextContent().trim().toLowerCase())
            if (targetHeaders.every(th => headers.some(h => h.includes(th)))) {
              const elem = editor.getElementByKey(node.getKey())
              elem?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              elem?.classList.add('ring-2', 'ring-orange-400/50', 'rounded')
              setTimeout(() => elem?.classList.remove('ring-2', 'ring-orange-400/50', 'rounded'), 2000)
              return
            }
          }
        }

        if (detail.targetType === 'section' && detail.identifier) {
          const normalizedTarget = detail.identifier.trim().replace(/^#+\s*/, '')
          for (const node of root.getChildren()) {
            if (!$isHeadingNode(node)) continue
            if (node.getTextContent().trim() === normalizedTarget) {
              const elem = editor.getElementByKey(node.getKey())
              elem?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              elem?.classList.add('ring-2', 'ring-orange-400/50', 'rounded')
              setTimeout(() => elem?.classList.remove('ring-2', 'ring-orange-400/50', 'rounded'), 2000)
              return
            }
          }
        }
      })
    }
    window.addEventListener('automation:scrollTo', handler)
    return () => window.removeEventListener('automation:scrollTo', handler)
  }, [editor])

  // ── Context menu ──
  useEffect(() => {
    const rootElem = editor.getRootElement()
    if (!rootElem) return

    const handleContextMenu = (e: MouseEvent): void => {
      editor.getEditorState().read(() => {
        const sel = $getSelection()
        if (!$isRangeSelection(sel)) return
        const anchor = sel.anchor.getNode()

        const tableNode = $findTableNode(anchor)
        if (tableNode && $isTableNode(tableNode)) {
          const rows = tableNode.getChildren()
          if (rows.length > 0) {
            const firstRow = rows[0]
            if ($isTableRowNode(firstRow)) {
              const headers = firstRow.getChildren()
                .filter($isTableCellNode)
                .map(cell => cell.getTextContent().trim())
                .join('|')
              setTimeout(() => {
                showContextMenu(e.clientX, e.clientY, [{
                  label: 'Automate with AI',
                  icon: <Zap size={12} />,
                  onClick: () => {
                    setTarget({ type: 'table', identifier: headers, displayLabel: `Table: ${headers.split('|').slice(0, 3).join(', ')}...` })
                    setShowDialog(true)
                  },
                }])
              }, 0)
              return
            }
          }
        }

        let node = anchor
        while (node) {
          if ($isHeadingNode(node)) {
            const tag = node.getTag()
            const text = node.getTextContent().trim()
            const level = parseInt(tag.replace('h', ''))
            const heading = '#'.repeat(level) + ' ' + text
            setTimeout(() => {
              showContextMenu(e.clientX, e.clientY, [{
                label: 'Automate with AI',
                icon: <Zap size={12} />,
                onClick: () => {
                  setTarget({ type: 'section', identifier: heading, displayLabel: `Section: ${text}` })
                  setShowDialog(true)
                },
              }])
            }, 0)
            return
          }
          const parent = node.getParent()
          if (!parent) break
          node = parent
        }
      })
    }

    rootElem.addEventListener('contextmenu', handleContextMenu)
    return () => rootElem.removeEventListener('contextmenu', handleContextMenu)
  }, [editor])

  // ── Render ──

  return (
    <>
      {/* Fixed-position badges */}
      {badges.length > 0 && createPortal(
        <>
          {badges.map(badge => {
            const a = badge.automation
            const { rect } = badge

            // Top-right corner for tables; after text for headings
            const badgeW = 120
            const top = badge.type === 'table' ? rect.top - 14 : rect.top + (rect.height - 20) / 2
            const left = badge.type === 'table' ? rect.right - badgeW - 4 : rect.right + 8

            // Clamp to viewport
            const vw = document.documentElement.clientWidth
            const clampedLeft = Math.min(left, vw - badgeW - 16)

            return (
              <div
                key={badge.key}
                style={{ position: 'fixed', top, left: clampedLeft, zIndex: 50 }}
                onMouseEnter={() => handleMouseEnter(a.id)}
                onMouseLeave={handleMouseLeave}
              >
                {/* Badge pill */}
                <div className={`inline-flex items-center gap-1 px-2 py-[2px] rounded text-[9px] cursor-default select-none
                  border transition-colors
                  ${a.enabled
                    ? 'bg-bg-popover text-tx-muted border-border-subtle hover:border-orange-400/40'
                    : 'bg-bg-hover text-tx-faint border-border-subtle opacity-60'
                  }`}
                >
                  <Zap size={8} className={a.enabled ? 'text-status-warning' : 'text-tx-faint'} />
                  <span>{INTERVAL_SHORT[a.interval] ?? a.interval + 'm'}</span>
                  <span className="text-tx-faint">·</span>
                  <span className="text-tx-faint">{timeAgo(a.lastRunAt)}</span>
                  {a.lastRunStatus === 'success' && <span className="w-1 h-1 rounded-full bg-status-success" />}
                  {a.lastRunStatus === 'error' && <span className="w-1 h-1 rounded-full bg-status-error" />}
                </div>

                {/* Hover timeline popup — no gap, with padding bridge */}
                {hoveredId === a.id && (
                  <div style={{ position: 'absolute', right: 0, top: '100%', paddingTop: 2 }}>
                    <HoverTimeline automationId={a.id} automation={a} />
                  </div>
                )}
              </div>
            )
          })}
        </>,
        document.body,
      )}

      {/* Creation dialog */}
      {showDialog && target && createPortal(
        <QuickAutomationDialog
          target={target}
          onClose={() => { setShowDialog(false); setTarget(null) }}
        />,
        document.body,
      )}
    </>
  )
}

// ── Hover Timeline Popup ──

interface ExperienceData {
  toolCalls?: Array<{ name: string; input: Record<string, unknown>; output: string; durationMs: number }>
  toolsUsed?: string[]
  workflow?: string
  runCount?: number
}

function HoverTimeline({ automationId, automation }: { automationId: string; automation: Automation }): JSX.Element {
  const [snapshots, setSnapshots] = useState<AutomationSnapshot[]>([])
  const [experience, setExperience] = useState<ExperienceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState<number | null>(null)
  const [showExperience, setShowExperience] = useState(false)

  useEffect(() => {
    Promise.all([
      window.api.automation.getSnapshots(automationId),
      window.api.automation.getExperience(automationId),
    ]).then(([snapRes, expRes]) => {
      if (snapRes.ok) setSnapshots(snapRes.data.slice(0, 5))
      if (expRes.ok && expRes.data) setExperience(expRes.data)
      setLoading(false)
    })
  }, [automationId])

  const handleRestore = useCallback(async (snap: AutomationSnapshot) => {
    setRestoring(snap.timestamp)
    try {
      await window.api.automation.restoreSnapshot(automationId, snap.timestamp)
    } catch {
      // ignore
    }
    setRestoring(null)
  }, [automationId])

  return (
    <div className="w-[280px] rounded-md bg-bg-popover border border-border-subtle shadow-[0_4px_16px_rgba(0,0,0,0.25)] overflow-hidden">
      {/* Header */}
      <div className="px-2.5 py-1.5 border-b border-border-subtle">
        <div className="text-[10px] font-medium text-tx-main truncate">{automation.name}</div>
        <div className="text-[9px] text-tx-faint">
          {INTERVAL_SHORT[automation.interval] ?? automation.interval + 'm'}
          {' · '}{automation.runCount} runs
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border-subtle">
        <button
          onClick={() => setShowExperience(false)}
          className={`flex-1 px-2 py-1 text-[9px] font-medium transition-colors ${!showExperience ? 'text-tx-main border-b border-accent-main' : 'text-tx-faint hover:text-tx-muted'}`}
        >
          History
        </button>
        <button
          onClick={() => setShowExperience(true)}
          className={`flex-1 px-2 py-1 text-[9px] font-medium transition-colors flex items-center justify-center gap-1 ${showExperience ? 'text-tx-main border-b border-accent-main' : 'text-tx-faint hover:text-tx-muted'}`}
        >
          <Brain size={8} />
          Experience
          {experience?.runCount && <span className="text-[8px] text-tx-faint">({experience.runCount})</span>}
        </button>
      </div>

      {/* Content */}
      {!showExperience ? (
        /* Timeline */
        <div className="px-2.5 py-1.5 max-h-[200px] overflow-y-auto">
          {loading ? (
            <div className="text-[9px] text-tx-faint py-2 text-center">Loading...</div>
          ) : snapshots.length === 0 ? (
            <div className="text-[9px] text-tx-faint py-2 text-center">No runs yet</div>
          ) : (
            <div className="space-y-0.5">
              {snapshots.map((snap) => (
                <div key={snap.timestamp} className="group flex items-center gap-1.5 py-[3px] rounded hover:bg-bg-hover px-1 -mx-1">
                  {snap.status === 'success' ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-status-success shrink-0" />
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-status-error shrink-0" />
                  )}
                  <span className="text-[9px] text-tx-muted flex-1 min-w-0 truncate">
                    {new Date(snap.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {snap.error && <span className="text-status-error/70 ml-1">{snap.error.slice(0, 20)}</span>}
                  </span>
                  {snap.status === 'success' && snap.contentBefore && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRestore(snap) }}
                      disabled={restoring !== null}
                      className="opacity-0 group-hover:opacity-100 shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px]
                        text-status-warning hover:bg-orange-400/10 transition-all disabled:opacity-30"
                      title="Restore to before this run"
                    >
                      {restoring === snap.timestamp ? (
                        <Loader2 size={8} className="animate-spin" />
                      ) : (
                        <RotateCcw size={8} />
                      )}
                      <span>Restore</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Experience */
        <div className="px-2.5 py-1.5 max-h-[240px] overflow-y-auto">
          {!experience ? (
            <div className="text-[9px] text-tx-faint py-2 text-center">No experience yet — run the automation first</div>
          ) : (
            <div className="space-y-2">
              {/* Workflow summary */}
              {experience.workflow && (
                <div>
                  <div className="text-[9px] font-medium text-tx-muted mb-1">Workflow</div>
                  <div className="text-[9px] text-tx-main font-mono leading-relaxed whitespace-pre-wrap bg-bg-hover rounded px-2 py-1.5">
                    {experience.workflow}
                  </div>
                </div>
              )}

              {/* Tool call details */}
              {experience.toolCalls && experience.toolCalls.length > 0 && (
                <div>
                  <div className="text-[9px] font-medium text-tx-muted mb-1">Tool details</div>
                  <div className="space-y-1">
                    {experience.toolCalls.map((tc, i) => (
                      <div key={i} className="flex items-start gap-1.5">
                        <span className="shrink-0 w-3.5 h-3.5 rounded bg-accent-main/15 text-accent-main text-[8px] flex items-center justify-center font-medium mt-[1px]">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[9px] font-medium text-tx-main truncate">{tc.name}</div>
                          <div className="text-[8px] text-tx-faint truncate">
                            {Object.entries(tc.input).slice(0, 2).map(([k, v]) => `${k}: ${String(v).slice(0, 30)}`).join(', ')}
                          </div>
                        </div>
                        <span className="shrink-0 text-[8px] text-tx-faint">{tc.durationMs}ms</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tools used */}
              {experience.toolsUsed && experience.toolsUsed.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1 border-t border-border-subtle">
                  {experience.toolsUsed.map((tool) => (
                    <span key={tool} className="px-1.5 py-0.5 rounded bg-bg-hover text-[8px] text-tx-muted">{tool}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Quick dialog for creating an automation from context menu ──

function QuickAutomationDialog({
  target,
  onClose,
}: {
  target: AutomationTarget
  onClose: () => void
}): JSX.Element {
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [interval, setInterval] = useState<AutomationInterval>(60)
  const [creating, setCreating] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const activeFilePath = useUIStore.getState().appStates['notes.app'].activeFilePath

  const handleCreate = async (): Promise<void> => {
    if (!name.trim() || !prompt.trim() || !activeFilePath) return
    setErrorMsg(null)
    setCreating(true)

    const stateRes = await window.api.state.get()
    const providers = stateRes.ok ? stateRes.data.ai?.providers?.filter((p: { enabled: boolean }) => p.enabled) : []
    const providerId = providers?.[0]?.id
    if (!providerId) {
      setErrorMsg('No AI provider configured. Open Settings → AI → Providers to add one.')
      setCreating(false)
      return
    }

    await window.api.automation.create({
      name,
      target: {
        type: target.type,
        filePath: activeFilePath,
        sectionHeading: target.type === 'section' ? target.identifier : undefined,
        tableIdentifier: target.type === 'table' ? target.identifier : undefined,
      },
      promptTemplate: prompt,
      interval,
      providerId,
      enableTools: true,
      enabled: true,
    })

    setCreating(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40">
      <div className="w-[400px] rounded-lg bg-bg-popover border border-border-subtle shadow-[0_8px_32px_rgba(0,0,0,0.3)] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <div className="flex items-center gap-2 text-sm font-medium text-accent-main">
            <Zap size={14} />
            Create Automation
          </div>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded hover:bg-bg-hover text-tx-faint hover:text-tx-main transition-colors">
            <X size={14} />
          </button>
        </div>

        <div className="px-4 py-3 space-y-3">
          <div className="px-2.5 py-1.5 rounded bg-bg-active text-[11px] text-tx-muted font-mono">
            {target.displayLabel}
          </div>
          <div>
            <label className="text-[10px] text-tx-faint uppercase tracking-wider">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Update crypto prices"
              className="w-full mt-1 px-2.5 py-1.5 rounded bg-bg-input border border-border-subtle text-tx-main text-xs outline-none focus:border-accent-main/50" autoFocus />
          </div>
          <div>
            <label className="text-[10px] text-tx-faint uppercase tracking-wider">AI Prompt</label>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe what the AI should do each time..."
              rows={3} className="w-full mt-1 px-2.5 py-1.5 rounded bg-bg-input border border-border-subtle text-tx-main text-xs outline-none focus:border-accent-main/50 resize-none" />
          </div>
          <div>
            <label className="text-[10px] text-tx-faint uppercase tracking-wider">Run every</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {INTERVAL_OPTIONS.map((opt) => (
                <button key={opt.value} onClick={() => setInterval(opt.value)}
                  className={`px-2.5 py-1 rounded text-[11px] transition-colors ${interval === opt.value ? 'bg-accent-main/15 text-accent-main' : 'bg-bg-hover text-tx-muted hover:text-tx-main'}`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {errorMsg && (
          <div className="mx-4 mb-2 p-2.5 rounded-md bg-status-error/10 border border-status-error/30 text-[11px] text-status-error flex items-start gap-2">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            <div className="flex-1">
              {errorMsg}
              <button
                onClick={() => {
                  useUIStore.getState().setCurrentApp('settings.app')
                  onClose()
                }}
                className="ml-2 underline hover:text-status-error/80"
              >
                Open Settings
              </button>
            </div>
          </div>
        )}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-subtle">
          <button onClick={onClose} className="px-3 py-1.5 rounded text-xs text-tx-muted hover:text-tx-main transition-colors">Cancel</button>
          <button onClick={handleCreate} disabled={!name.trim() || !prompt.trim() || creating}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-accent-main/15 text-accent-main hover:bg-accent-main/25 transition-colors disabled:opacity-40">
            {creating ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
            {creating ? 'Creating...' : 'Create & Start'}
          </button>
        </div>
      </div>
    </div>
  )
}
