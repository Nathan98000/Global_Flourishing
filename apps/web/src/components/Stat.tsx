// One estimate with everything it must never appear without (CLAUDE.md):
// the CI and the unweighted n. The weighting is said in words by the
// figure's footnote, never as a weight code (the tooltips dropped the
// codes in the 24 Sept review; the header line follows).

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
      <span className={styles.meta}>n = {formatCount(row.n)}</span>
    </span>
  )
}
