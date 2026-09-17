// Country selection: native disclosure + checkboxes. An empty selection
// means all countries; the trigger reports the state ("All 23
// countries" / "3 countries"). Select all and Clear are explicit
// controls (round-2 items 2/10); the panel closes on Escape (focus back
// to the trigger) and on a click outside it (focus left alone).

import { useEffect, useRef } from 'react'
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

  const label =
    selected.length === 0 || selected.length === countries.length
      ? `All ${countries.length} countries`
      : `${selected.length} ${selected.length === 1 ? 'country' : 'countries'}`

  return (
    // The keydown is a bubbling Escape-to-close for the disclosure
    // (focus returns to the trigger) — not a fake interactive element,
    // which is what the a11y rule guards against.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <details
      ref={details}
      className={styles.details}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && details.current?.open) {
          details.current.open = false
          summary.current?.focus()
        }
      }}
    >
      <summary ref={summary} className={styles.summary}>
        {label}
      </summary>
      <div className={styles.panel}>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.clear}
            onClick={() => onChange(countries.map((country) => country.code).sort((a, b) => a - b))}
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
  )
}
