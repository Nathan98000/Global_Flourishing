// The tinted matrix (Phase 5, generalised in Phase 6): a small heatmap
// table whose cells carry a number over a token-only tint, with the CI
// in the tooltip and the n in the data table beneath the figure
// (ADR-0011: every cell is shown). `HeatTable` is the matrix itself —
// row keys, column keys, one cell lookup — and `TransitionTable` is the
// transition matrix of an ordinal/nominal item built on it: rows are the
// earlier answer, columns the later one, each cell the share of the
// row's people who gave that later answer (the engine's conditional
// measure; each row sums to 100%), tinted with the accent at graded
// opacity. The Correlates view builds its measures × countries matrix on
// the same component with the diverging ramp. Never fetches.

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import type { EstimateRow } from '../api/types'
import { ciText, formatEstimate } from '../format'
import type { SortDir } from '../sortRows'
import { TIP_OPTIONS } from './theme'
import styles from './TransitionTable.module.css'

export interface TransitionCell {
  from: number
  to: number
  row: EstimateRow
}

export interface TransitionGrid {
  levels: number[]
  cells: Map<string, EstimateRow>
}

/** The k × k grid of one country's conditional transitions, in level order. */
export function transitionGrid(rows: readonly EstimateRow[]): TransitionGrid {
  const levels = new Set<number>()
  const cells = new Map<string, EstimateRow>()
  for (const row of rows) {
    if (row.from_level === null || row.from_level === undefined) continue
    if (row.to_level === null || row.to_level === undefined) continue
    levels.add(row.from_level)
    levels.add(row.to_level)
    cells.set(`${row.from_level}:${row.to_level}`, row)
  }
  return { levels: [...levels].sort((a, b) => a - b), cells }
}

/** The ink a ramp tint's text wears: every `--seq-*` and `--div-*` step
 * names its own `-ink` companion in tokens.css (dark ink on the light
 * steps, light ink on the dark ones, ≥ 4.5:1 each — the near-black ink
 * on the deep teal read at 1.9:1). Any other tint keeps the default ink. */
export function tintInk(tint: string): string | undefined {
  const match = /^var\((--(?:seq|div)-[\w-]+)\)$/.exec(tint)
  return match ? `var(${match[1]}-ink)` : undefined
}

/** Accent at graded opacity — a token-only heat scale. */
export function cellTint(share: number | null): string {
  if (share === null) return 'transparent'
  const percent = 6 + Math.round(Math.min(1, Math.max(0, share)) * 44)
  return `color-mix(in srgb, var(--accent) ${percent}%, transparent)`
}

/** The interval clause of a cell's tooltip: the CI, or why there is none. */
export function intervalText(row: EstimateRow): string {
  if (row.ci_lo !== null && row.ci_hi !== null) return ciText(row)
  return row.ci_method === 'none'
    ? 'point estimate — no interval is computed for this statistic'
    : 'no interval (single sampling unit)'
}

export interface HeatCell {
  /** The number in the cell (formatted by the caller). */
  text: string
  /** The tooltip — value, context, interval (never the n — ADR-0016) —
   * shown styled on hover or tap, never as a native title. */
  title: string
  /** A token-only background (`var(--…)` or a color-mix of one). */
  tint: string
  /** Read by assistive tech after the number (a floor note, typically). */
  hidden?: string
  /** Too few cases to rank: untinted, in muted ink (the tooltip says why). */
  muted?: boolean
}

export interface HeatAxis {
  key: string
  label: string
}

/** A fixed-width column's side padding (--space-2 in
 * TransitionTable.module.css): a caller sizing columns to their labels
 * adds it twice to the text width. */
export const HEAT_CELL_PAD = 8

/** The canvas font of a column header — the table's --text-sm at weight
 * 500 in the page face (TransitionTable.module.css) — resolved against
 * the page, for measuring how a label wraps. */
export function headerFont(): string {
  const root = getComputedStyle(document.documentElement)
  const rem = Number.parseFloat(root.fontSize) || 16
  const size = (Number.parseFloat(root.getPropertyValue('--text-sm')) || 0.8125) * rem
  const family = root.getPropertyValue('--font-sans').trim() || 'system-ui, sans-serif'
  return `500 ${size}px ${family}`
}

/** A cell tooltip's anchor, in the matrix box's own coordinates: the
 * cell's horizontal centre, top and bottom. */
interface TipAnchor {
  key: string
  text: string
  x: number
  top: number
  bottom: number
  /** Opened by a tap: stays until the next tap anywhere else. */
  pinned: boolean
}

/** The room between a cell and its tooltip. */
const TIP_GAP = 6

/** How many columns lie past the visible edge of a scroll container:
 * those whose right edge sits beyond the container's, given each
 * column's right edge and the container's — pure, so it is testable
 * without layout. */
export function columnsPastEdge(rights: readonly number[], edge: number): number {
  return rights.filter((right) => right > edge + 1).length
}

/** The matrix: rows × columns, one cell lookup; an absent cell reads "—".
 * The caption sits above the scroll container, not inside the table, so
 * a wide matrix never widens the page to fit its caption; the first
 * column is sticky, and when the matrix overflows a right-edge fade and
 * an "N more →" button say so — the button pages the box sideways. With
 * `columnWidth` every column takes that width and its header wraps over
 * it; without, columns fit their labels on one line. A `sort` column
 * wears ▼ or ▲ and aria-sort, and a new sort brings it into view. A
 * cell's tooltip is the Plot tips' look, at once on hover and on tap for
 * touch; cells are never tab stops (the data table carries the same
 * numbers and intervals). */
export function HeatTable({
  caption,
  corner,
  rows,
  columns,
  cellAt,
  columnWidth,
  sort,
}: {
  /** Above the table: what the tints mean (words, or a legend). */
  caption: ReactNode
  /** The corner label naming both axes ("First answer ↓ · later answer →"). */
  corner: string
  rows: readonly HeatAxis[]
  columns: readonly HeatAxis[]
  cellAt: (row: HeatAxis, column: HeatAxis) => HeatCell | undefined
  /** One width (px) for every column, headers wrapping to fit it. */
  columnWidth?: number
  /** The column the rows are ordered by, and which way. */
  sort?: { column: string; dir: SortDir }
}) {
  const captionId = useId()
  const matrix = useRef<HTMLDivElement | null>(null)
  const scroller = useRef<HTMLDivElement | null>(null)
  const tipBox = useRef<HTMLDivElement | null>(null)
  const [hiddenColumns, setHiddenColumns] = useState(0)
  const [tip, setTip] = useState<TipAnchor | null>(null)
  const [tipAt, setTipAt] = useState<{ left: number; top: number } | null>(null)
  const anchor = (cell: Element, key: string, text: string, pinned: boolean) => {
    const box = matrix.current?.getBoundingClientRect()
    if (!box) return null
    const rect = cell.getBoundingClientRect()
    const x = rect.left + rect.width / 2 - box.left
    return { key, text, x, top: rect.top - box.top, bottom: rect.bottom - box.top, pinned }
  }
  // Placed before paint: centred over its cell, above it when there is
  // room (below, for the top rows), kept inside the matrix box.
  useLayoutEffect(() => {
    const element = tipBox.current
    const box = matrix.current
    if (!tip || !element || !box) {
      setTipAt(null)
      return
    }
    const width = element.offsetWidth
    const left = Math.max(0, Math.min(tip.x - width / 2, box.clientWidth - width))
    const above = tip.top - TIP_GAP - element.offsetHeight
    setTipAt({ left, top: above >= 0 ? above : tip.bottom + TIP_GAP })
  }, [tip])
  // A scroll of the box moves the cells from under the tooltip: it goes.
  // A tapped one also goes on the next tap anywhere but this matrix's cells.
  useEffect(() => {
    if (!tip) return
    const element = scroller.current
    const hide = () => setTip(null)
    const away = (event: PointerEvent) => {
      const cell = event.target instanceof Element ? event.target.closest('td') : null
      if (!cell || !matrix.current?.contains(cell)) hide()
    }
    element?.addEventListener('scroll', hide, { passive: true })
    if (tip.pinned) document.addEventListener('pointerdown', away)
    return () => {
      element?.removeEventListener('scroll', hide)
      document.removeEventListener('pointerdown', away)
    }
  }, [tip])
  useEffect(() => {
    const element = scroller.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const edge = element.getBoundingClientRect().right
      const rights = [...element.querySelectorAll('thead th')]
        .slice(1)
        .map((th) => th.getBoundingClientRect().right)
      setHiddenColumns(columnsPastEdge(rights, edge))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    element.addEventListener('scroll', measure, { passive: true })
    return () => {
      observer.disconnect()
      element.removeEventListener('scroll', measure)
    }
  }, [columns.length, rows.length, columnWidth])
  // A new sort brings its column wholly into view (a phone shows two or
  // three columns): beside the sticky first column, as far as it goes.
  const sortColumn = sort?.column
  useEffect(() => {
    const element = scroller.current
    const index = columns.findIndex((column) => column.key === sortColumn)
    if (!element || index < 0) return
    const [sticky, ...headers] = element.querySelectorAll('thead th')
    const target = headers[index]?.getBoundingClientRect()
    const stickyRight = sticky?.getBoundingClientRect().right ?? 0
    const edge = element.getBoundingClientRect().right
    if (!target || (target.left >= stickyRight - 1 && target.right <= edge + 1)) return
    element.scrollBy({ left: target.left - stickyRight })
    // Only a new sort moves the box, not a new render of the same one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortColumn, sort?.dir])
  // Page right by up to what the box shows beside its sticky first
  // column: the first column not wholly in view comes in beside it, so
  // no column is skipped or left half-hidden at both stops.
  const showMore = () => {
    const element = scroller.current
    if (!element) return
    const edge = element.getBoundingClientRect().right
    const [sticky, ...headers] = element.querySelectorAll('thead th')
    const stickyRight = sticky?.getBoundingClientRect().right ?? 0
    const next = headers.find((th) => th.getBoundingClientRect().right > edge + 1)
    const left = next ? next.getBoundingClientRect().left - stickyRight : element.clientWidth
    element.scrollBy({ left: Math.max(left, 1) })
  }
  if (rows.length === 0 || columns.length === 0) return null
  return (
    <div className={styles.matrix} ref={matrix}>
      <p className={styles.caption} id={captionId}>
        {caption}
      </p>
      <div className={styles.frame}>
        <div
          className={styles.scroll}
          ref={scroller}
          data-overflow={hiddenColumns > 0 || undefined}
        >
          <table
            className={styles.table}
            aria-labelledby={captionId}
            data-fixed={columnWidth !== undefined || undefined}
            style={
              columnWidth !== undefined
                ? ({ '--heat-column': `${columnWidth}px` } as CSSProperties)
                : undefined
            }
          >
            <thead>
              <tr>
                <th scope="col" className={styles.corner}>
                  <span className={styles.axis}>{corner}</span>
                </th>
                {columns.map((column) => {
                  const dir = sort?.column === column.key ? sort.dir : undefined
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={
                        dir === 'desc' ? 'descending' : dir === 'asc' ? 'ascending' : undefined
                      }
                    >
                      {column.label}
                      {dir && (
                        <span aria-hidden="true">{`\u00a0${dir === 'desc' ? '▼' : '▲'}`}</span>
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  {columns.map((column) => {
                    const cell = cellAt(row, column)
                    if (!cell) {
                      return (
                        <td key={column.key} className={styles.cell}>
                          —
                        </td>
                      )
                    }
                    const key = `${row.key}:${column.key}`
                    return (
                      <td
                        key={column.key}
                        className={cell.muted ? styles.cellMuted : styles.cell}
                        style={
                          cell.muted
                            ? undefined
                            : { background: cell.tint, color: tintInk(cell.tint) }
                        }
                        onPointerEnter={(event) => {
                          if (event.pointerType === 'touch') return
                          setTip(anchor(event.currentTarget, key, cell.title, false))
                        }}
                        onPointerLeave={(event) => {
                          if (event.pointerType === 'touch') return
                          setTip((current) => (current?.pinned ? current : null))
                        }}
                        onPointerUp={(event) => {
                          if (event.pointerType !== 'touch') return
                          const next = anchor(event.currentTarget, key, cell.title, true)
                          setTip((current) => (current?.key === key ? null : next))
                        }}
                      >
                        {cell.text}
                        {cell.hidden && <span className="visually-hidden">{cell.hidden}</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {hiddenColumns > 0 && (
        <button type="button" className={styles.more} onClick={showMore}>
          {hiddenColumns} more →
        </button>
      )}
      {tip && (
        <div
          ref={tipBox}
          role="tooltip"
          className={styles.tip}
          style={{
            fontFamily: TIP_OPTIONS.fontFamily,
            fontSize: TIP_OPTIONS.fontSize,
            borderColor: TIP_OPTIONS.stroke,
            ...(tipAt ? { left: tipAt.left, top: tipAt.top } : { visibility: 'hidden' }),
          }}
        >
          {tip.text}
        </div>
      )}
    </div>
  )
}

export function TransitionTable({
  rows,
  levelLabel,
  caption,
}: {
  /** One country's `transition_conditional` rows. */
  rows: readonly EstimateRow[]
  /** Answer labels from the variable's own value labels (server truth). */
  levelLabel: (level: number) => string
  caption: string
}) {
  const grid = transitionGrid(rows)
  const axis = grid.levels.map((level) => ({ key: String(level), label: levelLabel(level) }))
  return (
    <HeatTable
      caption={caption}
      corner="First answer ↓ · later answer →"
      rows={axis}
      columns={axis}
      cellAt={(from, to) => {
        const cell = grid.cells.get(`${from.key}:${to.key}`)
        if (!cell) return undefined
        return {
          text: formatEstimate(cell.estimate, cell.stat),
          title: `${formatEstimate(cell.estimate, cell.stat)} of those who first said “${from.label}” later said “${to.label}”\n${intervalText(cell)}`,
          tint: cellTint(cell.estimate),
        }
      }}
    />
  )
}
