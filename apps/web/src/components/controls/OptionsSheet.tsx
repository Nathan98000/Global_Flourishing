// The phone's chart options (ADR-0029): under 40rem the question bar
// keeps only the question and the year, and one line says how the chart
// is drawn — "Mean · all countries · highest first" — with an Options
// button. Options opens a bottom sheet holding what the chart's toolbar
// holds on a wider screen (Show, Countries, the page's own controls).
// The sheet is a modal dialog: focus moves into it, Tab stays inside,
// Escape and "Done" close it, and focus returns to Options. At its foot
// sit the page's chart's "How to read this chart" and its downloads,
// which leave the chart's header on a phone (G3, ChartActions.tsx).

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useSheetChartActions } from '../../charts/ChartActions'
import { HowToRead, downloadCsv } from '../../charts/ChartFigure'
import styles from './OptionsSheet.module.css'

export function OptionsSheet({
  summary,
  title = 'Chart options',
  onClosed,
  children,
}: {
  /** The chart's state in the controls' words. */
  summary: string
  title?: string
  /** Once the sheet has closed and focus is back on Options (US States'
   * Find a state scrolls to its state then — H4). */
  onClosed?: () => void
  /** The controls, in their full-width phone layout. */
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement | null>(null)
  const sheet = useRef<HTMLDivElement | null>(null)
  const titleId = useId()
  const sheetId = useId()
  const chartActions = useSheetChartActions()

  // Focus goes back to Options without scrolling to it: a page that
  // moved while the sheet was open (Find a state) stays where it went.
  const close = () => {
    setOpen(false)
    button.current?.focus({ preventScroll: true })
    onClosed?.()
  }

  // Open: focus moves to the sheet's first control.
  useEffect(() => {
    if (!open) return
    const first = sheet.current?.querySelector<HTMLElement>(
      '[data-sheet-body] input:not([disabled]), [data-sheet-body] select, [data-sheet-body] button, [data-sheet-body] summary',
    )
    ;(first ?? sheet.current?.querySelector<HTMLElement>('button'))?.focus()
  }, [open])

  // Escape closes; Tab stays inside (it is a modal choice).
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    if (event.key !== 'Tab' || !sheet.current) return
    const stops = [
      ...sheet.current.querySelectorAll<HTMLElement>(
        'input:not([disabled]), select, button:not([disabled]), summary, a[href]',
      ),
    ].filter((element) => element.offsetParent !== null || element === document.activeElement)
    const first = stops[0]
    const last = stops[stops.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  return (
    <>
      <p className={styles.summaryLine}>
        <span>{summary}</span>
        <button
          ref={button}
          type="button"
          className={styles.options}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? sheetId : undefined}
          onClick={() => setOpen(true)}
        >
          Options
        </button>
      </p>
      {open && (
        // A press on the backdrop (not the sheet) closes it.
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
        <div
          className={styles.backdrop}
          onClick={(event) => {
            if (event.target === event.currentTarget) close()
          }}
        >
          {/* The keydown is the dialog's own Escape and Tab handling. */}
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
          <div
            ref={sheet}
            id={sheetId}
            className={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onKeyDown={onKeyDown}
          >
            <div className={styles.grab} aria-hidden="true" />
            <div className={styles.head}>
              <h3 id={titleId} className={styles.title}>
                {title}
              </h3>
              <button type="button" className={styles.done} onClick={close}>
                Done
              </button>
            </div>
            <div className={styles.body} data-sheet-body="">
              {children}
              {chartActions && (
                <div className={styles.chartActions}>
                  <HowToRead />
                  <span className={styles.downloads}>
                    Download
                    {chartActions.current.csv && (
                      <button
                        type="button"
                        className={styles.link}
                        aria-label="Download CSV"
                        onClick={() => {
                          const csv = chartActions.current.csv
                          if (csv) downloadCsv(csv)
                        }}
                      >
                        CSV
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles.link}
                      aria-label="Download PNG"
                      onClick={() => chartActions.current.png()}
                    >
                      PNG
                    </button>
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
