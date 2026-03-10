import React, { useMemo } from 'react'
import { useUIStore } from '../../store/useUIStore'
import { builtinThemes, getThemeGroups, fontList } from '../../themes'
import type { FontId, ThemeDefinition } from '../../themes'
import { Check, Sun, Moon } from 'lucide-react'

/** Mini app preview using a theme's colors */
const ThemePreview: React.FC<{ t: ThemeDefinition }> = ({ t }) => (
  <div
    className="rounded-md h-[52px] overflow-hidden flex"
    style={{ backgroundColor: t.colors['bg-app'], border: `1px solid ${t.colors['border-subtle']}` }}
  >
    <div className="w-[38%] h-full" style={{ backgroundColor: t.colors['bg-sidebar'] }}>
      <div className="pt-2.5 px-2 space-y-1.5">
        <div className="h-1 w-6 rounded-full" style={{ backgroundColor: t.colors['tx-faint'] }} />
        <div className="h-1 w-9 rounded-full" style={{ backgroundColor: t.colors['accent-main'] }} />
        <div className="h-1 w-7 rounded-full" style={{ backgroundColor: t.colors['tx-faint'] }} />
      </div>
    </div>
    <div className="flex-1 pt-2.5 px-2 space-y-1.5">
      <div className="h-1 w-full rounded-full" style={{ backgroundColor: t.colors['tx-faint'], opacity: 0.35 }} />
      <div className="h-1 w-3/4 rounded-full" style={{ backgroundColor: t.colors['tx-faint'], opacity: 0.25 }} />
      <div className="h-1 w-5/6 rounded-full" style={{ backgroundColor: t.colors['tx-faint'], opacity: 0.18 }} />
    </div>
  </div>
)

const SettingsApp: React.FC = () => {
  const currentThemeId = useUIStore((s) => s.theme)
  const fontFamily = useUIStore((s) => s.fontFamily)
  const setTheme = useUIStore((s) => s.setTheme)
  const setFontFamily = useUIStore((s) => s.setFontFamily)
  const showCommandPalette = useUIStore((s) => s.showCommandPalette)

  const blurClass = showCommandPalette
    ? 'filter blur-[3px] opacity-50 transition-all duration-300'
    : 'transition-all duration-300'

  const themeGroups = useMemo(() => getThemeGroups(), [])

  // Determine current group and dark/light state
  const currentTheme = builtinThemes[currentThemeId]
  const currentGroup = currentTheme?.group ?? 'Lite'
  const isDark = currentTheme?.isDark ?? true

  // Switch group: keep current dark/light preference, find matching theme in new group
  const handleGroupSelect = (group: string) => {
    const groupThemes = themeGroups.find((g) => g.group === group)?.themes
    if (!groupThemes) return
    const match = groupThemes.find((t) => t.isDark === isDark) || groupThemes[0]
    setTheme(match.id)
  }

  // Toggle dark/light within the same group
  const handleModeToggle = (dark: boolean) => {
    const groupThemes = themeGroups.find((g) => g.group === currentGroup)?.themes
    if (!groupThemes) return
    const match = groupThemes.find((t) => t.isDark === dark)
    if (match) setTheme(match.id)
  }

  return (
    <div className={`flex-1 overflow-y-auto ${blurClass}`}>
      <div className="max-w-[560px] mx-auto py-12 px-6">
        <h1 className="text-tx-main text-lg font-semibold mb-8">Settings</h1>

        {/* ── Theme ── */}
        <section className="mb-10">
          <h2 className="text-tx-muted text-xs font-medium uppercase tracking-wider mb-4">Theme</h2>

          {/* Group selector */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            {themeGroups.map(({ group, themes }) => {
              const isActive = currentGroup === group
              const previewTheme = themes.find((t) => t.isDark) || themes[0]
              return (
                <button
                  key={group}
                  onClick={() => handleGroupSelect(group)}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    isActive ? 'border-accent-main' : 'border-border-subtle hover:border-border-strong'
                  }`}
                >
                  <ThemePreview t={previewTheme} />
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-tx-main text-sm font-medium">{group}</span>
                    {isActive && <Check size={14} className="text-accent-main" />}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Dark / Light toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => handleModeToggle(true)}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                isDark
                  ? 'bg-accent-main/10 text-accent-main'
                  : 'text-tx-muted hover:bg-bg-hover'
              }`}
            >
              <Moon size={14} />
              Dark
            </button>
            <button
              onClick={() => handleModeToggle(false)}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                !isDark
                  ? 'bg-accent-main/10 text-accent-main'
                  : 'text-tx-muted hover:bg-bg-hover'
              }`}
            >
              <Sun size={14} />
              Light
            </button>
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

export { SettingsApp }
export default SettingsApp
