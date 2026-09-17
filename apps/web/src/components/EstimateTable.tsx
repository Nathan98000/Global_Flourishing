// The numbers behind a view, as a real table: the screen-reader path and
// the copy-paste path for every chart, and a view in its own right.
// Columns: the row's identity, Estimate, the CI, and n (§6 — the weight
// is named once in the caption). Every cell is shown (ADR-0011); a
// missing interval reads "—" and the n rides on every row.

import type { EstimateResponse } from '../api/types'
import { ciLabel, formatCI, formatCount, formatEstimate } from '../format'
import { columnLabel, groupValueLabel } from '../labels'
import type { Meta } from '../api/types'
import styles from './EstimateTable.module.css'

export function EstimateTable({
  response,
  meta,
  caption,
}: {
  response: EstimateResponse
  meta: Meta
  caption?: string
}) {
  const by = response.meta.by
  const hasLevel = response.rows.some((row) => row.level !== null && row.level !== undefined)
  const hasP = response.rows.some((row) => row.p !== null && row.p !== undefined)
  return (
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
          {hasLevel && <th scope="col">Level</th>}
          {hasP && <th scope="col">p</th>}
          <th scope="col">Estimate</th>
          <th scope="col">{ciLabel(response.meta.ci_level)}</th>
          <th scope="col">n</th>
        </tr>
      </thead>
      <tbody>
        {response.rows.map((row, index) => (
          <tr key={index}>
            {by.map((column) => (
              <td key={column}>{groupValueLabel(column, row.group[column] ?? null, meta)}</td>
            ))}
            {hasLevel && <td>{row.level ?? '—'}</td>}
            {hasP && <td>{row.p ?? '—'}</td>}
            <td className={styles.number}>{formatEstimate(row.estimate, row.stat)}</td>
            <td className={styles.number}>{formatCI(row)}</td>
            <td className={styles.number}>{formatCount(row.n)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
