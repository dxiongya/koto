/**
 * Citation parser — turns `[src:S1]` markers in an assistant reply into
 * numbered `[N]` badges (first-appearance order), and returns the mapping
 * for the renderer to draw clickable badges.
 */
import type { NotebookCitation, NotebookSource } from '../../../shared/notebook'

const MARKER_RE = /\[src:([A-Za-z0-9_-]+)\]/g

export interface ParsedCitations {
  /** The original content with `[src:Sx]` rewritten to `[N]`. */
  content: string
  /** Numbered citations in display order. */
  citations: NotebookCitation[]
}

export function parseCitations(raw: string, sources: NotebookSource[]): ParsedCitations {
  const knownIds = new Set(sources.map((s) => s.id))
  const order: string[] = []
  const idToNumber = new Map<string, number>()

  const content = raw.replace(MARKER_RE, (_full, id: string) => {
    if (!knownIds.has(id)) {
      // Drop dangling markers so the reader doesn't see junk.
      return ''
    }
    let n = idToNumber.get(id)
    if (n == null) {
      order.push(id)
      n = order.length
      idToNumber.set(id, n)
    }
    return `[${n}]`
  })

  const citations: NotebookCitation[] = order.map((id, idx) => ({
    sourceId: id,
    number: idx + 1,
  }))

  return { content, citations }
}
