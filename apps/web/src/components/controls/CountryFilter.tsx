// Country selection: native disclosure + checkboxes under a "Countries"
// label like the other controls'. An empty selection means all
// countries; the trigger reports the state in a few words ("All 23" /
// "3 selected"), with "Countries" kept in its accessible name, at a
// fixed minimum width so a selection change never moves it (25 Sept
// fix). Select all and Clear are explicit controls (round-2 items
// 2/10); the panel closes on Escape (focus back to the trigger) and on a
// click outside it (focus left alone), and anchors to the trigger's
// right edge when a left-anchored panel would overflow the page column.

import { useEffect, useRef, useState } from 'react'
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
  // Anchor the panel to the trigger's right edge when, opened at the
  // right of the controls row, a left-anchored one would stick out past
  // the page column — decided on each open.
  const [anchorRight, setAnchorRight] = useState(false)
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
    const column = host.closest('main')?.getBoundingClientRect().right ?? window.innerWidth
    setAnchorRight(host.getBoundingClientRect().left + box.offsetWidth > column + 1)
  }

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
        </summary>
        <div ref={panel} className={styles.panel} data-anchor={anchorRight ? 'right' : undefined}>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.clear}
              onClick={() =>
                onChange(countries.map((country) => country.code).sort((a, b) => a - b))
              }
              disabled={selected.length === countries.length}
            >
              Select all
            </button>
            <button
              type="button"
              className={styles.clear}
              onClick={() => onChange([])}
              disabled={selected.length === 0}
            >
              Clear
            </button>
          </div>
          <ul className={styles.list}>
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
        </div>
      </details>
    </div>
  )
}

/** The trigger's state in a few words — "All 23", "3 selected" — under
 * the visible "Countries" label. */
export function countryTriggerText(chosen: number, total: number): string {
  return chosen === 0 || chosen === total ? `All ${total}` : `${chosen} selected`
}
