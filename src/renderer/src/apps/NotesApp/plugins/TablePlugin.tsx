import React, { useEffect, useRef, useState, useCallback, type JSX } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isParagraphNode,
  $createParagraphNode,
  $getNodeByKey,
  $getNearestNodeFromDOMNode,
  COMMAND_PRIORITY_CRITICAL,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  type NodeKey,
  type LexicalEditor
} from 'lexical'
import {
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  $getTableColumnIndexFromTableCellNode,
  $getTableRowIndexFromTableCellNode,
  $removeTableRowAtIndex,
  $deleteTableColumnAtSelection,
  $createTableRowNode,
  $createTableCellNode,
  TableCellNode,
  TableNode,
  TableRowNode
} from '@lexical/table'
import { createPortal } from 'react-dom'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  MD_TABLE_ROW_RE,
  MD_TABLE_SEP_RE,
  parseMarkdownTable,
  buildTableNodeFromParsed
} from '../utils/markdownTable'

// ─── Table exit plugin ──────────────────────────────────────────────────────
export function TableExitPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    function getCellRow(
      sel: ReturnType<typeof $getSelection>
    ): { row: TableRowNode; table: TableNode } | null {
      if (!$isRangeSelection(sel) || !sel.isCollapsed()) return null
      let node = sel.anchor.getNode()
      while (node) {
        if ($isTableCellNode(node)) break
        const parent = node.getParent()
        if (!parent) return null
        node = parent
      }
      if (!$isTableCellNode(node)) return null
      const row = node.getParent()
      if (!$isTableRowNode(row)) return null
      const table = row.getParent()
      if (!$isTableNode(table)) return null
      return { row, table }
    }

    const unDown = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      () => {
        const result = getCellRow($getSelection())
        if (!result) return false
        const { row, table } = result
        const rows = table.getChildren()
        if (row !== rows[rows.length - 1]) return false
        editor.update(() => {
          const next = table.getNextSibling()
          if (next) {
            next.selectStart()
          } else {
            const para = $createParagraphNode()
            table.insertAfter(para)
            para.selectStart()
          }
        })
        return true
      },
      COMMAND_PRIORITY_CRITICAL
    )

    const unUp = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      () => {
        const result = getCellRow($getSelection())
        if (!result) return false
        const { row, table } = result
        const rows = table.getChildren()
        if (row !== rows[0]) return false
        editor.update(() => {
          const prev = table.getPreviousSibling()
          if (prev) {
            prev.selectEnd()
          } else {
            const para = $createParagraphNode()
            table.insertBefore(para)
            para.selectEnd()
          }
        })
        return true
      },
      COMMAND_PRIORITY_CRITICAL
    )

    const unEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (e) => {
        if (!e) return false
        // Cmd/Ctrl + Enter -> Insert row below (or above if shift is pressed)
        if (e.metaKey || e.ctrlKey) {
          const result = getCellRow($getSelection())
          if (!result) return false
          
          e.preventDefault()
          const { row } = result
          
          editor.update(() => {
            const colCount = row.getChildren().length
            const newRow = $createTableRowNode()
            for (let i = 0; i < colCount; i++) {
              const newCell = $createTableCellNode(0)
              newCell.append($createParagraphNode())
              newRow.append(newCell)
            }
            if (e.shiftKey) {
              row.insertBefore(newRow)
            } else {
              row.insertAfter(newRow)
            }
            // Move selection to the first cell of the newly created row
            const firstCell = newRow.getChildAtIndex(0)
            if (firstCell && $isTableCellNode(firstCell)) {
              firstCell.selectStart()
            }
          })
          return true
        }
        return false
      },
      COMMAND_PRIORITY_CRITICAL
    )

    return () => {
      unDown()
      unUp()
      unEnter()
    }
  }, [editor])

  return null
}

// ─── Markdown table auto-convert ────────────────────────────────────────────
export function MarkdownTableAutoConvertPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    function runConversion(): void {
      let hasCandidate = false
      editor.getEditorState().read(() => {
        const children = $getRoot().getChildren()
        for (const node of children) {
          if (!$isParagraphNode(node)) continue
          if (node.getTextContent().includes('|')) {
            hasCandidate = true
            break
          }
        }
      })
      if (!hasCandidate) return

      editor.update(() => {
        const root = $getRoot()
        const children = root.getChildren()
        let i = 0

        while (i < children.length) {
          const node = children[i]
          if (!$isParagraphNode(node)) {
            i++
            continue
          }

          const rawText = node.getTextContent()

          if (rawText.includes('\n')) {
            const trimmed = rawText.trim()
            const parsed = parseMarkdownTable(trimmed)
            if (parsed) {
              const tableNode = buildTableNodeFromParsed(parsed)
              node.insertBefore(tableNode)
              node.remove()
              i++
              continue
            }
          }

          const singleLineText = rawText.trim()
          if (!MD_TABLE_ROW_RE.test(singleLineText) && !MD_TABLE_SEP_RE.test(singleLineText)) {
            i++
            continue
          }

          let j = i
          const tableLines: string[] = []
          while (j < children.length) {
            const n = children[j]
            if (!$isParagraphNode(n)) break
            const t = n.getTextContent().trim()
            if (t === '') {
              j++
              continue
            }
            if (!MD_TABLE_ROW_RE.test(t) && !MD_TABLE_SEP_RE.test(t)) break
            tableLines.push(t)
            j++
          }

          if (tableLines.length < 2 || !tableLines.some((l) => MD_TABLE_SEP_RE.test(l))) {
            i++
            continue
          }

          const parsed = parseMarkdownTable(tableLines.join('\n'))
          if (!parsed) {
            i++
            continue
          }

          const tableNode = buildTableNodeFromParsed(parsed)
          children[i].insertBefore(tableNode)
          for (let k = i; k < j; k++) {
            children[k].remove()
          }
          i = j
        }
      })
    }

    const frameId = requestAnimationFrame(runConversion)
    let timer: ReturnType<typeof setTimeout>
    const SKIP_TAGS = new Set(['historic', 'auto-save'])
    const unregister = editor.registerUpdateListener(({ tags }) => {
      if ([...tags].some((t) => SKIP_TAGS.has(t))) return
      clearTimeout(timer)
      timer = setTimeout(runConversion, 800)
    })

    return () => {
      cancelAnimationFrame(frameId)
      clearTimeout(timer)
      unregister()
    }
  }, [editor])

  return null
}

// ─── Table action handles (row/column operations + pointer-based drag) ──────

interface CellInfo {
  tableKey: NodeKey
  cellKey: NodeKey
  rowIndex: number
  colIndex: number
}

interface HandleRect {
  tableLeft: number
  tableTop: number
  tableRight: number
  tableBottom: number
  cellTop: number
  cellBottom: number
  cellLeft: number
  cellRight: number
}

// ─── Pointer-based drag state (module-level) ────────────────────────────────

interface DragState {
  type: 'row' | 'col'
  srcIndex: number
  tableKey: NodeKey
  tableElem: HTMLElement
  originalRects: DOMRect[]
}

let activeDrag: DragState | null = null

interface DropTarget {
  index: number
  isAfter: boolean
}

let currentDropTarget: DropTarget | null = null

function getHandleRect(editor: LexicalEditor, info: CellInfo): HandleRect | null {
  const tableElem = editor.getElementByKey(info.tableKey)
  const cellElem = editor.getElementByKey(info.cellKey)
  if (!tableElem || !cellElem) return null
  const tr = tableElem.getBoundingClientRect()
  const cr = cellElem.getBoundingClientRect()
  return {
    tableLeft: tr.left,
    tableTop: tr.top,
    tableRight: tr.right,
    tableBottom: tr.bottom,
    cellTop: cr.top,
    cellBottom: cr.bottom,
    cellLeft: cr.left,
    cellRight: cr.right
  }
}

function applyTableHighlight(
  tableElem: Element,
  type: 'row' | 'col',
  index: number,
  mode: 'hover' | 'select' | 'clear'
): void {
  tableElem
    .querySelectorAll('.tbl-row-hover,.tbl-row-select,.tbl-col-hover,.tbl-col-select')
    .forEach((el) => {
      el.classList.remove('tbl-row-hover', 'tbl-row-select', 'tbl-col-hover', 'tbl-col-select')
    })
  if (mode === 'clear') return

  const cls =
    type === 'row'
      ? mode === 'hover'
        ? 'tbl-row-hover'
        : 'tbl-row-select'
      : mode === 'hover'
        ? 'tbl-col-hover'
        : 'tbl-col-select'

  tableElem.querySelectorAll('tr').forEach((row, ri) => {
    Array.from(row.querySelectorAll('td, th')).forEach((cell, ci) => {
      const match = type === 'row' ? ri === index : ci === index
      if (match) cell.classList.add(cls)
    })
  })
}

/** Apply drag-source styling to the source row/col */
function applyDragSourceStyle(tableElem: Element, type: 'row' | 'col', index: number, apply: boolean): void {
  tableElem.querySelectorAll('tr').forEach((row, ri) => {
    if (type === 'row') {
      if (ri === index) {
        if (apply) row.classList.add('tbl-drag-source')
        else row.classList.remove('tbl-drag-source')
      }
    } else {
      Array.from(row.querySelectorAll('td, th')).forEach((cell, ci) => {
        if (ci === index) {
          if (apply) cell.classList.add('tbl-drag-source')
          else cell.classList.remove('tbl-drag-source')
        }
      })
    }
  })
}

/** Calculate where the drop target is, using cached original rects to prevent jitter */
function calcDropTargetStable(
  type: 'row' | 'col',
  srcIndex: number,
  clientX: number,
  clientY: number,
  originalRects: DOMRect[]
): DropTarget | null {
  let bestIdx = 0
  let bestAfter = false
  let bestDist = Infinity

  for (let i = 0; i < originalRects.length; i++) {
    const rect = originalRects[i]
    if (type === 'row') {
      const topDist = Math.abs(clientY - rect.top)
      const botDist = Math.abs(clientY - rect.bottom)
      if (topDist < bestDist) {
        bestDist = topDist
        bestIdx = i
        bestAfter = false
      }
      if (botDist < bestDist) {
        bestDist = botDist
        bestIdx = i
        bestAfter = true
      }
    } else {
      const leftDist = Math.abs(clientX - rect.left)
      const rightDist = Math.abs(clientX - rect.right)
      if (leftDist < bestDist) {
        bestDist = leftDist
        bestIdx = i
        bestAfter = false
      }
      if (rightDist < bestDist) {
        bestDist = rightDist
        bestIdx = i
        bestAfter = true
      }
    }
  }

  const insertPos = bestAfter ? bestIdx + 1 : bestIdx
  if (insertPos === srcIndex || insertPos === srcIndex + 1) return null

  return { index: bestIdx, isAfter: bestAfter }
}

/** Visually shift DOM elements to make way for the dragged row/col */
function applyTablePreview(tableElem: HTMLElement, type: 'row' | 'col', S: number, T: number): void {
  if (type === 'row') {
    const rows = Array.from(tableElem.querySelectorAll('tr'))
    if (!rows[S]) return
    const dimS = rows[S].offsetHeight

    for (let i = 0; i < rows.length; i++) {
      let shift = 0
      if (i === S) {
        if (T > S) {
          for (let j = S + 1; j < T; j++) shift += rows[j].offsetHeight
        } else if (T <= S) {
          for (let j = T; j < S; j++) shift -= rows[j].offsetHeight
        }
      } else if (T > S && i > S && i < T) {
        shift = -dimS
      } else if (T <= S && i >= T && i < S) {
        shift = dimS
      }
      // Use zIndex: 10 on the moving source to ensure it floats above siblings
      rows[i].style.zIndex = i === S ? '10' : '1'
      rows[i].style.position = 'relative'
      rows[i].style.transform = `translate3d(0, ${shift}px, 0)`
      rows[i].style.transition = 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)'
    }
  } else {
    const rows = Array.from(tableElem.querySelectorAll('tr'))
    let dimS = 0
    const firstRowCells = Array.from(rows[0]?.querySelectorAll('td, th') || []) as HTMLElement[]
    if (firstRowCells[S]) dimS = firstRowCells[S].offsetWidth

    rows.forEach((row) => {
      const cells = Array.from(row.querySelectorAll('td, th')) as HTMLElement[]
      if (!cells[S]) return

      for (let i = 0; i < cells.length; i++) {
        let shift = 0
        if (i === S) {
          if (T > S) {
            for (let j = S + 1; j < T; j++) shift += cells[j].offsetWidth
          } else if (T <= S) {
            for (let j = T; j < S; j++) shift -= cells[j].offsetWidth
          }
        } else if (T > S && i > S && i < T) {
          shift = -dimS
        } else if (T <= S && i >= T && i < S) {
          shift = dimS
        }
        cells[i].style.zIndex = i === S ? '10' : '1'
        cells[i].style.position = 'relative'
        cells[i].style.transform = `translate3d(${shift}px, 0, 0)`
        cells[i].style.transition = 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)'
      }
    })
  }
}

/** Clear all preview styles */
function clearTablePreview(tableElem: HTMLElement): void {
  tableElem.querySelectorAll('tr, td, th').forEach((el) => {
    const htmlEl = el as HTMLElement
    htmlEl.style.transform = ''
    htmlEl.style.transition = ''
    htmlEl.style.zIndex = ''
    htmlEl.style.position = ''
  })
}

export function TableActionPlugin(): JSX.Element {
  const [editor] = useLexicalComposerContext()
  const [activeCell, setActiveCell] = useState<CellInfo | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const activeCellRef = useRef<CellInfo | null>(null)

  const setCellFromDOM = useCallback(
    (tdElem: HTMLElement): void => {
      editor.update(() => {
        const node = $getNearestNodeFromDOMNode(tdElem)
        if (!node) return
        let cellNode: TableCellNode | null = null
        if ($isTableCellNode(node)) {
          cellNode = node
        } else {
          let parent = node.getParent()
          while (parent) {
            if ($isTableCellNode(parent)) {
              cellNode = parent
              break
            }
            parent = parent.getParent()
          }
        }
        if (!cellNode) return
        const rowNode = cellNode.getParent()
        const tableNode = rowNode?.getParent()
        if (!$isTableRowNode(rowNode) || !$isTableNode(tableNode)) return
        const newCell: CellInfo = {
          tableKey: tableNode.getKey(),
          cellKey: cellNode.getKey(),
          rowIndex: $getTableRowIndexFromTableCellNode(cellNode),
          colIndex: $getTableColumnIndexFromTableCellNode(cellNode)
        }
        if (JSON.stringify(newCell) !== JSON.stringify(activeCellRef.current)) {
          activeCellRef.current = newCell
          setTimeout(() => setActiveCell(newCell), 0)
        }
      })
    },
    [editor]
  )

  const clearActiveCell = useCallback((): void => {
    if (activeDrag) return // Don't clear during drag
    if (activeCellRef.current !== null) {
      const tableElem = editor.getElementByKey(activeCellRef.current.tableKey)
      if (tableElem) applyTableHighlight(tableElem, 'row', 0, 'clear')
      activeCellRef.current = null
      setActiveCell(null)
    }
  }, [editor])

  // Pointer down on table cells → set active cell
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent): void => {
      if (activeDrag) return // Ignore during drag
      const target = e.target as HTMLElement
      const tdElem = target.closest('td, th') as HTMLElement | null
      if (tdElem) {
        setCellFromDOM(tdElem)
      } else {
        const inHandle = target.closest('[data-table-handle]')
        if (!inHandle) clearActiveCell()
      }
    }

    return editor.registerRootListener((rootElem, prevRootElem) => {
      if (prevRootElem) {
        prevRootElem.removeEventListener('pointerdown', handlePointerDown)
      }
      if (rootElem) {
        rootElem.addEventListener('pointerdown', handlePointerDown)
      }
    })
  }, [editor, setCellFromDOM, clearActiveCell])

  // Pointer-based drag: document-level move/up handlers
  const startDrag = useCallback(
    (type: 'row' | 'col', e: React.PointerEvent) => {
      const cell = activeCellRef.current
      if (!cell) return
      const tableElem = editor.getElementByKey(cell.tableKey)
      if (!tableElem) return

      e.preventDefault()
      e.stopPropagation()

      const srcIndex = type === 'row' ? cell.rowIndex : cell.colIndex

      // Capture original rects to ensure stable calculation during transforms
      const allRows = Array.from(tableElem.querySelectorAll('tr'))
      const originalRects: DOMRect[] = []
      if (type === 'row') {
        allRows.forEach((r) => originalRects.push(r.getBoundingClientRect()))
      } else {
        const firstRow = allRows[0]
        if (firstRow) {
          Array.from(firstRow.querySelectorAll('td, th')).forEach((c) =>
            originalRects.push(c.getBoundingClientRect())
          )
        }
      }

      // Apply source styling (the source acts as our inline preview via transform)
      applyDragSourceStyle(tableElem, type, srcIndex, true)

      activeDrag = { 
        type, 
        srcIndex, 
        tableKey: cell.tableKey, 
        tableElem, 
        originalRects
      }
      currentDropTarget = null
      setIsDragging(true)

      let rafId: number | null = null
      let latestEvent: PointerEvent | null = null

      const updateFrame = () => {
        if (!activeDrag || !latestEvent) return
        const me = latestEvent

        // Calculate drop indicator using stable cached coordinates
        const target = calcDropTargetStable(
          activeDrag.type,
          activeDrag.srcIndex,
          me.clientX,
          me.clientY,
          activeDrag.originalRects
        )

        let targetIndex = activeDrag.srcIndex
        if (target) {
          currentDropTarget = target
          targetIndex = target.isAfter ? target.index + 1 : target.index
        } else {
          currentDropTarget = null
        }

        // Shift table elements to make way and show preview
        applyTablePreview(activeDrag.tableElem, activeDrag.type, activeDrag.srcIndex, targetIndex)
        
        rafId = null
      }

      const onPointerMove = (me: PointerEvent): void => {
        latestEvent = me
        if (rafId === null) {
          rafId = requestAnimationFrame(updateFrame)
        }
      }

      const onPointerUp = (): void => {
        if (rafId !== null) cancelAnimationFrame(rafId)
        if (!activeDrag) return

        const drag = activeDrag
        const target = currentDropTarget

        // Clean up visual state
        applyDragSourceStyle(drag.tableElem, drag.type, drag.srcIndex, false)
        clearTablePreview(drag.tableElem)

        // Perform the move if we have a valid target
        if (target) {
          editor.update(() => {
            const tableNode = $getNodeByKey(drag.tableKey) as TableNode | null
            if (!tableNode) return

            if (drag.type === 'row') {
              const srcRow = tableNode.getChildAtIndex(drag.srcIndex) as TableRowNode | null
              const tgtRow = tableNode.getChildAtIndex(target.index) as TableRowNode | null
              if (!srcRow || !tgtRow || srcRow === tgtRow) return
              if (target.isAfter) tgtRow.insertAfter(srcRow)
              else tgtRow.insertBefore(srcRow)
            } else {
              // For columns, collect all src/tgt pairs first, then move
              const rows = tableNode.getChildren() as TableRowNode[]
              const pairs: { src: TableCellNode; tgt: TableCellNode }[] = []
              for (const row of rows) {
                const srcCell = row.getChildAtIndex(drag.srcIndex) as TableCellNode | null
                const tgtCell = row.getChildAtIndex(target.index) as TableCellNode | null
                if (srcCell && tgtCell && srcCell !== tgtCell) {
                  pairs.push({ src: srcCell, tgt: tgtCell })
                }
              }
              for (const { src, tgt } of pairs) {
                if (target.isAfter) tgt.insertAfter(src)
                else tgt.insertBefore(src)
              }
            }
          })
        }

        activeDrag = null
        currentDropTarget = null
        setIsDragging(false)

        // Clear stale cell info so handles re-bind to fresh positions on next click
        activeCellRef.current = null
        setActiveCell(null)

        document.removeEventListener('pointermove', onPointerMove)
        document.removeEventListener('pointerup', onPointerUp)
      }

      document.addEventListener('pointermove', onPointerMove)
      document.addEventListener('pointerup', onPointerUp)
    },
    [editor]
  )

  if (!activeCell) return <></>
  const rect = getHandleRect(editor, activeCell)
  if (!rect) return <></>

  return (
    <>
      {createPortal(
        <RowHandle
          editor={editor}
          activeCell={activeCell}
          activeCellRef={activeCellRef}
          rect={rect}
          onDragStart={(e) => startDrag('row', e)}
          isDragging={isDragging}
        />,
        document.body
      )}
      {createPortal(
        <ColHandle
          editor={editor}
          activeCell={activeCell}
          activeCellRef={activeCellRef}
          rect={rect}
          onDragStart={(e) => startDrag('col', e)}
          isDragging={isDragging}
        />,
        document.body
      )}
    </>
  )
}

interface HandleProps {
  editor: LexicalEditor
  activeCell: CellInfo
  activeCellRef: React.RefObject<CellInfo | null>
  rect: HandleRect
  onDragStart: (e: React.PointerEvent) => void
  isDragging: boolean
}

function RowHandle({ editor, activeCellRef, rect, onDragStart, isDragging }: HandleProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const [hovered, setHovered] = useState(false)

  const cellH = rect.cellBottom - rect.cellTop
  const top = rect.cellTop + cellH / 2 - 9
  const left = rect.tableLeft - 22

  const getTableElem = useCallback(() => {
    const cell = activeCellRef.current
    return cell ? editor.getElementByKey(cell.tableKey) : null
  }, [editor, activeCellRef])

  const onMouseEnter = useCallback(() => {
    if (isDragging) return
    setHovered(true)
    const cell = activeCellRef.current
    const tableElem = getTableElem()
    if (cell && tableElem) applyTableHighlight(tableElem, 'row', cell.rowIndex, 'hover')
  }, [activeCellRef, getTableElem, isDragging])

  const onMouseLeave = useCallback(() => {
    if (isDragging) return
    setHovered(false)
    const tableElem = getTableElem()
    if (tableElem) applyTableHighlight(tableElem, 'row', 0, 'clear')
  }, [getTableElem, isDragging])

  const insertRow = useCallback(
    (insertAfter: boolean) => {
      const cell = activeCellRef.current
      if (!cell) return
      setTimeout(() => {
        editor.update(() => {
          const cellNode = $getNodeByKey(cell.cellKey) as TableCellNode | null
          if (!cellNode) return
          const rowNode = cellNode.getParent() as TableRowNode | null
          if (!rowNode) return
          const colCount = rowNode.getChildren().length
          const newRow = $createTableRowNode()
          for (let i = 0; i < colCount; i++) {
            const newCell = $createTableCellNode(0)
            newCell.append($createParagraphNode())
            newRow.append(newCell)
          }
          if (insertAfter) rowNode.insertAfter(newRow)
          else rowNode.insertBefore(newRow)
        })
      }, 0)
    },
    [editor, activeCellRef]
  )

  const deleteRow = useCallback(() => {
    const cell = activeCellRef.current
    if (!cell) return
    setTimeout(() => {
      editor.update(
        () => {
          const table = $getNodeByKey(cell.tableKey) as TableNode | null
          if (table) $removeTableRowAtIndex(table, cell.rowIndex)
        },
        { tag: 'table-action' }
      )
    }, 0)
  }, [editor, activeCellRef])

  if (isDragging) return <></>

  return (
    <div
      data-table-handle="true"
      style={{
        position: 'fixed',
        top,
        left,
        width: 16,
        height: 18,
        zIndex: 9000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: hovered || menuOpen ? 'var(--color-bg-active)' : 'var(--color-bg-hover)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 4,
        cursor: hovered && !menuOpen ? 'grab' : 'default',
        transition: 'background-color 0.12s',
        userSelect: 'none'
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={() => {
        if (!menuOpen) onMouseLeave()
      }}
      onPointerDown={(e) => {
        if (e.button !== 0 || menuOpen) return
        onDragStart(e)
      }}
    >
      <MiniGrip />
      <DropdownMenu.Root
        open={menuOpen}
        onOpenChange={(v) => {
          setMenuOpen(v)
          if (!v) {
            const tableElem = getTableElem()
            if (tableElem) applyTableHighlight(tableElem, 'row', 0, 'clear')
          }
        }}
      >
        <DropdownMenu.Trigger asChild>
          <div
            data-table-handle="true"
            style={{
              position: 'absolute',
              top: '50%',
              right: -12,
              transform: 'translateY(-50%)',
              width: 12,
              height: 12,
              borderRadius: '50%',
              backgroundColor: 'var(--color-bg-popover)',
              border: '1px solid var(--color-border-subtle)',
              display: hovered || menuOpen ? 'flex' : 'none',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer'
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => e.stopPropagation()}
          >
            <svg width={8} height={8} viewBox="0 0 8 8" fill="none">
              <path d="M1.5 3L4 5.5L6.5 3" stroke="var(--color-tx-muted)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            data-table-handle="true"
            className="z-[9999] min-w-[140px] rounded-lg py-1 bg-bg-popover border border-border-subtle shadow-[0_4px_20px_rgba(0,0,0,0.15)] text-[13px]"
            sideOffset={5}
          >
            <MenuItem label="Insert row above" onSelect={() => insertRow(false)} />
            <MenuItem label="Insert row below" onSelect={() => insertRow(true)} />
            <MenuDiv />
            <MenuItem label="Delete row" onSelect={deleteRow} danger />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}

function ColHandle({ editor, activeCellRef, rect, onDragStart, isDragging }: HandleProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const [hovered, setHovered] = useState(false)

  const cellW = rect.cellRight - rect.cellLeft
  const left = rect.cellLeft + cellW / 2 - 9
  const top = rect.tableTop - 22

  const getTableElem = useCallback(() => {
    const cell = activeCellRef.current
    return cell ? editor.getElementByKey(cell.tableKey) : null
  }, [editor, activeCellRef])

  const onMouseEnter = useCallback(() => {
    if (isDragging) return
    setHovered(true)
    const cell = activeCellRef.current
    const tableElem = getTableElem()
    if (cell && tableElem) applyTableHighlight(tableElem, 'col', cell.colIndex, 'hover')
  }, [activeCellRef, getTableElem, isDragging])

  const onMouseLeave = useCallback(() => {
    if (isDragging) return
    setHovered(false)
    const tableElem = getTableElem()
    if (tableElem) applyTableHighlight(tableElem, 'col', 0, 'clear')
  }, [getTableElem, isDragging])

  const insertCol = useCallback(
    (insertAfter: boolean) => {
      const cell = activeCellRef.current
      if (!cell) return
      setTimeout(() => {
        editor.update(() => {
          const cellNode = $getNodeByKey(cell.cellKey) as TableCellNode | null
          if (!cellNode) return
          const colIndex = $getTableColumnIndexFromTableCellNode(cellNode)
          const rowNode = cellNode.getParent() as TableRowNode | null
          const tableNode = rowNode?.getParent() as TableNode | null
          if (!tableNode) return
          ;(tableNode.getChildren() as TableRowNode[]).forEach((row) => {
            const targetCell = row.getChildAtIndex(colIndex) as TableCellNode | null
            if (!targetCell) return
            const newCell = $createTableCellNode(0)
            newCell.append($createParagraphNode())
            if (insertAfter) targetCell.insertAfter(newCell)
            else targetCell.insertBefore(newCell)
          })
        })
      }, 0)
    },
    [editor, activeCellRef]
  )

  const deleteCol = useCallback(() => {
    const cell = activeCellRef.current
    if (!cell) return
    setTimeout(() => {
      editor.update(
        () => {
          const cellNode = $getNodeByKey(cell.cellKey) as TableCellNode | null
          if (!cellNode) return
          try {
            cellNode.selectStart()
            $deleteTableColumnAtSelection()
          } catch (err) {
            console.error('[TablePlugin] col delete error:', err)
          }
        },
        { tag: 'table-action' }
      )
    }, 0)
  }, [editor, activeCellRef])

  if (isDragging) return <></>

  return (
    <div
      data-table-handle="true"
      style={{
        position: 'fixed',
        top,
        left,
        width: 18,
        height: 16,
        zIndex: 9000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: hovered || menuOpen ? 'var(--color-bg-active)' : 'var(--color-bg-hover)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 4,
        cursor: hovered && !menuOpen ? 'grab' : 'default',
        transition: 'background-color 0.12s',
        userSelect: 'none'
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={() => {
        if (!menuOpen) onMouseLeave()
      }}
      onPointerDown={(e) => {
        if (e.button !== 0 || menuOpen) return
        onDragStart(e)
      }}
    >
      <MiniGrip horizontal />
      <DropdownMenu.Root
        open={menuOpen}
        onOpenChange={(v) => {
          setMenuOpen(v)
          if (!v) {
            const tableElem = getTableElem()
            if (tableElem) applyTableHighlight(tableElem, 'col', 0, 'clear')
          }
        }}
      >
        <DropdownMenu.Trigger asChild>
          <div
            data-table-handle="true"
            style={{
              position: 'absolute',
              left: '50%',
              bottom: -12,
              transform: 'translateX(-50%)',
              width: 12,
              height: 12,
              borderRadius: '50%',
              backgroundColor: 'var(--color-bg-popover)',
              border: '1px solid var(--color-border-subtle)',
              display: hovered || menuOpen ? 'flex' : 'none',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer'
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => e.stopPropagation()}
          >
            <svg width={8} height={8} viewBox="0 0 8 8" fill="none">
              <path d="M1.5 3L4 5.5L6.5 3" stroke="var(--color-tx-muted)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            data-table-handle="true"
            className="z-[9999] min-w-[140px] rounded-lg py-1 bg-bg-popover border border-border-subtle shadow-[0_4px_20px_rgba(0,0,0,0.15)] text-[13px]"
            sideOffset={5}
          >
            <MenuItem label="Insert column left" onSelect={() => insertCol(false)} />
            <MenuItem label="Insert column right" onSelect={() => insertCol(true)} />
            <MenuDiv />
            <MenuItem label="Delete column" onSelect={deleteCol} danger />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}

function MenuItem({
  label,
  onSelect,
  danger
}: {
  label: string
  onSelect: () => void
  danger?: boolean
}): JSX.Element {
  return (
    <DropdownMenu.Item
      className={`flex items-center px-3 py-1.5 outline-none cursor-pointer transition-colors ${
        danger
          ? 'text-red-400 hover:bg-red-500/10'
          : 'text-tx-main hover:bg-bg-hover'
      }`}
      onSelect={onSelect}
    >
      {label}
    </DropdownMenu.Item>
  )
}

function MenuDiv(): JSX.Element {
  return <div className="h-[1px] bg-bg-active my-1 mx-2" />
}

function MiniGrip({ horizontal = false }: { horizontal?: boolean }): JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: horizontal ? 'repeat(3, 3px)' : 'repeat(2, 3px)',
        gridTemplateRows: horizontal ? 'repeat(2, 3px)' : 'repeat(3, 3px)',
        gap: '2px',
        opacity: 0.35,
        pointerEvents: 'none'
      }}
    >
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} style={{ width: 2, height: 2, borderRadius: '50%', backgroundColor: 'var(--color-tx-muted)' }} />
      ))}
    </div>
  )
}
