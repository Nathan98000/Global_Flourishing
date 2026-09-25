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
import { exportFilename, type ExportName } from '../export/filename'
import { downloadChartPng } from '../export/png'
import styles from './ChartFigure.module.css'

/** A subtitle starts with a capital, whatever clause leads it. */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export type CsvExport =
  { kind: 'server'; href: string } | { kind: 'client'; onDownload: () => void }

export type ChartMarks = 'dots' | 'bars' | 'bins' | 'state-map' | 'table'

/** The footnote under every chart (round-2 item 7): what the lines are
 * — 95% confidence intervals, the level from the response — the
 * weighting in one clause, and where the n lives. No sentence explains
 * what a confidence interval means; that is the Methods page's job. A
 * response of point estimates (`ci_method = "none"`: plain correlations)
 * says so instead of naming an interval that does not exist. */
export function footnoteCopy(
  meta: ResponseMeta,
  marks: ChartMarks,
  intervals = true,
  unit: 'country' | 'state' = marks === 'state-map' ? 'state' : 'country',
): string {
  const level = Math.round(meta.ci_level * 100)
  // The noun follows the statistic that ships without an interval.
  const noun = meta.stat === 'quantile' ? 'a median' : 'a correlation'
  const interval = !intervals
    ? marks === 'table'
      ? `Cells are point estimates — no confidence interval is computed for ${noun}`
      : `Dots are point estimates — no confidence interval is computed for ${noun}`
    : marks === 'state-map'
      ? `Hover a state for its ${level}% confidence interval`
      : marks === 'table'
        ? `Hover a cell for its ${level}% confidence interval`
        : `Lines are ${level}% confidence intervals`
  const where =
    marks === 'state-map' || marks === 'table'
      ? 'n in the data table'
      : 'n shown per row in the data table'
  return `${interval} · weighted so each ${unit}'s sample stands for its adult population · ${where}.`
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
  exportName,
  isRefreshing = false,
  levelLabel,
  groupLabel,
  predictorLabel,
  footnote,
  unit,
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
  /** What the PNG download is called, in words (export/filename.ts); the
   * view's CSV shares it. Absent: the title alone names the file. */
  exportName?: ExportName
  /** Refetch keeps the frame: previous render held at reduced opacity. */
  isRefreshing?: boolean
  /** Passed through to the data table (see EstimateTable). */
  levelLabel?: (level: number) => string | undefined
  groupLabel?: (column: string, value: string | number) => string | undefined
  predictorLabel?: (name: string) => string | undefined
  /** Extra plain sentences in the footnote, before the Methods link (a
   * caveat the view owes its reader — never a callout box). */
  footnote?: React.ReactNode
  /** Whose sample the weights stand for (a state view's chart is
   * weighted by state whatever mark it draws). */
  unit?: 'country' | 'state'
  children: React.ReactNode
}) {
  const chartRef = useRef<HTMLDivElement | null>(null)
  const [pngFailed, setPngFailed] = useState(false)
  // A refetch keeps the chart (dimmed) and, past the same 600 ms, wears
  // the thin progress bar on its top rule — never a loading block.
  const [showProgress] = useDelayedFlags(isRefreshing)
  // Plain correlations ship no interval at all; the footnote must not
  // describe lines that are not drawn.
  const intervals = !(
    response.rows.length > 0 && response.rows.every((row) => row.ci_method === 'none')
  )

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
        <EstimateTable
          response={response}
          meta={meta}
          levelLabel={levelLabel}
          groupLabel={groupLabel}
          predictorLabel={predictorLabel}
        />
      </details>
      <p className={styles.provenance}>
        {footnoteCopy(response.meta, marks, intervals, unit)} {footnote}
        <Link to="/methods">How these numbers are made</Link>
      </p>
    </figure>
  )
}
