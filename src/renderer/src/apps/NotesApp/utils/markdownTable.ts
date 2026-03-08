import { $createParagraphNode, $createTextNode } from 'lexical'
import {
  $createTableNode,
  $createTableRowNode,
  $createTableCellNode,
  TableCellHeaderStates,
  type TableNode
} from '@lexical/table'

// Support both styles:
// 1) | h1 | h2 |
// 2) h1 | h2
export const MD_TABLE_ROW_RE = /^\s*\|?(?:[^|\n]*\|)+[^|\n]*\|?\s*$/
export const MD_TABLE_SEP_RE = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/

export function parseMarkdownTable(
  text: string
): { headers: string[]; rows: string[][] } | null {
  const lines = text
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  const parseRow = (line: string): string[] => {
    const trimmed = line.trim()
    const withoutOuterPipes = trimmed.replace(/^\|/, '').replace(/\|$/, '')
    return withoutOuterPipes.split('|').map((c) => c.trim())
  }

  if (lines.length < 2) return null
  if (!MD_TABLE_ROW_RE.test(lines[0])) return null

  const sepIdx = lines.findIndex((l) => MD_TABLE_SEP_RE.test(l))
  if (sepIdx < 1) return null

  const headers = parseRow(lines[0])
  if (headers.length < 2) return null

  const separatorCells = parseRow(lines[sepIdx])
  if (
    separatorCells.length !== headers.length ||
    separatorCells.some((cell) => !/^:?-{3,}:?$/.test(cell))
  ) {
    return null
  }

  const rows = lines
    .slice(sepIdx + 1)
    .filter((l) => MD_TABLE_ROW_RE.test(l))
    .map(parseRow)
  return { headers, rows }
}

export function buildTableNodeFromParsed(parsed: {
  headers: string[]
  rows: string[][]
}): TableNode {
  const { headers, rows } = parsed
  const tableNode = $createTableNode()

  const headerRow = $createTableRowNode()
  headers.forEach((header, j) => {
    const headerState = j === 0 ? TableCellHeaderStates.BOTH : TableCellHeaderStates.ROW
    const cell = $createTableCellNode(headerState)
    const p = $createParagraphNode()
    p.append($createTextNode(header))
    cell.append(p)
    headerRow.append(cell)
  })
  tableNode.append(headerRow)

  rows.forEach((rowData) => {
    const row = $createTableRowNode()
    const colCount = headers.length
    for (let j = 0; j < colCount; j++) {
      const cell = $createTableCellNode(0)
      const p = $createParagraphNode()
      p.append($createTextNode(rowData[j] ?? ''))
      cell.append(p)
      row.append(cell)
    }
    tableNode.append(row)
  })

  return tableNode
}
