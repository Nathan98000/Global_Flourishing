// The frame around every chart (§2.10): a figure with a figcaption, a
// role="img" chart node whose aria-label states what it shows and its
// extremes, and CSV/PNG export — no data table and no line under the
// chart (ADR-0022, ADR-0024): each mark's hover card carries its value,
// its 95% CI and its n, and the CSV carries every number. Charts render
// inside; this never fetches.

import { useRef, useState } from 'react'
import { ProgressBar, useDelayedFlags } from '../components/Loading'
import { exportFilename, type ExportName } from '../export/filename'
import { downloadChartPng } from '../export/png'
import styles from './ChartFigure.module.css'

/** A subtitle starts with a capital, whatever clause leads it. */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export type CsvExport =
  { kind: 'server'; href: string } | { kind: 'client'; onDownload: () => void }

export function ChartFigure({
  title,
  subtitle,
  ariaLabel,
  intro,
  legend,
  csv,
  exportName,
  isRefreshing = false,
  wide = false,
  interactive = false,
  children,
}: {
  title: string
  subtitle?: string
  /** What the chart shows and its extremes — the screen-reader summary. */
  ariaLabel: string
  /** Rendered between the caption and the chart — the question wording
   * lives here (decision 3), outside the role="img" node so assistive
   * tech reads it. */
  intro?: React.ReactNode
  /** Rendered right under the chart: a key that reads the marks above it
   * (Compare two's shades), outside the role="img" node so assistive
   * tech reads it — never a note about the numbers (ADR-0024). */
  legend?: React.ReactNode
  csv?: CsvExport
  /** What the PNG download is called, in words (export/filename.ts); the
   * view's CSV shares it. Absent: the title alone names the file. */
  exportName?: ExportName
  /** Refetch keeps the frame: previous render held at reduced opacity. */
  isRefreshing?: boolean
  /** The chart may be wider than the text column (a HeatTable with
   * `wide`, which scrolls in its own box below 1200px): the chart node
   * lets it out rather than clipping it. */
  wide?: boolean
  /** The chart holds controls (the Correlates list's row buttons): it is
   * a labelled group, not an image, so they stay in the a11y tree. */
  interactive?: boolean
  children: React.ReactNode
}) {
  const chartRef = useRef<HTMLDivElement | null>(null)
  const [pngFailed, setPngFailed] = useState(false)
  // A refetch keeps the chart (dimmed) and, past the same 600 ms, wears
  // the thin progress bar on its top rule — never a loading block.
  const [showProgress] = useDelayedFlags(isRefreshing)

  const exportPng = async () => {
    const svg = chartRef.current?.querySelector('svg')
    if (!svg) {
      setPngFailed(true)
      return
    }
    try {
      const ok = await downloadChartPng(
        svg,
        { title },
        exportFilename(exportName ?? { measure: title, view: 'Chart', waves: '' }, 'png'),
      )
      setPngFailed(!ok)
    } catch {
      setPngFailed(true)
    }
  }

  return (
    <figure className={styles.figure} aria-busy={isRefreshing || undefined}>
      {showProgress && <ProgressBar className={styles.progress} />}
      <figcaption className={styles.caption}>
        <span className={styles.titles}>
          <span className={styles.title}>{title}</span>
          {subtitle && <span className={styles.subtitle}>{capitalize(subtitle)}</span>}
        </span>
        {/* Text links, not outlined buttons (§6): "Download CSV · PNG". */}
        <span className={styles.actions}>
          {csv &&
            (csv.kind === 'server' ? (
              <a className={styles.action} href={csv.href} download>
                Download CSV
              </a>
            ) : (
              <button type="button" className={styles.action} onClick={csv.onDownload}>
                Download CSV
              </button>
            ))}
          {csv && <span aria-hidden="true">·</span>}
          <button
            type="button"
            className={styles.action}
            aria-label="Download PNG"
            onClick={() => void exportPng()}
          >
            PNG
          </button>
        </span>
      </figcaption>
      {pngFailed && (
        <p role="status" className={styles.exportNote}>
          PNG export isn&rsquo;t available in this browser — the CSV has the same numbers.
        </p>
      )}
      {intro}
      <div
        ref={chartRef}
        role={interactive ? 'group' : 'img'}
        aria-label={ariaLabel}
        className={styles.chart}
        data-refreshing={isRefreshing || undefined}
        data-wide={wide || undefined}
      >
        {children}
      </div>
      {legend}
    </figure>
  )
}
