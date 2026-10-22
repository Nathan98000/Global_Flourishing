// The chart's one-line key, in its header (ADR-0029): the mark and what
// it is — "● mean", "▬ share" — and, where the marks carry one, the
// whisker and its interval by name, "⟝⟞ 95% CI" (the level from the
// response, never a literal). Drawn in the charts' own tokens, so it
// reads true to the marks; the words name the statistic as the hover
// cards do (Mean, Median, Share). When the chart holds an estimate few
// people are behind, the key adds its hollow mark and asterisk with the
// server's number: "○* fewer than 30 people" (ADR-0031).

import { ciLabel } from '../format'
import styles from './ChartKey.module.css'
import { thinKey } from './theme'

export function ChartKey({
  mark,
  label,
  color = 'var(--series-1)',
  ciLevel,
  thinBelow,
}: {
  /** A dot (a location statistic, a change) or a bar (a share). */
  mark: 'dot' | 'bar'
  /** What the mark is, lower case: "mean", "median", "share". */
  label: string
  color?: string
  /** The interval's level, when the marks carry intervals. */
  ciLevel?: number
  /** `meta.suppression.flag_below`, when the chart holds a thin
   * estimate (theme.ts anyThin); absent, no entry. */
  thinBelow?: number
}) {
  return (
    <span className={styles.key}>
      <span className={styles.entry} data-key={mark} data-color={color}>
        <svg className={styles.glyph} viewBox="0 0 14 10" aria-hidden="true" focusable="false">
          {mark === 'dot' ? (
            <circle cx="7" cy="5" r="4" fill={color} />
          ) : (
            <rect x="0" y="1.5" width="14" height="7" rx="1.5" fill={color} />
          )}
        </svg>
        {label}
      </span>
      {ciLevel !== undefined && (
        <span className={styles.entry} data-key="whisker" data-color={color}>
          <svg
            className={`${styles.glyph} ${styles.whisker}`}
            viewBox="0 0 18 10"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M1 5h16M1 2v6M17 2v6" stroke="var(--whisker)" strokeWidth="1.5" fill="none" />
          </svg>
          {ciLabel(ciLevel)}
        </span>
      )}
      {thinBelow !== undefined && (
        <span className={styles.entry} data-key={`thin-${mark}`} data-color={color}>
          <svg className={styles.glyph} viewBox="0 0 14 10" aria-hidden="true" focusable="false">
            {mark === 'dot' ? (
              <circle
                cx="7"
                cy="5"
                r="3.5"
                fill="var(--surface)"
                stroke={color}
                strokeWidth="1.5"
              />
            ) : (
              <rect
                x="0.75"
                y="2"
                width="12.5"
                height="6"
                rx="1.5"
                fill="var(--surface)"
                stroke={color}
                strokeWidth="1.5"
              />
            )}
          </svg>
          * {thinKey(thinBelow)}
        </span>
      )}
    </span>
  )
}
