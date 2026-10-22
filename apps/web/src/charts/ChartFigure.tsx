// The frame around every chart (§2.10): a figure with a figcaption, a
// role="img" chart node whose aria-label states what it shows and its
// extremes, and CSV/PNG export — no data table and no line under the
// chart (ADR-0022, ADR-0024): each mark's hover card carries its value,
// its 95% CI and its n, and the CSV carries every number. Charts render
// inside; this never fetches.
//
// The header (ADR-0029, G4): the title and the subtitle — which carries
// the view's state in the controls' words — at full width; under them one
// toolbar row: the page's display controls on the left, the chart's
// one-line key, "How to read this chart" (Methods' annotated diagram) and
// one "Download ▾" (CSV, PNG) on the right. On a phone page with an
// Options sheet (G3) the links go into the sheet (ChartActions.tsx), the
// key joins the column labels' row, and the subtitle leaves to the
// summary line what it already says.

import { Link, useRouter } from '@tanstack/react-router'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ProgressBar, useDelayedFlags } from '../components/Loading'
import { exportFilename, type ExportName } from '../export/filename'
import { downloadChartPng, keyFromFigure } from '../export/png'
import { NARROW_VIEWPORT, useMediaQuery } from '../useMediaQuery'
import { useChartActionsInSheet, type ChartActions } from './ChartActions'
import styles from './ChartFigure.module.css'

/** A subtitle starts with a capital, whatever clause leads it. */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export type CsvExport =
  { kind: 'server'; href: string } | { kind: 'client'; onDownload: () => void }

/** A CSV download started from code (the Options sheet's button): the
 * server's file through a throwaway link, or the client's own export. */
export function downloadCsv(csv: CsvExport): void {
  if (csv.kind === 'client') {
    csv.onDownload()
    return
  }
  const link = document.createElement('a')
  link.href = csv.href
  link.download = ''
  document.body.append(link)
  link.click()
  link.remove()
}

/** Where "How to read this chart" goes: Methods' annotated diagram. */
export const HOW_TO_READ = { to: '/methods', hash: 'how-to-read-the-charts' } as const

/** "How to read this chart": a router link inside the app, a plain one
 * where a chart renders without it (a test, a story). */
export function HowToRead() {
  const router = useRouter({ warn: false })
  if (!router) {
    return (
      <a className={styles.action} href={`${HOW_TO_READ.to}#${HOW_TO_READ.hash}`}>
        How to read this chart
      </a>
    )
  }
  return (
    <Link className={styles.action} to={HOW_TO_READ.to} hash={HOW_TO_READ.hash}>
      How to read this chart
    </Link>
  )
}

/** One "Download ▾" (F17): a disclosure whose panel holds the CSV and the
 * PNG. It closes on a choice, on Escape (focus back to the button) and on
 * a press outside it. */
function DownloadMenu({ csv, onPng }: { csv?: CsvExport; onPng: () => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement | null>(null)
  const button = useRef<HTMLButtonElement | null>(null)
  const panelId = useId()
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && root.current?.contains(event.target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])
  const close = () => setOpen(false)
  return (
    // The keydown is the menu's bubbling Escape-to-close.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      ref={root}
      className={styles.download}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          setOpen(false)
          button.current?.focus()
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className={styles.action}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
      >
        Download
        <span className={styles.chevron} aria-hidden="true">
          <svg viewBox="0 0 12 12" focusable="false">
            <path d="M2.25 4.5 6 8.25 9.75 4.5" />
          </svg>
        </span>
      </button>
      <div id={panelId} className={styles.menu} hidden={!open}>
        {csv &&
          (csv.kind === 'server' ? (
            <a
              className={styles.item}
              href={csv.href}
              download
              aria-label="Download CSV"
              onClick={close}
            >
              CSV <span className={styles.itemNote}>the numbers</span>
            </a>
          ) : (
            <button
              type="button"
              className={styles.item}
              aria-label="Download CSV"
              onClick={() => {
                close()
                csv.onDownload()
              }}
            >
              CSV <span className={styles.itemNote}>the numbers</span>
            </button>
          ))}
        <button
          type="button"
          className={styles.item}
          aria-label="Download PNG"
          onClick={() => {
            close()
            onPng()
          }}
        >
          PNG <span className={styles.itemNote}>the picture</span>
        </button>
      </div>
    </div>
  )
}

export function ChartFigure({
  title,
  subtitle,
  narrowSubtitle,
  ariaLabel,
  intro,
  legend,
  toolbar,
  afterToolbar,
  chartKey,
  hint,
  sortHead,
  csv,
  exportName,
  isRefreshing = false,
  wide = false,
  interactive = false,
  children,
}: {
  title: string
  subtitle?: string
  /** On a phone page with a summary line, the subtitle less what that
   * line already says (G3). */
  narrowSubtitle?: string
  /** What the chart shows and its extremes — the screen-reader summary. */
  ariaLabel: string
  /** Rendered between the header and the chart — the question wording
   * lives here (decision 3), outside the role="img" node so assistive
   * tech reads it. */
  intro?: ReactNode
  /** Rendered right under the chart: a key that reads the marks above it
   * (Compare two's shades), outside the role="img" node so assistive
   * tech reads it — never a note about the numbers (ADR-0024). */
  legend?: ReactNode
  /** The page's display controls, first in the header's toolbar. */
  toolbar?: ReactNode
  /** A control too long for the toolbar's row (US States' adjustment
   * switch and its reason): on its own line under it. */
  afterToolbar?: ReactNode
  /** The chart's one-line key in the header ("● mean ⟝⟞ 95% CI"). */
  chartKey?: ReactNode
  /** A line in the header about what is shown or how to work the chart
   * ("Showing the first four countries…") — the header's, never a line
   * under the chart (ADR-0024). */
  hint?: ReactNode
  /** The labels over the chart's columns, the value's a sort button
   * (SortHead) — right above the chart, outside its role="img" node. */
  sortHead?: ReactNode
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
  children: ReactNode
}) {
  const chartRef = useRef<HTMLDivElement | null>(null)
  const figureRef = useRef<HTMLElement | null>(null)
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
        { title, subtitle, key: keyFromFigure(figureRef.current) },
        exportFilename(exportName ?? { measure: title, view: 'Chart', waves: '' }, 'png'),
      )
      setPngFailed(!ok)
    } catch {
      setPngFailed(true)
    }
  }

  // Handed to the page's Options sheet, read when used (never stale).
  const actions = useRef<ChartActions>({ csv, png: () => void exportPng() })
  actions.current = { csv, png: () => void exportPng() }
  const narrow = useMediaQuery(NARROW_VIEWPORT)
  const inSheet = useChartActionsInSheet(actions) && narrow
  const shownSubtitle =
    narrow && inSheet && narrowSubtitle !== undefined ? narrowSubtitle : subtitle
  // On a phone the key reads with the column labels when there are some.
  const keyInHead = narrow && sortHead !== undefined && chartKey !== undefined
  const asideKey = keyInHead ? undefined : chartKey
  const hasAside = asideKey !== undefined || !inSheet

  return (
    <figure ref={figureRef} className={styles.figure} aria-busy={isRefreshing || undefined}>
      {showProgress && <ProgressBar className={styles.progress} />}
      <figcaption className={styles.caption}>
        <span className={styles.title}>{title}</span>
        {shownSubtitle && <span className={styles.subtitle}>{capitalize(shownSubtitle)}</span>}
      </figcaption>
      {/* One row under the title (G4): how it's drawn on the left; the
          key, then how to read it and the downloads, on the right. */}
      {(toolbar || hasAside) && (
        <div className={styles.toolbar} data-toolbar="">
          {toolbar && <div className={styles.tools}>{toolbar}</div>}
          {hasAside && (
            <div className={styles.aside}>
              {asideKey && <div className={styles.key}>{asideKey}</div>}
              {!inSheet && (
                <span className={styles.links}>
                  <HowToRead />
                  <span aria-hidden="true">·</span>
                  <DownloadMenu csv={csv} onPng={() => void exportPng()} />
                </span>
              )}
            </div>
          )}
        </div>
      )}
      {afterToolbar && <div className={styles.afterToolbar}>{afterToolbar}</div>}
      {hint && <p className={styles.hint}>{hint}</p>}
      {pngFailed && (
        <p role="status" className={styles.exportNote}>
          PNG export isn&rsquo;t available in this browser — the CSV has the same numbers.
        </p>
      )}
      {intro}
      {keyInHead ? (
        <div className={styles.heads}>
          {sortHead}
          <div className={styles.headKey}>{chartKey}</div>
        </div>
      ) : (
        sortHead
      )}
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
