import type { CellValue, ResultColumn } from '@bulkhead/core'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'

import { cellText } from './copy'
import { post } from './vscode'

const ROW_HEIGHT = 22
const HEADER_HEIGHT = 36
const CHAR_WIDTH = 7.5
const MIN_WIDTH = 64
const MAX_WIDTH = 360
const SAMPLE_ROWS = 200

interface Cell {
  row: number
  col: number
}

/**
 * A virtualised, read-only grid: only visible rows are in the DOM, so hundreds of thousands of
 * rows scroll smoothly. Plain DOM rather than canvas, so VS Code theme variables, selection and
 * screen readers just work. Arrow keys move the active cell; Ctrl/⌘+C copies it.
 */
export function ResultGrid({ columns, rows }: { columns: ResultColumn[]; rows: CellValue[][] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<Cell>()

  const widths = useMemo(() => columnWidths(columns, rows), [columns, rows])
  const indexWidth = Math.max(40, String(rows.length).length * CHAR_WIDTH + 16)
  const template = `${indexWidth}px ${widths.map((w) => `${w}px`).join(' ')}`
  const totalWidth = indexWidth + widths.reduce((sum, w) => sum + w, 0)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
    paddingStart: HEADER_HEIGHT,
  })

  const onKeyDown = (event: KeyboardEvent) => {
    if (!active) return
    if ((event.metaKey || event.ctrlKey) && event.key === 'c') {
      post({ type: 'copy', text: cellText(rows[active.row]?.[active.col] ?? null) })
      event.preventDefault()
      return
    }
    const moves: Record<string, Cell> = {
      ArrowUp: { row: active.row - 1, col: active.col },
      ArrowDown: { row: active.row + 1, col: active.col },
      ArrowLeft: { row: active.row, col: active.col - 1 },
      ArrowRight: { row: active.row, col: active.col + 1 },
    }
    const next = moves[event.key]
    if (!next) return
    event.preventDefault()
    const clamped = {
      row: Math.min(Math.max(next.row, 0), rows.length - 1),
      col: Math.min(Math.max(next.col, 0), columns.length - 1),
    }
    setActive(clamped)
    virtualizer.scrollToIndex(clamped.row)
  }

  return (
    <div
      ref={scrollRef}
      className="grid-scroll"
      tabIndex={0}
      role="grid"
      aria-rowcount={rows.length + 1}
      aria-colcount={columns.length}
      onKeyDown={onKeyDown}
    >
      <div style={{ height: virtualizer.getTotalSize(), width: totalWidth, position: 'relative' }}>
        <div className="grid-row grid-header" role="row" style={{ gridTemplateColumns: template }}>
          <div className="grid-cell index" />
          {columns.map((column, index) => (
            <div key={index} className="grid-cell" role="columnheader" title={column.type}>
              <div className="column-name">{column.name}</div>
              <div className="column-type">{column.type}</div>
            </div>
          ))}
        </div>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]!
          return (
            <div
              key={item.index}
              className="grid-row"
              role="row"
              aria-rowindex={item.index + 2}
              style={{ gridTemplateColumns: template, transform: `translateY(${item.start}px)` }}
            >
              <div className="grid-cell index">{item.index + 1}</div>
              {row.map((value, col) => {
                const isActive = active?.row === item.index && active.col === col
                return (
                  <div
                    key={col}
                    role="gridcell"
                    aria-selected={isActive}
                    className={cellClass(value, isActive, columns[col]?.numeric)}
                    title={
                      typeof value === 'string' && value.length > 40
                        ? value.slice(0, 2000)
                        : undefined
                    }
                    onMouseDown={() => setActive({ row: item.index, col })}
                  >
                    {value === null ? 'NULL' : String(value).replace(/\r?\n/g, '↵')}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function cellClass(value: CellValue, active: boolean, numeric = false): string {
  const classes = ['grid-cell']
  if (value === null) classes.push('null')
  else if (numeric || typeof value === 'number' || typeof value === 'boolean')
    classes.push('number')
  if (active) classes.push('active')
  return classes.join(' ')
}

/** Width from the header and a sample of rows, clamped, so the first paint is already usable. */
function columnWidths(columns: ResultColumn[], rows: CellValue[][]): number[] {
  return columns.map((column, col) => {
    let chars = Math.max(column.name.length, column.type.length)
    for (let i = 0; i < Math.min(rows.length, SAMPLE_ROWS); i++) {
      chars = Math.max(chars, cellText(rows[i]![col] ?? null).length)
    }
    return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, chars * CHAR_WIDTH + 20))
  })
}
