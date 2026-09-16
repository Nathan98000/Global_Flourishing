// Loading placeholder sized like the content it stands in for — the
// proposal's risk table is explicit: skeletons, never spinners.

import styles from './Skeleton.module.css'

export function Skeleton({ height, label }: { height: number | string; label?: string }) {
  return (
    <div
      className={styles.skeleton}
      style={{ height }}
      role="status"
      aria-label={label ?? 'Loading'}
    />
  )
}
