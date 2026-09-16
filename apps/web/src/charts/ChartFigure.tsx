// The frame around every chart (§2.10): a figure with a figcaption, a
// role="img" chart node whose aria-label states what it shows and its
// extremes, a <details> data table with the same numbers (the
// screen-reader and copy-paste path), the provenance line, the tier
// badge, and CSV/PNG export. Charts render inside; this never fetches.

import { useRef, useState } from 'react'
import type { Tier } from '../api/meta'
import type { EstimateResponse, Meta } from '../api/types'
import { EstimateTable } from '../components/EstimateTable'
import { TierBadge } from '../components/TierBadge'
import { downloadChartPng } from '../export/png'
import { provenanceLine } from '../format'
import styles from './ChartFigure.module.css'

export type CsvExport =
  { kind: 'server'; href: string } | { kind: 'client'; onDownload: () => void }

export function ChartFigure({
  title,
  subtitle,
  ariaLabel,
  tier,
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
  tier?: Tier
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
          {tier && <TierBadge source={tier} />}
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
      <p className={styles.provenance}>{provenanceLine(response.meta)}</p>
    </figure>
  )
}
