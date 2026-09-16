// A suppressed cell is data to render, never a gap: the estimate is
// withheld, the n stays visible, and the meaning is carried by hatch +
// text — not by hue alone.

import { formatCount } from '../format'
import styles from './Suppressed.module.css'

export function Suppressed({ n, threshold }: { n: number; threshold: number }) {
  return (
    <span className={styles.suppressed}>
      <span aria-hidden="true" className={styles.swatch} />
      withheld (n = {formatCount(n)}, below {formatCount(threshold)})
    </span>
  )
}

/** The 50–99 marker: shown, but flagged as a small cell. */
export function Flagged({ n }: { n: number }) {
  return (
    <span className={styles.flagged} title={`Small cell: n = ${formatCount(n)}`}>
      <span aria-hidden="true">†</span>
      <span className="visually-hidden">small cell, n = {formatCount(n)}</span>
    </span>
  )
}
