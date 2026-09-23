// The progress affordance for slow calls (Phase 5, owner decision 1):
// the skeleton exactly as today at 0 ms, a thin indeterminate bar after
// 600 ms, and one line of plain copy after 4 s. A progress bar attached
// to a skeleton — never a spinner (the proposal's risk table commits to
// skeletons; ADR-0013 records why this does not contradict it). The
// block's height is fixed by the caller, so nothing shifts when the data
// lands; the bar and the note are positioned inside it.
//
// Refetches keep the chart: ChartFigure dims the previous render and
// mounts the same bar at its top edge — it never swaps in a block.

import { useEffect, useState } from 'react'
import skeleton from './Skeleton.module.css'
import styles from './Loading.module.css'

/** After this long, the indeterminate bar appears. */
export const PROGRESS_AFTER_MS = 600
/** After this long, the "still working" line appears under the bar. */
export const STILL_WORKING_AFTER_MS = 4000

export const STILL_WORKING_COPY = 'Still working — the first data fetch can take a few seconds.'

const DEFAULT_DELAYS: readonly number[] = [PROGRESS_AFTER_MS, STILL_WORKING_AFTER_MS]

/**
 * One flag per delay: `flags[i]` turns true `delays[i]` ms after `active`
 * became true, and every flag resets the moment `active` turns false —
 * the next wait starts its own clock.
 */
export function useDelayedFlags(
  active: boolean,
  delays: readonly number[] = DEFAULT_DELAYS,
): boolean[] {
  const [reached, setReached] = useState(0)
  const delayKey = delays.join(',')
  useEffect(() => {
    setReached(0)
    if (!active) return
    const timers = delayKey.split(',').map((delay, index) =>
      window.setTimeout(() => {
        setReached((current) => Math.max(current, index + 1))
      }, Number(delay)),
    )
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [active, delayKey])
  return delays.map((_, index) => active && reached > index)
}

/** The 2px indeterminate bar: accent sweep on the grid track; a static
 * filled rule under prefers-reduced-motion. Decorative — the block or
 * figure it sits in carries the status semantics. */
export function ProgressBar({ className }: { className?: string }) {
  return (
    <div className={className ? `${styles.bar} ${className}` : styles.bar} aria-hidden="true">
      <span className={styles.sweep} />
    </div>
  )
}

export function LoadingBlock({ height, label }: { height: number | string; label?: string }) {
  const [showProgress, showNote] = useDelayedFlags(true)
  return (
    // role="status" + aria-busy: the block announces its label once when
    // it appears; the note added at 4 s is a stable node inside a busy
    // region, so it is neither re-created nor re-announced on repaint.
    <div
      className={`${skeleton.skeleton} ${styles.block}`}
      style={{ height }}
      role="status"
      aria-busy="true"
      aria-label={label ?? 'Loading'}
    >
      {showProgress && <ProgressBar />}
      {showNote && <p className={styles.note}>{STILL_WORKING_COPY}</p>}
    </div>
  )
}
