// Country selection: a button under a "Countries" label like the other
// controls' — it reads its state, "All countries ▾" or "3 countries ▾"
// (F20) — opening a panel that starts with an "All countries" choice,
// then "Choose countries" with a tick per country, so "all" is never
// shown as nothing ticked. An empty selection means all countries. The
// trigger keeps a minimum width, so a selection change never moves it
// (25 Sept fix); the panel closes on Escape from anywhere (focus back to
// the trigger), when focus leaves it and on a click outside it
// (usePopupDismiss, H12), and anchors to the
// trigger's right edge when a left-anchored panel would overflow the page
// column. In the phone's options sheet (`variant="panel"`) the same
// choices sit in the sheet itself, under the label, with no popover.

import { useCallback, useId, useRef, useState } from 'react'
import type { Country } from '../../api/types'
import styles from './CountryFilter.module.css'
import { usePopupDismiss } from './usePopupDismiss'

export function CountryFilter({
  countries,
  selected,
  onChange,
  variant = 'popover',
}: {
  countries: Country[]
  selected: readonly number[]
  onChange: (codes: number[]) => void
  /** `panel`: the choices in place, under the label (the phone's sheet). */
  variant?: 'popover' | 'panel'
}) {
  const details = useRef<HTMLDetailsElement | null>(null)
  const summary = useRef<HTMLElement | null>(null)
  const panel = useRef<HTMLDivElement | null>(null)
  const name = useId()
  // Anchor the panel to the trigger's right edge when, opened at the
  // right of the controls row, a left-anchored one would stick out past
  // the page column — decided on each open.
  const [anchorRight, setAnchorRight] = useState(false)
  // "Choose countries" chosen with none ticked yet: the list shows while
  // the chart still shows every country.
  const [choosing, setChoosing] = useState(selected.length > 0)
  const set = new Set(selected)
  const toggle = (code: number) => {
    const next = new Set(set)
    if (next.has(code)) next.delete(code)
    else next.add(code)
    onChange([...next].sort((a, b) => a - b))
  }

  const [open, setOpen] = useState(false)
  const close = useCallback(() => {
    if (details.current) details.current.open = false
  }, [])
  usePopupDismiss(open, details, summary, close)

  const onToggle = () => {
    const host = details.current
    const box = panel.current
    setOpen(host?.open ?? false)
    if (!host?.open || !box) return
    setChoosing(selected.length > 0)
    const column = host.closest('main')?.getBoundingClientRect().right ?? window.innerWidth
    setAnchorRight(host.getBoundingClientRect().left + box.offsetWidth > column + 1)
  }

  const all = selected.length === 0 || selected.length === countries.length
  const choices = (
    <>
      <fieldset className={styles.mode}>
        <legend className="visually-hidden">Countries</legend>
        <label className={styles.option}>
          <input
            type="radio"
            name={name}
            checked={all && !choosing}
            onChange={() => {
              setChoosing(false)
              onChange([])
            }}
          />{' '}
          All countries
        </label>
        <label className={styles.option}>
          <input
            type="radio"
            name={name}
            checked={!all || choosing}
            onChange={() => setChoosing(true)}
          />{' '}
          Choose countries
        </label>
      </fieldset>
      {(choosing || !all) && (
        <ul className={styles.list} aria-label="Choose countries">
          {[...countries]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((country) => (
              <li key={country.code}>
                <label className={styles.option}>
                  <input
                    type="checkbox"
                    checked={set.has(country.code)}
                    onChange={() => toggle(country.code)}
                  />{' '}
                  {country.name}
                </label>
              </li>
            ))}
        </ul>
      )}
    </>
  )
  if (variant === 'panel') {
    return (
      <div className={styles.field} data-variant="panel">
        <span className={styles.label} aria-hidden="true">
          Countries
        </span>
        {choices}
      </div>
    )
  }
  return (
    <div className={styles.field}>
      <span className={styles.label} aria-hidden="true">
        Countries
      </span>
      <details ref={details} className={styles.details} onToggle={onToggle}>
        <summary ref={summary} className={styles.summary}>
          <span className="visually-hidden">Countries: </span>
          <span>{countryTriggerText(selected.length, countries.length)}</span>
          <span className={styles.chevron} aria-hidden="true">
            <svg viewBox="0 0 12 12" focusable="false">
              <path d="M2.25 4.5 6 8.25 9.75 4.5" />
            </svg>
          </span>
        </summary>
        <div ref={panel} className={styles.panel} data-anchor={anchorRight ? 'right' : undefined}>
          {choices}
        </div>
      </details>
    </div>
  )
}

/** The trigger's state in a few words — "All countries", "3 countries",
 * "1 country" — under the visible "Countries" label. */
export function countryTriggerText(chosen: number, total: number): string {
  if (chosen === 0 || chosen === total) return 'All countries'
  return `${chosen} ${chosen === 1 ? 'country' : 'countries'}`
}
