/**
 * Welcome dialog — shown once on first run.
 *
 * Multi-step card-based onboarding. Users can arrow-key through the cards
 * or click the bottom indicators. Dismissed via "Get started" on the last
 * card → sets config.hasSeenWelcome = true so it doesn't show again.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Sparkles, FileText, Archive, Terminal, FileCode, Brain, BookOpen,
  Keyboard, Command, ArrowRight, ArrowLeft, Settings,
} from 'lucide-react'
import { useUIStore } from '../store/useUIStore'
import { getAppRegistry } from '../core/AppContext'

type Step = {
  id: string
  render: () => React.ReactElement
}

// ── Card content builders ──────────────────────────────────────────────

const IntroCard = (): React.ReactElement => (
  <div className="flex flex-col items-center text-center px-8 py-10">
    <div className="w-14 h-14 rounded-2xl bg-accent-main/15 flex items-center justify-center mb-5">
      <Sparkles size={24} className="text-accent-main" />
    </div>
    <h1 className="text-[26px] font-semibold text-tx-main mb-2">
      Welcome to Koto
    </h1>
    <p className="text-[13px] text-tx-muted leading-relaxed max-w-[380px]">
      A quiet workspace for every thing you think.
      <br />
      Notes, collector, terminal, code, and memory — in one calm place.
    </p>
  </div>
)

const APPS = [
  { id: 'notes.app', icon: FileText, name: 'Notes', desc: 'Rich-text markdown with inline AI writing.' },
  { id: 'collector.app', icon: Archive, name: 'Collector', desc: 'Save links, images, tweets — search with AI.' },
  { id: 'wiki.app', icon: BookOpen, name: 'Wiki', desc: 'Auto-built knowledge base from your collected items.' },
  { id: 'terminal.app', icon: Terminal, name: 'Terminal', desc: 'Split panes, persistent buffers, themed.' },
  { id: 'code.app', icon: FileCode, name: 'Code', desc: 'Open any folder. Edit with AI completion.' },
  { id: 'memory.app', icon: Brain, name: 'Memory', desc: 'Where AI quietly remembers what matters.' },
] as const

const DEFAULT_ENABLED_APPS = new Set<string>(['notes.app', 'collector.app', 'wiki.app'])

const AppsCard = ({
  selected,
  onToggle,
}: {
  selected: Set<string>
  onToggle: (appId: string) => void
}): React.ReactElement => (
  <div className="px-8 py-8">
    <div className="text-center mb-6">
      <h2 className="text-[18px] font-semibold text-tx-main mb-1">Pick your apps</h2>
      <p className="text-[12px] text-tx-faint">Turn any on or off later in Settings → Apps.</p>
    </div>
    <div className="space-y-2.5">
      {APPS.map((app) => {
        const isOn = selected.has(app.id)
        return (
          <div
            key={app.id}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border-subtle"
          >
            <div
              className={`shrink-0 w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
                isOn ? 'bg-accent-main/15' : 'bg-bg-hover'
              }`}
            >
              <app.icon size={15} className={isOn ? 'text-accent-main' : 'text-tx-muted'} />
            </div>
            <div className="flex-1 min-w-0">
              <div className={`text-[13px] font-medium ${isOn ? 'text-tx-main' : 'text-tx-muted'}`}>
                {app.name}
              </div>
              <div className="text-[11px] text-tx-faint leading-relaxed">{app.desc}</div>
            </div>
            {/* Toggle — same style as Settings → MCP Server switch */}
            <button
              type="button"
              onClick={() => onToggle(app.id)}
              aria-label={`Toggle ${app.name}`}
              aria-pressed={isOn}
              className={`shrink-0 w-10 h-5 rounded-full relative transition-colors ${
                isOn ? 'bg-accent-main' : 'bg-bg-hover border border-border-subtle'
              }`}
            >
              <div
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  isOn ? 'left-5' : 'left-0.5'
                }`}
              />
            </button>
          </div>
        )
      })}
    </div>
  </div>
)

const SHORTCUTS = [
  { keys: '⌘K', label: 'Open command palette (search everything)' },
  { keys: '⌘⇧K', label: 'Context panel (inject into terminal)' },
  { keys: '⌃Tab', label: 'Switch between recent files & terminals' },
  { keys: '⌘\\', label: 'Toggle sidebar' },
] as const

const ShortcutsCard = (): React.ReactElement => (
  <div className="px-8 py-8">
    <div className="flex items-center justify-center gap-2 mb-2">
      <Keyboard size={16} className="text-accent-main" />
      <h2 className="text-[18px] font-semibold text-tx-main">Essential shortcuts</h2>
    </div>
    <p className="text-center text-[12px] text-tx-faint mb-6">
      Four keys to remember. Everything else is in Settings → General.
    </p>
    <div className="space-y-2">
      {SHORTCUTS.map((s) => (
        <div key={s.keys} className="flex items-center gap-4 px-3 py-2.5 rounded-lg bg-bg-hover/40">
          <kbd className="shrink-0 min-w-[56px] px-2.5 py-1 text-[11px] font-mono bg-bg-popover border border-border-subtle rounded text-tx-main text-center">
            {s.keys}
          </kbd>
          <span className="text-[12px] text-tx-muted">{s.label}</span>
        </div>
      ))}
    </div>
  </div>
)

const PALETTE_PREFIXES = [
  { keys: '>', label: 'Run a command' },
  { keys: '#', label: 'Search inside file contents' },
  { keys: 'n ', label: 'Search only in Notes' },
  { keys: 'c ', label: 'Search only in Collector' },
  { keys: ':', label: 'Jump to line number' },
] as const

const PaletteCard = (): React.ReactElement => (
  <div className="px-8 py-8">
    <div className="flex items-center justify-center gap-2 mb-2">
      <Command size={16} className="text-accent-main" />
      <h2 className="text-[18px] font-semibold text-tx-main">Command palette tips</h2>
    </div>
    <p className="text-center text-[12px] text-tx-faint mb-6">
      Press <kbd className="px-1.5 py-0.5 font-mono text-[10px] bg-bg-hover border border-border-subtle rounded">⌘K</kbd>, then type a prefix to filter.
    </p>
    <div className="space-y-1.5">
      {PALETTE_PREFIXES.map((p) => (
        <div key={p.keys} className="flex items-center gap-4 px-3 py-2 rounded-md">
          <kbd className="shrink-0 min-w-[40px] px-2 py-0.5 text-[11px] font-mono bg-bg-hover border border-border-subtle rounded text-tx-main text-center">
            {p.keys}
          </kbd>
          <span className="text-[12px] text-tx-muted">{p.label}</span>
        </div>
      ))}
    </div>
  </div>
)

const ReadyCard = ({ onOpenSettings }: { onOpenSettings: () => void }): React.ReactElement => (
  <div className="flex flex-col items-center text-center px-8 py-10">
    <div className="w-14 h-14 rounded-2xl bg-accent-main/15 flex items-center justify-center mb-5">
      <Sparkles size={24} className="text-accent-main" />
    </div>
    <h2 className="text-[22px] font-semibold text-tx-main mb-2">You're ready</h2>
    <p className="text-[13px] text-tx-muted leading-relaxed max-w-[380px] mb-6">
      To unlock AI features — inline writing, semantic search, automations —
      add an AI provider key in Settings.
    </p>
    <button
      onClick={onOpenSettings}
      className="flex items-center gap-2 px-4 py-2 text-[12px] text-tx-muted border border-border-strong rounded-md hover:text-tx-main hover:border-tx-faint transition-colors mb-2"
    >
      <Settings size={12} />
      Configure AI providers
    </button>
    <p className="text-[10px] text-tx-faint">You can skip this and add it later.</p>
  </div>
)

// ── Main component ─────────────────────────────────────────────────────

export function WelcomeDialog(): React.ReactElement | null {
  const hasSeenWelcome = useUIStore((s) => s.hasSeenWelcome)
  const setHasSeenWelcome = useUIStore((s) => s.setHasSeenWelcome)
  const [stepIndex, setStepIndex] = useState(0)
  const [selectedApps, setSelectedApps] = useState<Set<string>>(
    () => new Set(DEFAULT_ENABLED_APPS),
  )

  const toggleApp = useCallback((appId: string) => {
    setSelectedApps((prev) => {
      const next = new Set(prev)
      if (next.has(appId)) next.delete(appId)
      else next.add(appId)
      return next
    })
  }, [])

  // Persist app selection + toggle registry + remember welcome seen.
  const persistAndClose = useCallback(() => {
    try {
      const registry = getAppRegistry()
      // Update registry for the apps shown in the welcome dialog
      for (const app of APPS) {
        registry.setEnabled(app.id, selectedApps.has(app.id))
      }
      // Persist ALL enabled apps from the registry (not just the APPS constant)
      // so apps not listed in the welcome dialog keep their enabled state.
      const allEnabled = registry.getEnabled().map((a) => a.definition.manifest.id)
      window.api.state.update({ enabledApps: allEnabled }).catch(() => {})
    } catch {
      // Registry not ready — save just the selected set as fallback
      window.api.state.update({ enabledApps: Array.from(selectedApps) }).catch(() => {})
    }
    // Bump the apps version so Sidebar re-reads the registry and shows the
    // newly-enabled apps immediately (no manual refresh needed).
    useUIStore.getState().bumpAppsVersion()
    setHasSeenWelcome(true)
  }, [selectedApps, setHasSeenWelcome])

  const handleClose = useCallback(() => {
    persistAndClose()
  }, [persistAndClose])

  const handleOpenSettings = useCallback(() => {
    persistAndClose()
    useUIStore.getState().setCurrentApp('settings.app')
  }, [persistAndClose])

  const steps: Step[] = [
    { id: 'intro', render: IntroCard },
    { id: 'apps', render: () => <AppsCard selected={selectedApps} onToggle={toggleApp} /> },
    { id: 'shortcuts', render: ShortcutsCard },
    { id: 'palette', render: PaletteCard },
    { id: 'ready', render: () => <ReadyCard onOpenSettings={handleOpenSettings} /> },
  ]

  const isFirst = stepIndex === 0
  const isLast = stepIndex === steps.length - 1

  const goNext = useCallback(() => {
    setStepIndex((i) => Math.min(i + 1, steps.length - 1))
  }, [steps.length])

  const goPrev = useCallback(() => {
    setStepIndex((i) => Math.max(i - 1, 0))
  }, [])

  // Keyboard navigation
  useEffect(() => {
    if (hasSeenWelcome) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault()
        if (isLast) handleClose()
        else goNext()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPrev()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        handleClose()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [hasSeenWelcome, isLast, goNext, goPrev, handleClose])

  if (hasSeenWelcome) return null

  const currentStep = steps[stepIndex]

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] bg-bg-app/80 flex items-center justify-center p-8 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-[480px] bg-bg-popover border border-border-subtle rounded-xl shadow-[0_20px_80px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button (absolute) */}
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 p-1.5 text-tx-faint hover:text-tx-main transition-colors rounded z-10"
          aria-label="Skip welcome"
        >
          <X size={14} />
        </button>

        {/* Card content — keyed so React re-mounts on step change for a fresh fade */}
        <div key={currentStep.id} className="welcome-card-enter">
          {currentStep.render()}
        </div>

        {/* Footer: dot indicators + arrow buttons */}
        <div className="px-6 py-4 border-t border-border-subtle flex items-center justify-between gap-4">
          {/* Prev arrow */}
          <button
            onClick={goPrev}
            disabled={isFirst}
            className="p-2 rounded-md text-tx-muted hover:text-tx-main hover:bg-bg-hover transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
            aria-label="Previous"
          >
            <ArrowLeft size={14} />
          </button>

          {/* Dot indicators */}
          <div className="flex items-center gap-1.5">
            {steps.map((step, idx) => (
              <button
                key={step.id}
                onClick={() => setStepIndex(idx)}
                className={`w-1.5 h-1.5 rounded-full transition-all ${
                  idx === stepIndex
                    ? 'bg-accent-main w-4'
                    : 'bg-border-strong hover:bg-tx-faint'
                }`}
                aria-label={`Step ${idx + 1}`}
              />
            ))}
          </div>

          {/* Next / Get Started */}
          {isLast ? (
            <button
              onClick={handleClose}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-accent-main text-bg-app rounded-md text-[12px] font-medium hover:bg-accent-main/90 transition-colors"
            >
              Get started
              <ArrowRight size={12} />
            </button>
          ) : (
            <button
              onClick={goNext}
              className="p-2 rounded-md text-tx-main hover:bg-bg-hover transition-colors"
              aria-label="Next"
            >
              <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
