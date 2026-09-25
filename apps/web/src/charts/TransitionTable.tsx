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

import { useEffect, useId, useRef, useState } from 'react'
import type { EstimateRow } from '../api/types'
import { ciText, formatEstimate } from '../format'
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
  /** The tooltip: value, context, interval (never the n — ADR-0016). */
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
 * an "N more …" hint say so. */
export function HeatTable({
  caption,
  corner,
  rows,
  columns,
  cellAt,
  columnNoun = 'columns',
}: {
  caption: string
  /** The corner label naming both axes ("First answer ↓ · later answer →"). */
  corner: string
  rows: readonly HeatAxis[]
  columns: readonly HeatAxis[]
  cellAt: (row: HeatAxis, column: HeatAxis) => HeatCell | undefined
  /** What the columns are, for the overflow hint ("3 more countries →"). */
  columnNoun?: string
}) {
  const captionId = useId()
  const scroller = useRef<HTMLDivElement | null>(null)
  const [hiddenColumns, setHiddenColumns] = useState(0)
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
  }, [columns.length, rows.length])
  if (rows.length === 0 || columns.length === 0) return null
  return (
    <div className={styles.matrix}>
      <p className={styles.caption} id={captionId}>
        {caption}
      </p>
      <div className={styles.scroll} ref={scroller} data-overflow={hiddenColumns > 0 || undefined}>
        <table className={styles.table} aria-labelledby={captionId}>
          <thead>
            <tr>
              <th scope="col" className={styles.corner}>
                <span className={styles.axis}>{corner}</span>
              </th>
              {columns.map((column) => (
                <th key={column.key} scope="col">
                  {column.label}
                </th>
              ))}
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
                  return (
                    <td
                      key={column.key}
                      className={cell.muted ? styles.cellMuted : styles.cell}
                      style={
                        cell.muted
                          ? undefined
                          : { background: cell.tint, color: tintInk(cell.tint) }
                      }
                      title={cell.title}
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
      {hiddenColumns > 0 && (
        <p className={styles.more} aria-hidden="true">
          {hiddenColumns} more {columnNoun} →
        </p>
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
