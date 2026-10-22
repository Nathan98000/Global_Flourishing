// The phone's chart options (ADR-0029): under 40rem the question bar
// keeps only the question and the year, and one line says how the chart
// is drawn — "Mean · all countries · highest first" — with an Options
// button. Options opens a bottom sheet holding what the chart's toolbar
// holds on a wider screen (Show, Countries, the page's own controls).
// The sheet is a modal dialog: focus moves into it, Tab stays inside,
// Escape and "Done" close it, and focus returns to Options.

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import styles from './OptionsSheet.module.css'

export function OptionsSheet({
  summary,
  title = 'Chart options',
  children,
}: {
  /** The chart's state in the controls' words. */
  summary: string
  title?: string
  /** The controls, in their full-width phone layout. */
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement | null>(null)
  const sheet = useRef<HTMLDivElement | null>(null)
  const titleId = useId()
  const sheetId = useId()

  const close = () => {
    setOpen(false)
    button.current?.focus()
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
            </div>
          </div>
        </div>
      )}
    </>
  )
}
