import React from 'react'
import { useUIStore } from '../../store/useUIStore'
import { builtinThemes, fontList } from '../../themes'
import type { FontId } from '../../themes'
import { Check } from 'lucide-react'

const SettingsApp: React.FC = () => {
  const theme = useUIStore((s) => s.theme)
  const fontFamily = useUIStore((s) => s.fontFamily)
  const setTheme = useUIStore((s) => s.setTheme)
  const setFontFamily = useUIStore((s) => s.setFontFamily)
  const showCommandPalette = useUIStore((s) => s.showCommandPalette)

  const blurClass = showCommandPalette
    ? 'filter blur-[3px] opacity-50 transition-all duration-300'
    : 'transition-all duration-300'

  return (
    <div className={`flex-1 overflow-y-auto ${blurClass}`}>
      <div className="max-w-[560px] mx-auto py-12 px-6">
        <h1 className="text-tx-main text-lg font-semibold mb-8">Settings</h1>

        {/* ── Theme ── */}
        <section className="mb-10">
          <h2 className="text-tx-muted text-xs font-medium uppercase tracking-wider mb-4">Theme</h2>
          <div className="grid grid-cols-2 gap-3">
            {Object.values(builtinThemes).map((t) => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={`relative rounded-lg border p-3 text-left transition-colors ${
                  theme === t.id
                    ? 'border-accent-main'
                    : 'border-border-subtle hover:border-border-strong'
                }`}
              >
                {/* Mini preview */}
                <div
                  className="rounded-md h-16 mb-2 border border-border-subtle overflow-hidden"
                  style={{ backgroundColor: t.colors['bg-app'] }}
                >
                  <div
                    className="w-[40%] h-full"
                    style={{ backgroundColor: t.colors['bg-sidebar'] }}
                  >
                    <div className="pt-3 px-2 space-y-1.5">
                      <div className="h-1.5 w-8 rounded" style={{ backgroundColor: t.colors['tx-faint'] }} />
                      <div className="h-1.5 w-12 rounded" style={{ backgroundColor: t.colors['accent-main'] }} />
                      <div className="h-1.5 w-10 rounded" style={{ backgroundColor: t.colors['tx-faint'] }} />
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-tx-main text-sm">{t.name}</span>
                  {theme === t.id && (
                    <Check size={14} className="text-accent-main" />
                  )}
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* ── Font ── */}
        <section className="mb-10">
          <h2 className="text-tx-muted text-xs font-medium uppercase tracking-wider mb-4">Font</h2>
          <div className="space-y-1">
            {fontList.map((f) => (
              <button
                key={f.id}
                onClick={() => setFontFamily(f.id as FontId)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-left transition-colors ${
                  fontFamily === f.id
                    ? 'bg-accent-main/10 text-accent-main'
                    : 'text-tx-main hover:bg-bg-hover'
                }`}
              >
                <div>
                  <div className="text-sm" style={{ fontFamily: f.family }}>
                    {f.name}
                  </div>
                  <div
                    className="text-xs text-tx-faint mt-0.5"
                    style={{ fontFamily: f.family }}
                  >
                    The quick brown fox jumps over the lazy dog 0123456789
                  </div>
                </div>
                {fontFamily === f.id && (
                  <Check size={14} className="text-accent-main shrink-0 ml-3" />
                )}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

export default SettingsApp
