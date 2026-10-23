// The labels over a dot plot's or bar chart's two columns (ADR-0029):
// the rows' names — a plain label, never a sort — and the value column by
// its statistic's own word ("Mean", "Median", "Share", "Mean change"),
// a button that reverses the order (highest first ↔ lowest first), with
// an arrow. Presentational (H16): no one-row table with no data — the
// button says what it does and the order it is in ("Sort: Mean, highest
// first"). Outside the chart node, so assistive tech reaches the button
// where that node is an image.

import type { SortDir } from '../sortRows'
import { orderPhrase } from '../views/viewState'
import styles from './SortHead.module.css'

export function SortHead({
  names,
  value,
  dir,
  onToggle,
}: {
  /** What the rows are ("Country", "State"). */
  names: string
  /** The value column's statistic, by name ("Mean"). */
  value: string
  dir: SortDir
  /** Absent, a chart whose order is fixed (What Matters' ranking, always
   * highest first): the labels alone, no button and no sort (G18). */
  onToggle?: () => void
}) {
  return (
    <div className={styles.head}>
      <div className={styles.row}>
        <span className={styles.names} data-sort-names="">
          {names}
        </span>
        {onToggle === undefined ? (
          <span className={`${styles.value} ${styles.plain}`} data-sort-value="">
            {value}
          </span>
        ) : (
          <span className={styles.value} data-sort-value="">
            <button
              type="button"
              className={styles.button}
              aria-label={`Sort: ${value}, ${orderPhrase(dir)}`}
              onClick={onToggle}
            >
              {value}
              <span className={styles.arrow} aria-hidden="true">
                {dir === 'desc' ? '▼' : '▲'}
              </span>
            </button>
          </span>
        )}
      </div>
    </div>
  )
}
