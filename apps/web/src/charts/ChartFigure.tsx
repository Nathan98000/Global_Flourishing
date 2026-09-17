// The frame around every chart (§2.10): a figure with a figcaption, a
// role="img" chart node whose aria-label states what it shows and its
// extremes, a <details> data table with the same numbers (the
// screen-reader and copy-paste path), a plain-language footnote (weights,
// precision, withholding — linked to Methods), and CSV/PNG export.
// Charts render inside; this never fetches.

import { Link } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import type { EstimateResponse, Meta, ResponseMeta } from '../api/types'
import { EstimateTable } from '../components/EstimateTable'
import { downloadChartPng } from '../export/png'
import { formatCount, isShareStat } from '../format'
import styles from './ChartFigure.module.css'

export type CsvExport =
  { kind: 'server'; href: string } | { kind: 'client'; onDownload: () => void }

export type ChartMarks = 'dots' | 'bars' | 'bins' | 'map'

/** The footnote under every chart: what a mark is, what the interval
 * means (decision 6 — a property of the procedure, never a probability
 * about this interval), how the weighting reads, and the withholding
 * rule — all numbers from the response, nothing hard-coded. */
export function footnoteCopy(meta: ResponseMeta, marks: ChartMarks): string {
  const share = isShareStat(meta.stat)
  const quantity = share ? 'share' : 'average'
  const outOf = Math.round(meta.ci_level * 100)
  const lead =
    marks === 'map'
      ? `Each country is shaded by its weighted ${quantity}. Hover one for the exact value and its interval — drawn so it contains the true value ${outOf} times out of 100.`
      : marks === 'bins'
        ? `Each bar is the weighted share giving that answer; the line through its top shows how precise that share is — intervals drawn this way contain the true value ${outOf} times out of 100.`
        : marks === 'bars'
          ? `Each bar is the weighted share answering this way; the line through its end shows how precise that share is — intervals drawn this way contain the true value ${outOf} times out of 100.`
          : `Each dot is a weighted ${quantity}; the line through it shows how precise that ${quantity} is — intervals drawn this way contain the true value ${outOf} times out of 100.`
  return (
    `${lead} Weighted so each country's sample stands for its adult population. ` +
    `Groups with fewer than ${formatCount(meta.suppression.threshold)} answers are withheld; ` +
    `groups under ${formatCount(meta.suppression.flag_below)} are marked †.`
  )
}

export function ChartFigure({
  title,
  subtitle,
  ariaLabel,
  marks = 'dots',
  intro,
  response,
  meta,
  csv,
  isRefreshing = false,
  children,
}: {
  title: string
  subtitle?: string
  /** What the chart shows and its extremes — the screen-reader summary. */
  ariaLabel: string
  /** Which mark the footnote glosses. */
  marks?: ChartMarks
  /** Rendered between the caption and the chart — the question wording
   * lives here (decision 3), outside the role="img" node so assistive
   * tech reads it. */
  intro?: React.ReactNode
  response: EstimateResponse
  meta: Meta
  csv?: CsvExport
  /** Refetch keeps the frame: previous render held at reduced opacity. */
  isRefreshing?: boolean
  children: React.ReactNode
}) {
  const chartRef = useRef<HTMLDivElement | null>(null)
  const [pngFailed, setPngFailed] = useState(false)

  const exportPng = async () => {
    const svg = chartRef.current?.querySelector('svg')
    if (!svg) {
      setPngFailed(true)
      return
    }
    try {
      const ok = await downloadChartPng(svg, {
        title,
        dataVersion: response.meta.data_version,
      })
      setPngFailed(!ok)
    } catch {
      setPngFailed(true)
    }
  }

  return (
    <figure className={styles.figure}>
      <figcaption className={styles.caption}>
        <span className={styles.titles}>
          <span className={styles.title}>{title}</span>
          {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
        </span>
        <span className={styles.actions}>
          {csv &&
            (csv.kind === 'server' ? (
              <a className={styles.action} href={csv.href} download>
                CSV
              </a>
            ) : (
              <button type="button" className={styles.action} onClick={csv.onDownload}>
                CSV
              </button>
            ))}
          <button type="button" className={styles.action} onClick={() => void exportPng()}>
            PNG
          </button>
        </span>
      </figcaption>
      {pngFailed && (
        <p role="status" className={styles.exportNote}>
          PNG export isn&rsquo;t available in this browser — the data table below has the same
          numbers.
        </p>
      )}
      {intro}
      <div
        ref={chartRef}
        role="img"
        aria-label={ariaLabel}
        className={styles.chart}
        data-refreshing={isRefreshing || undefined}
      >
        {children}
      </div>
      <details className={styles.details}>
        <summary>Data table</summary>
        <EstimateTable response={response} meta={meta} />
      </details>
      <p className={styles.provenance}>
        {footnoteCopy(response.meta, marks)} <Link to="/methods">How these numbers are made</Link>
      </p>
    </figure>
  )
}
