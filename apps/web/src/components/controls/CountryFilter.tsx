// Country selection: a button under a "Countries" label like the other
// controls' — it reads its state, "All countries ▾" or "3 countries ▾"
// (F20) — opening a panel that starts with an "All countries" choice,
// then "Choose countries" with a tick per country, so "all" is never
// shown as nothing ticked. An empty selection means all countries. The
// trigger keeps a minimum width, so a selection change never moves it
// (25 Sept fix); the panel closes on Escape (focus back to the trigger)
// and on a click outside it (focus left alone), and anchors to the
// trigger's right edge when a left-anchored panel would overflow the page
// column.

import { useEffect, useId, useRef, useState } from 'react'
import type { Country } from '../../api/types'
import styles from './CountryFilter.module.css'

export function CountryFilter({
  countries,
  selected,
  onChange,
}: {
  countries: Country[]
  selected: readonly number[]
  onChange: (codes: number[]) => void
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

  // Close on an outside pointerdown, leaving focus wherever it was.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const host = details.current
      if (!host?.open) return
      if (event.target instanceof Node && host.contains(event.target)) return
      host.open = false
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  const onToggle = () => {
    const host = details.current
    const box = panel.current
    if (!host?.open || !box) return
    setChoosing(selected.length > 0)
    const column = host.closest('main')?.getBoundingClientRect().right ?? window.innerWidth
    setAnchorRight(host.getBoundingClientRect().left + box.offsetWidth > column + 1)
  }

  const all = selected.length === 0 || selected.length === countries.length
  return (
    <div className={styles.field}>
      <span className={styles.label} aria-hidden="true">
        Countries
      </span>
      {/* The keydown is a bubbling Escape-to-close for the disclosure
          (focus returns to the trigger) — not a fake interactive element,
          which is what the a11y rule guards against. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <details
        ref={details}
        className={styles.details}
        onToggle={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && details.current?.open) {
            details.current.open = false
            summary.current?.focus()
          }
        }}
      >
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
