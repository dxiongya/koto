import type { FontDefinition, FontId } from './types'

export const fonts: Record<FontId, FontDefinition> = {
  'sf-mono': {
    id: 'sf-mono',
    name: 'SF Mono',
    family: '"SF Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    isMonospace: true,
  },
  'geist-mono': {
    id: 'geist-mono',
    name: 'Geist Mono',
    family: '"Geist Mono", ui-monospace, monospace',
    isMonospace: true,
  },
  'geist-sans': {
    id: 'geist-sans',
    name: 'Geist Sans',
    family: '"Geist", system-ui, -apple-system, sans-serif',
    isMonospace: false,
  },
  'geist-pixel': {
    id: 'geist-pixel',
    name: 'Geist Pixel',
    family: '"Geist Pixel Square", "Geist Pixel", ui-monospace, monospace',
    isMonospace: true,
  },
}

export const fontList: FontDefinition[] = Object.values(fonts)
