// One estimate with everything it must never appear without (CLAUDE.md):
// the CI, the unweighted n, and the weight.

import type { EstimateRow } from '../api/types'
import { ciLabel, formatCI, formatCount, formatEstimate } from '../format'
import styles from './Stat.module.css'

export function Stat({ row }: { row: EstimateRow }) {
  return (
    <span className={styles.stat}>
      <strong className={styles.estimate}>{formatEstimate(row.estimate, row.stat)}</strong>
      {row.ci_lo !== null && row.ci_hi !== null && (
        <span className={styles.ci}>
          {formatCI(row)} <span className={styles.dim}>({ciLabel(row.ci_level)})</span>
        </span>
      )}
      <span className={styles.meta}>
        n = {formatCount(row.n)} · {row.weight}
      </span>
    </span>
  )
}
