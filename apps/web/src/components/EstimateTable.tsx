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

/** The sub-row measures in words (the engine's names never reach the
 * page): the transition matrix's two shares, and the adjusted model's
 * two coefficients — per unit of the measure, and per one standard
 * deviation of it. */
const MEASURE_WORDS: Record<string, string> = {
  transition_joint: 'share of all pairs',
  transition_conditional: 'share within the first answer',
  beta: 'per unit of the measure',
  beta_per_sd: 'per one standard deviation of the measure',
}

function present(
  rows: readonly EstimateRow[],
  key: 'predictor' | 'level' | 'p' | 'leg' | 'from_level' | 'to_level' | 'measure',
) {
  return rows.some((row) => row[key] !== null && row[key] !== undefined)
}

export function EstimateTable({
  response,
  meta,
  caption,
  levelLabel,
  groupLabel,
  predictorLabel,
}: {
  response: EstimateResponse
  meta: Meta
  caption?: string
  /** Answer labels for the Answer / First answer / Later answer cells
   * (the variable's own value labels); absent or blank = the code (a
   * 0–10 scale labels only its ends — ADR-0016). */
  levelLabel?: (level: number) => string | undefined
  /** Labels for a group column meta cannot name (e.g. a measure code in
   * What Matters); falls back to meta's labels. */
  groupLabel?: (column: string, value: string | number) => string | undefined
  /** Display names for the `predictor` sub-row key (the Correlates view's
   * catalog names); absent = the code. */
  predictorLabel?: (name: string) => string | undefined
}) {
  const by = response.meta.by
  const rows = response.rows
  const hasPredictor = present(rows, 'predictor')
  const hasLevel = present(rows, 'level')
  const hasP = present(rows, 'p')
  const hasLeg = present(rows, 'leg')
  const hasTransition = present(rows, 'from_level') || present(rows, 'to_level')
  const hasMeasure = present(rows, 'measure')
  // The adjusted model's rows distinguish two units of the same
  // coefficient; the transition matrix's rows distinguish two shares.
  const measureHeader = rows.some((row) => row.stat === 'beta') ? 'Unit' : 'Measure'
  // A response of point estimates (plain correlations) has no interval to
  // tabulate: the column goes, rather than a column of dashes under "95% CI".
  const hasIntervals = !(rows.length > 0 && rows.every((row) => row.ci_method === 'none'))
  const level = (value: number | null | undefined) => {
    if (value === null || value === undefined) return '—'
    const named = levelLabel?.(value)
    return named?.trim() ? named : String(value)
  }
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
            {hasPredictor && <th scope="col">Measure</th>}
            {by.map((column) => (
              <th key={column} scope="col">
                {columnLabel(column, meta)}
              </th>
            ))}
            {hasLeg && <th scope="col">Period</th>}
            {hasLevel && <th scope="col">Answer</th>}
            {hasTransition && <th scope="col">First answer</th>}
            {hasTransition && <th scope="col">Later answer</th>}
            {hasMeasure && <th scope="col">{measureHeader}</th>}
            {hasP && <th scope="col">p</th>}
            <th scope="col">Estimate</th>
            {hasIntervals && (
              <th scope="col" className={styles.ci}>
                {ciLabel(response.meta.ci_level)}
              </th>
            )}
            <th scope="col">n</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {hasPredictor && (
                <td>{row.predictor ? (predictorLabel?.(row.predictor) ?? row.predictor) : '—'}</td>
              )}
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
              {hasIntervals && <td className={`${styles.number} ${styles.ci}`}>{formatCI(row)}</td>}
              <td className={styles.number}>{formatCount(row.n)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
