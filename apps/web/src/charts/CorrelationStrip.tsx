// A correlation in a line (ADR-0019): "Correlation" and what it is (F12:
// "how closely two answers rise and fall together, from −1 to +1"), a
// 220px track from −1 to 1 with ticks at −1, 0 and +1, a dot in the
// sign's hue (neutral ink at 0.00), and the value named by its scope —
// "United States: +0.54", "All countries: +0.10" — the same encoding as
// the Find related rows, with their direction words at its ends, and no
// strength word. Few people behind it: an asterisk. HTML, not a plot: it
// heads Compare two's chart.

import type { EstimateRow } from '../api/types'
import { formatEstimate } from '../format'
import { FEW_PEOPLE_HIDDEN } from '../views/correlatesRows'
import styles from './CorrelationStrip.module.css'
import { signMark } from './theme'

/** "higher" and "lower" set apart, as everywhere the page says them. */
function turned(text: string) {
  return text.split(/\b(higher|lower)\b/).map((part, index) =>
    index % 2 === 1 ? (
      <em key={index} className={styles.turn}>
        {part}
      </em>
    ) : (
      part
    ),
  )
}

export function CorrelationStrip({
  row,
  scope,
  flagged = false,
  ends,
}: {
  row: Pick<EstimateRow, 'estimate' | 'stat'>
  /** Where the number is taken: a country's name, or "All countries". */
  scope: string
  flagged?: boolean
  /** The words at the scale's two ends (Find related's: "← goes with
   * lower answers to …", "goes with higher answers to … →"). */
  ends?: [string, string]
}) {
  const value = row.estimate
  const at = value === null ? null : ((Math.max(-1, Math.min(1, value)) + 1) / 2) * 100
  const text = `${formatEstimate(value, row.stat)}${flagged ? '*' : ''}`
  return (
    <div className={styles.strip}>
      <span className={styles.label}>
        Correlation{' '}
        <span className={styles.hint}>
          — how closely two answers rise and fall together, from −1 to +1
        </span>
      </span>
      <span className={styles.line}>
        <span className={styles.track} aria-hidden="true">
          {[0, 50, 100].map((left) => (
            <span key={left} className={styles.tick} style={{ left: `${left}%` }} />
          ))}
          {at !== null && (
            <span className={styles.dot} style={{ left: `${at}%`, background: signMark(value) }} />
          )}
          <span className={styles.end} style={{ left: '0%' }}>
            −1
          </span>
          <span className={styles.end} style={{ left: '50%' }}>
            0
          </span>
          <span className={styles.end} style={{ left: '100%' }}>
            +1
          </span>
        </span>
        <span className={styles.value}>
          <span className={styles.scope}>{scope}:</span> {text}
          {flagged && <span className="visually-hidden">{FEW_PEOPLE_HIDDEN}</span>}
        </span>
      </span>
      {ends && (
        <span className={styles.ends}>
          <span>{turned(ends[0])}</span>
          <span>{turned(ends[1])}</span>
        </span>
      )}
    </div>
  )
}
