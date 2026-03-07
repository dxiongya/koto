import type { LanguageSupport } from '@codemirror/language'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'

const LANG_MAP: Record<string, () => LanguageSupport> = {
  '.js': () => javascript(),
  '.mjs': () => javascript(),
  '.cjs': () => javascript(),
  '.jsx': () => javascript({ jsx: true }),
  '.ts': () => javascript({ typescript: true }),
  '.mts': () => javascript({ typescript: true }),
  '.cts': () => javascript({ typescript: true }),
  '.tsx': () => javascript({ jsx: true, typescript: true }),
  '.json': () => json(),
  '.css': () => css(),
  '.html': () => html(),
  '.htm': () => html(),
  '.md': () => markdown(),
  '.mdx': () => markdown(),
  '.py': () => python(),
}

export function getLanguageByPath(filePath: string): LanguageSupport | null {
  const dot = filePath.lastIndexOf('.')
  if (dot === -1) return null
  const ext = filePath.slice(dot).toLowerCase()
  return LANG_MAP[ext]?.() ?? null
}
