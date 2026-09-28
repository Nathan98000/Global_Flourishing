// A correlation in a line (ADR-0019): "Correlation", a 220px track from
// −1 to 1 with ticks at −1, 0 and +1, a dot in the sign's hue, and the
// signed value — the same encoding as the Find related rows, and no
// strength word. Few people behind it: an asterisk. HTML, not a plot: it
// sits in Compare two's header row, beside the scope toggle.

import type { EstimateRow } from '../api/types'
import { formatEstimate } from '../format'
import styles from './CorrelationStrip.module.css'
import { signMark } from './theme'

export function CorrelationStrip({
  row,
  flagged = false,
}: {
  row: Pick<EstimateRow, 'estimate' | 'stat'>
  flagged?: boolean
}) {
  const value = row.estimate
  const at = value === null ? null : ((Math.max(-1, Math.min(1, value)) + 1) / 2) * 100
  const text = `${formatEstimate(value, row.stat)}${flagged ? '*' : ''}`
  return (
    <div className={styles.strip}>
      <span className={styles.label}>Correlation</span>
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
          {text}
          {flagged && <span className="visually-hidden">, few people behind this estimate</span>}
        </span>
      </span>
    </div>
  )
}
