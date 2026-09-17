// Country selection: native disclosure + checkboxes. Empty = all 23.
// Escape closes the panel and returns focus to the trigger (F9); the
// reset control reads as the button it is.

import { useRef } from 'react'
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
        Countries{selected.length ? ` (${selected.length} selected)` : ' (all)'}
      </summary>
      <div className={styles.panel}>
        <button
          type="button"
          className={styles.clear}
          onClick={() => onChange([])}
          disabled={selected.length === 0}
        >
          Reset — show all {countries.length}
        </button>
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
