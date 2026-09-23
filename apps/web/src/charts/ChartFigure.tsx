// The frame around every chart (§2.10): a figure with a figcaption, a
// role="img" chart node whose aria-label states what it shows and its
// extremes, a <details> data table with the same numbers (the
// screen-reader and copy-paste path), a one-line footnote linked to
// Methods, and CSV/PNG export. Charts render inside; this never fetches.

import { Link } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import type { EstimateResponse, Meta, ResponseMeta } from '../api/types'
import { EstimateTable } from '../components/EstimateTable'
import { ProgressBar, useDelayedFlags } from '../components/Loading'
import { downloadChartPng } from '../export/png'
import styles from './ChartFigure.module.css'

export type CsvExport =
  { kind: 'server'; href: string } | { kind: 'client'; onDownload: () => void }

export type ChartMarks = 'dots' | 'bars' | 'bins' | 'map'

/** The footnote under every chart (round-2 item 7): what the lines are
 * — 95% confidence intervals, the level from the response — the
 * weighting in one clause, and where the n lives. No sentence explains
 * what a confidence interval means; that is the Methods page's job. */
export function footnoteCopy(meta: ResponseMeta, marks: ChartMarks): string {
  const level = Math.round(meta.ci_level * 100)
  const interval =
    marks === 'map'
      ? `Hover a country for its ${level}% confidence interval`
      : `Lines are ${level}% confidence intervals`
  const where = marks === 'map' ? 'n in the data table' : 'n shown per row in the data table'
  return `${interval} · weighted so each country's sample stands for its adult population · ${where}.`
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
    <figure className={styles.figure} aria-busy={isRefreshing || undefined}>
      {showProgress && <ProgressBar className={styles.progress} />}
      <figcaption className={styles.caption}>
        <span className={styles.titles}>
          <span className={styles.title}>{title}</span>
          {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
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
