import React from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useUIStore } from '../store/useUIStore'
import { getAppRegistry, AppAPIProvider } from '../core/AppContext'
import { SettingsApp } from '../apps/SettingsApp'

/**
 * Classic (single-app) content-area host.
 *
 * Renders the current app full-area, with a short cross-fade when the user
 * switches between apps. No tabs, no splits — the pre-Phase 1 model.
 *
 * Pane state (panes / rootLayout) is preserved in the store so that flipping
 * the Layout setting back to "tabs" restores the previous split layout.
 */
export const ClassicAppHost: React.FC = () => {
  const currentApp = useUIStore((s) => s.currentApp)
  const registry = getAppRegistry()
  const registered = currentApp === 'settings.app' ? null : registry.get(currentApp)
  const AppComponent = currentApp === 'settings.app' ? SettingsApp : registered?.definition.component

  return (
    <div className="flex-1 min-h-0 relative overflow-hidden">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={currentApp}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14, ease: 'easeOut' }}
          className="absolute inset-0 flex flex-col"
        >
          {AppComponent ? (
            <AppAPIProvider appId={currentApp}>
              <AppComponent api={undefined as never} />
            </AppAPIProvider>
          ) : (
            <div className="flex-1 flex items-center justify-center text-tx-faint text-sm">
              {currentApp} — not available
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
