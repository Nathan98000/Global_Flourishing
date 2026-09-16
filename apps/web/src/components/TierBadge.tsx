// Which tier answered — a thing the portfolio audience opens the network
// tab to check; say it in the UI instead.

import type { Tier } from '../api/meta'
import styles from './TierBadge.module.css'

export function TierBadge({ source }: { source: Tier }) {
  return (
    <span className={styles.badge} data-tier={source}>
      {source === 'static' ? 'served from precomputed files' : 'live query'}
    </span>
  )
}
