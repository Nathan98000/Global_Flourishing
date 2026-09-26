// One search field that adds a question (Compare several's "Add a
// question"): the page search's own matcher over name, display name and
// question wording, its results as plain buttons; Enter takes the first,
// Escape clears. At the table's limit the field is disabled and says so.

import { useId, useMemo, useState } from 'react'
import type { VariableSummary } from '../../api/types'
import { searchMeasures } from './OutcomePicker'
import styles from './OutcomePicker.module.css'

export function QuestionSearch({
  label,
  candidates,
  onAdd,
  full,
}: {
  label: string
  /** What may be added (never what is already there). */
  candidates: VariableSummary[]
  onAdd: (name: string) => void
  /** The limit's words when no more may be added; absent = open. */
  full?: string
}) {
  const [query, setQuery] = useState('')
  const id = useId()
  const matches = useMemo(() => searchMeasures(candidates, query).slice(0, 8), [candidates, query])
  const add = (name: string) => {
    setQuery('')
    onAdd(name)
  }
  return (
    <div className={styles.field} data-field="search">
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div className={styles.searchWrap}>
        <input
          id={id}
          className={styles.search}
          type="search"
          value={full ? '' : query}
          disabled={full !== undefined}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && matches[0]) {
              event.preventDefault()
              add(matches[0].name)
            }
            if (event.key === 'Escape') setQuery('')
          }}
          placeholder={full ?? `Search ${candidates.length} questions`}
        />
        {!full && query.trim() && (
          <ul className={styles.results}>
            {matches.length === 0 && <li className={styles.noMatch}>No question matches</li>}
            {matches.map((match) => (
              <li key={match.name}>
                <button type="button" className={styles.result} onClick={() => add(match.name)}>
                  <span>{match.display_name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
