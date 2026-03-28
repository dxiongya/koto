import type { ThemeDefinition, FontId } from './types'
import { darkTheme } from './dark'
import { lightTheme } from './light'
import { cursorDarkTheme } from './cursor-dark'
import { cursorLightTheme } from './cursor-light'
import { cursorMidnightTheme } from './cursor-midnight'
import { cursorHighContrastTheme } from './cursor-high-contrast'
import { fonts } from './fonts'

export { darkTheme } from './dark'
export { lightTheme } from './light'
export { cursorDarkTheme } from './cursor-dark'
export { cursorLightTheme } from './cursor-light'
export { cursorMidnightTheme } from './cursor-midnight'
export { cursorHighContrastTheme } from './cursor-high-contrast'
export { fonts, fontList } from './fonts'
export type { ThemeDefinition, ThemeColors, FontId, FontDefinition } from './types'

export const builtinThemes: Record<string, ThemeDefinition> = {
  dark: darkTheme,
  light: lightTheme,
  'cursor-dark': cursorDarkTheme,
  'cursor-light': cursorLightTheme,
  'cursor-midnight': cursorMidnightTheme,
  'cursor-high-contrast': cursorHighContrastTheme,
}

/** All themes grouped by group name, preserving insertion order */
export function getThemeGroups(): { group: string; themes: ThemeDefinition[] }[] {
  const map = new Map<string, ThemeDefinition[]>()
  for (const t of Object.values(builtinThemes)) {
    const list = map.get(t.group) || []
    list.push(t)
    map.set(t.group, list)
  }
  return Array.from(map.entries()).map(([group, themes]) => ({ group, themes }))
}

/** Apply a theme by setting CSS custom properties on :root */
export function applyTheme(theme: ThemeDefinition): void {
  const root = document.documentElement
  const colors = theme.colors

  for (const [key, value] of Object.entries(colors)) {
    root.style.setProperty(`--${key}`, value)
  }

  // Toggle dark class for Tailwind
  if (theme.isDark) {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

/** Apply a font family to the app */
export function applyFont(fontId: FontId): void {
  const font = fonts[fontId]
  if (!font) return
  document.documentElement.style.setProperty('--font-mono', font.family)
}
