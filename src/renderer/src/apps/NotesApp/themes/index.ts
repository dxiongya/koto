/**
 * Built-in Markdown Themes — bundled with the app via Vite ?raw imports.
 */
import defaultCss from './default.css?raw'
import githubCss from './github.css?raw'
import serifCss from './serif.css?raw'
import compactCss from './compact.css?raw'

export interface MdThemeInfo {
  id: string
  name: string
  description: string
  css: string
  builtIn: true
}

export const builtinMdThemes: MdThemeInfo[] = [
  { id: 'default', name: 'Default', description: 'Inherits app theme — monospace, dark', css: defaultCss, builtIn: true },
  { id: 'github', name: 'GitHub', description: 'GitHub-flavored — sans-serif, larger headings', css: githubCss, builtIn: true },
  { id: 'serif', name: 'Serif', description: 'Reading-focused — serif font, relaxed spacing', css: serifCss, builtIn: true },
  { id: 'compact', name: 'Compact', description: 'Tight spacing — more content per screen', css: compactCss, builtIn: true },
]
