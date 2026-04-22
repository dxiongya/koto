import React, { useEffect, useRef, useCallback } from 'react'
import { Terminal } from 'lucide-react'
import { useUIStore, genTerminalPersistKey } from '../../store/useUIStore'
import { usePaneItemId, usePaneId } from '../../layouts/PaneContext'
import { parseTerminalResource } from '../../layouts/paneRouting'
import { TerminalView } from './TerminalView'
import type { TerminalViewHandle } from './TerminalView'

/**
 * TerminalApp (post-unification).
 *
 * Each terminal session is now a regular Tab Item in a pane. This component
 * renders ONLY the session referenced by the current tab's resource. Multiple
 * terminals live side-by-side by being in multiple tabs or multiple panes,
 * through the same pane/tab machinery the rest of the apps use.
 *
 * Internal split (one-tab-many-terminals) has been retired — use the outer
 * pane split (⌘\) instead for a single consistent model.
 */

/** Global registry so the before-unload handler can serialize all terminals */
const terminalRefs = new Map<string, React.RefObject<TerminalViewHandle | null>>()

export function getTerminalRefs(): Map<string, React.RefObject<TerminalViewHandle | null>> {
  return terminalRefs
}

export const TerminalApp: React.FC = () => {
  const paneId = usePaneId()
  const itemId = usePaneItemId()

  // Resolve the session id from the tab item's resource.
  const sessionId = useUIStore((s) => {
    if (!paneId || !itemId) return null
    const pane = s.panes[paneId]
    const item = pane?.tabs.find((t) => t.id === itemId)
    return parseTerminalResource(item?.resource) ?? item?.resource ?? null
  })

  // The session record (for replay buffer, title, etc.)
  const session = useUIStore((s) =>
    sessionId ? s.terminalSessions.find((t) => t.id === sessionId) ?? null : null,
  )

  const setActiveTerminalId = useUIStore((s) => s.setActiveTerminalId)
  const termRef = useRef<TerminalViewHandle | null>(null)

  // Register this session's ref globally so save/serialize can find it.
  useEffect(() => {
    if (!sessionId) return
    const ref = { current: termRef.current } as React.RefObject<TerminalViewHandle | null>
    terminalRefs.set(sessionId, ref)
    return () => {
      if (terminalRefs.get(sessionId) === ref) terminalRefs.delete(sessionId)
    }
  }, [sessionId])

  // Mark this session active when mounted (for MRU / title tracking).
  useEffect(() => {
    if (sessionId) setActiveTerminalId(sessionId)
  }, [sessionId, setActiveTerminalId])

  // "New terminal" empty state — fired when tab has no session yet.
  const handleCreate = useCallback(async () => {
    const store = useUIStore.getState()
    const cwd = store.codeProjectPath ?? undefined
    const res = await window.api.terminal.create(cwd)
    if (!res.ok || !paneId || !itemId) return
    const count = store.terminalSessions.length
    const session = {
      id: res.data,
      persistKey: genTerminalPersistKey(),
      title: `Terminal ${count + 1}`,
      cwd,
    }
    store.addTerminalSession(session)
    // Rewrite the current tab's resource to point at this new session.
    const pane = store.panes[paneId]
    if (pane) {
      const nextTabs = pane.tabs.map((t) =>
        t.id === itemId
          ? { ...t, resource: res.data, label: session.title }
          : t,
      )
      useUIStore.setState({
        panes: { ...store.panes, [paneId]: { ...pane, tabs: nextTabs } },
      })
    }
  }, [paneId, itemId])

  if (!sessionId || !session) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-tx-faint">
        <Terminal size={28} strokeWidth={1.5} className="text-tx-faint" />
        <div className="text-[13px]">No terminal session</div>
        <button
          onClick={handleCreate}
          className="px-4 py-1.5 text-[12px] text-tx-muted border border-border-strong rounded-md hover:border-tx-faint hover:text-tx-main transition-colors"
        >
          New terminal
        </button>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 relative overflow-hidden" role="region" aria-label="Terminal">
      <TerminalView
        ref={(h) => {
          termRef.current = h
          if (sessionId) terminalRefs.set(sessionId, { current: h } as React.RefObject<TerminalViewHandle | null>)
        }}
        terminalId={sessionId}
        replayBuffer={session._replayBuffer}
      />
    </div>
  )
}
