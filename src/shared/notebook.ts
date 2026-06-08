/**
 * Notebook — the persisted scope for the agent (NotebookLM-style) mode.
 *
 * A Notebook is intentionally **thin**: it does not own its source content,
 * just references to it (file paths today, collector ids later). Every
 * Studio "product" the agent generates is written back into an existing
 * Koto app (Notes, Wiki, etc.) and the notebook only keeps a pointer.
 *
 * Persistence: one JSON file per notebook at
 *   {liteHome}/notebooks/<id>.json
 */

export type NotebookSourceKind = 'note' | 'text' | 'url'

export interface NotebookSource {
  /** Stable id within the notebook (used in chat citations). */
  id: string
  kind: NotebookSourceKind
  /** Display title shown in the sources column. */
  title: string
  /** Absolute file path — set when kind === 'note'. */
  path?: string
  /** Inline content — set when kind === 'text' or 'url' (after fetch). */
  content?: string
  /** Original URL — set when kind === 'url'. */
  url?: string
  /** Checkbox state — whether this source participates in the next chat turn. */
  selected: boolean
  addedAt: number
}

export interface NotebookCitation {
  /** Source id this citation points to. */
  sourceId: string
  /** Numbered badge shown in the rendered chat (1-based, assigned at parse time). */
  number: number
}

export interface NotebookMessage {
  id: string
  role: 'user' | 'assistant'
  /** Markdown content. For assistant messages with citations, the raw text
   *  contains `[src:<sourceId>]` markers that the renderer turns into `[N]`. */
  content: string
  /** Resolved citations (numbered) — only set on assistant messages. */
  citations?: NotebookCitation[]
  createdAt: number
}

export type NotebookProductType = 'report'

export interface NotebookProduct {
  id: string
  type: NotebookProductType
  /** Pointer to where the product was written (e.g. a notes/.../foo.md path). */
  notePath: string
  /** Short human label shown in the Studio history. */
  label: string
  createdAt: number
}

export interface Notebook {
  id: string
  name: string
  sources: NotebookSource[]
  messages: NotebookMessage[]
  products: NotebookProduct[]
  createdAt: number
  updatedAt: number
}

export interface NotebookSummary {
  id: string
  name: string
  sourceCount: number
  updatedAt: number
}
