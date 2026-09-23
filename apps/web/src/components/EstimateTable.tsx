// The numbers behind a view, as a real table: the screen-reader path and
// the copy-paste path for every chart, and a view in its own right.
// Columns: the row's identity, Estimate, the CI, and n (§6 — the weight
// is named once in the caption). Every cell is shown (ADR-0011); a
// missing interval reads "—" and the n rides on every row.

import type { EstimateResponse, EstimateRow } from '../api/types'
import { ciLabel, formatCI, formatCount, formatEstimate } from '../format'
import { columnLabel, groupValueLabel } from '../labels'
import type { Meta } from '../api/types'
import { legTitle } from '../waves'
import styles from './EstimateTable.module.css'

/** The transition measures in words (the engine's names never reach the page). */
const MEASURE_WORDS: Record<string, string> = {
  transition_joint: 'share of all pairs',
  transition_conditional: 'share within the first answer',
}

function present(
  rows: readonly EstimateRow[],
  key: 'level' | 'p' | 'leg' | 'from_level' | 'to_level' | 'measure',
) {
  return rows.some((row) => row[key] !== null && row[key] !== undefined)
}

export function EstimateTable({
  response,
  meta,
  caption,
  levelLabel,
  groupLabel,
}: {
  response: EstimateResponse
  meta: Meta
  caption?: string
  /** Answer labels for level / from / to cells (the variable's own value
   * labels); absent = the code. */
  levelLabel?: (level: number) => string | undefined
  /** Labels for a group column meta cannot name (e.g. a measure code in
   * the Compare view); falls back to meta's labels. */
  groupLabel?: (column: string, value: string | number) => string | undefined
}) {
  const by = response.meta.by
  const rows = response.rows
  const hasLevel = present(rows, 'level')
  const hasP = present(rows, 'p')
  const hasLeg = present(rows, 'leg')
  const hasTransition = present(rows, 'from_level') || present(rows, 'to_level')
  const hasMeasure = present(rows, 'measure')
  const level = (value: number | null | undefined) =>
    value === null || value === undefined ? '—' : (levelLabel?.(value) ?? String(value))
  return (
    // Scrolls sideways rather than breaking the column (§8); under
    // 30rem the CI column is dropped from the *display* — it stays in
    // the CSV and the chart whiskers.
    <div className={styles.scroll}>
      <table className={styles.table}>
        {/* The weight is named once here, not repeated on every row (§6). */}
        <caption className={styles.caption}>
          {caption ? `${caption} · ` : ''}Weighted estimates ({response.meta.weight}).
        </caption>
        <thead>
          <tr>
            {by.map((column) => (
              <th key={column} scope="col">
                {columnLabel(column, meta)}
              </th>
            ))}
            {hasLeg && <th scope="col">Period</th>}
            {hasLevel && <th scope="col">Level</th>}
            {hasTransition && <th scope="col">First answer</th>}
            {hasTransition && <th scope="col">Later answer</th>}
            {hasMeasure && <th scope="col">Measure</th>}
            {hasP && <th scope="col">p</th>}
            <th scope="col">Estimate</th>
            <th scope="col" className={styles.ci}>
              {ciLabel(response.meta.ci_level)}
            </th>
            <th scope="col">n</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {by.map((column) => (
                <td key={column}>
                  {groupValueLabel(column, row.group[column] ?? null, meta, groupLabel)}
                </td>
              ))}
              {hasLeg && <td>{legTitle(row.leg)}</td>}
              {hasLevel && <td>{level(row.level)}</td>}
              {hasTransition && <td>{level(row.from_level)}</td>}
              {hasTransition && <td>{level(row.to_level)}</td>}
              {hasMeasure && (
                <td>{row.measure ? (MEASURE_WORDS[row.measure] ?? row.measure) : '—'}</td>
              )}
              {hasP && <td>{row.p ?? '—'}</td>}
              <td className={styles.number}>{formatEstimate(row.estimate, row.stat)}</td>
              <td className={`${styles.number} ${styles.ci}`}>{formatCI(row)}</td>
              <td className={styles.number}>{formatCount(row.n)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
