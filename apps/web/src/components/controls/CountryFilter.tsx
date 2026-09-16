// Country selection: native disclosure + checkboxes. Empty = all 23.

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
  const set = new Set(selected)
  const toggle = (code: number) => {
    const next = new Set(set)
    if (next.has(code)) next.delete(code)
    else next.add(code)
    onChange([...next].sort((a, b) => a - b))
  }
  return (
    <details className={styles.details}>
      <summary className={styles.summary}>
        Countries{selected.length ? ` (${selected.length} selected)` : ' (all)'}
      </summary>
      <div className={styles.panel}>
        <button
          type="button"
          className={styles.clear}
          onClick={() => onChange([])}
          disabled={selected.length === 0}
        >
          Show all
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
