import type { ThemeDefinition, FontId } from './types'
import { darkTheme } from './dark'
import { lightTheme } from './light'
import { fonts } from './fonts'

export { darkTheme } from './dark'
export { lightTheme } from './light'
export { fonts, fontList } from './fonts'
export type { ThemeDefinition, ThemeColors, FontId, FontDefinition } from './types'

export const builtinThemes: Record<string, ThemeDefinition> = {
  dark: darkTheme,
  light: lightTheme,
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
