import { createContext, useContext, useCallback } from 'react'
import { useUIStore } from '../store/useUIStore'

/**
 * Per-pane/per-tab React context. Provided by PaneHost around each rendered
 * tab's app. Lets two tabs (even in the same pane) show different resources.
 */
interface PaneContextValue {
  paneId: string
  /** The tab (Item) id currently being rendered. Phase 1+ identity for per-tab state. */
  itemId: string
}

const PaneContext = createContext<PaneContextValue | null>(null)

export const PaneContextProvider = PaneContext.Provider

/** Get the current pane's id, or null if rendered outside a pane. */
export function usePaneId(): string | null {
  return useContext(PaneContext)?.paneId ?? null
}

/** Get the current tab (Item) id, or null if rendered outside a pane. */
export function usePaneItemId(): string | null {
  return useContext(PaneContext)?.itemId ?? null
}

/**
 * Read/write the active file of the containing tab.
 * Writes flow through setPaneActiveFile, which updates the active tab's resource.
 */
export function usePaneActiveFile(): [string | null, (path: string | null) => void] {
  const ctx = useContext(PaneContext)
  const paneId = ctx?.paneId ?? null
  const itemId = ctx?.itemId ?? null
  const filePath = useUIStore(
    useCallback(
      (s) => {
        // In a pane context: read the specific tab's resource.
        if (paneId && itemId) {
          const pane = s.panes[paneId]
          const item = pane?.tabs.find((t) => t.id === itemId)
          return item?.resource ?? null
        }
        // Classic (single-app) mode or top-level: prefer focused pane, else
        // fall back to legacy per-app active file.
        if (s.focusedPaneId) {
          const pane = s.panes[s.focusedPaneId]
          const item = pane?.tabs.find((t) => t.id === pane.activeTabId) ?? pane?.tabs[0]
          if (item) return item.resource ?? null
        }
        return s.appStates[s.currentApp]?.activeFilePath ?? null
      },
      [paneId, itemId],
    ),
  )
  const setPaneActiveFile = useUIStore((s) => s.setPaneActiveFile)
  const setActiveFilePath = useUIStore((s) => s.setActiveFilePath)
  const set = useCallback(
    (p: string | null) => {
      const targetId = paneId ?? useUIStore.getState().focusedPaneId
      if (targetId) setPaneActiveFile(targetId, p)
      else setActiveFilePath(p)
    },
    [paneId, setPaneActiveFile, setActiveFilePath],
  )
  return [filePath, set]
}
