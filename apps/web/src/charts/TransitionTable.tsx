// Where people moved between answers (Phase 5): the transition matrix
// of an ordinal/nominal item as a small heatmap table — rows are the
// earlier answer, columns the later one, each cell the share of the
// row's people who gave that later answer (the engine's conditional
// measure; each row sums to 100%). Cells are tinted by share with the
// accent token at graded opacity, so both themes keep ink text on top;
// every cell is shown with its CI and n in the tooltip and in the data
// table beneath the figure (ADR-0011). Never fetches.

import type { EstimateRow } from '../api/types'
import { ciLabel, formatCount, formatEstimate } from '../format'
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

/** Accent at graded opacity — a token-only heat scale. */
export function cellTint(share: number | null): string {
  if (share === null) return 'transparent'
  const percent = 6 + Math.round(Math.min(1, Math.max(0, share)) * 44)
  return `color-mix(in srgb, var(--accent) ${percent}%, transparent)`
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
  if (grid.levels.length === 0) return null
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <caption className={styles.caption}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={styles.corner}>
              <span className={styles.axis}>First answer ↓ · later answer →</span>
            </th>
            {grid.levels.map((level) => (
              <th key={level} scope="col">
                {levelLabel(level)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.levels.map((from) => (
            <tr key={from}>
              <th scope="row">{levelLabel(from)}</th>
              {grid.levels.map((to) => {
                const cell = grid.cells.get(`${from}:${to}`)
                if (!cell) {
                  return (
                    <td key={to} className={styles.cell}>
                      —
                    </td>
                  )
                }
                const interval =
                  cell.ci_lo !== null && cell.ci_hi !== null
                    ? `${ciLabel(cell.ci_level)} ${formatEstimate(cell.ci_lo, cell.stat)} to ${formatEstimate(cell.ci_hi, cell.stat)}`
                    : 'no interval (single sampling unit)'
                return (
                  <td
                    key={to}
                    className={styles.cell}
                    style={{ background: cellTint(cell.estimate) }}
                    title={`${formatEstimate(cell.estimate, cell.stat)} of those who first said “${levelLabel(from)}” later said “${levelLabel(to)}”\n${interval}\nn = ${formatCount(cell.n)}`}
                  >
                    {formatEstimate(cell.estimate, cell.stat)}
                    <span className="visually-hidden">, n = {formatCount(cell.n)}</span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
