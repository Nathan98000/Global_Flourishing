// A page's stand-in while its code or its first data arrives (F21, H7),
// under the page's own (visually hidden) heading:
// shaped like the page it stands for — the deck, the question bar, then
// the chart's title and a block where the chart will be — so what
// arrives takes its place rather than pushing the page about. index.html
// paints the same shape before any script has run (its boot shell).

import { LoadingBlock } from './Loading'
import styles from './PagePlaceholder.module.css'

export function PagePlaceholder({ label = 'Loading' }: { label?: string }) {
  return (
    <div className={styles.page} aria-busy="true">
      <div className={styles.deck} aria-hidden="true">
        <span />
        <span />
      </div>
      <div className={styles.bar} aria-hidden="true">
        <span className={styles.field} />
        <span className={styles.field} data-narrow="" />
      </div>
      <div className={styles.caption} aria-hidden="true">
        <span className={styles.title} />
        <span className={styles.subtitle} />
      </div>
      <LoadingBlock height={420} label={label} />
    </div>
  )
}
