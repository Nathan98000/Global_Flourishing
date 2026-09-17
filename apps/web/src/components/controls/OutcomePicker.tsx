// Choosing a measure is two steps, not one list of 161 (owner decision
// 1): a topic select (the catalog families, with a count on each), then
// a measure select holding only that topic's items — plus a search
// field ("or search all …") that matches name, display name and
// question wording and selects a measure directly, setting the topic to
// match. Native controls only; the search results are plain buttons.

import { useId, useMemo, useState } from 'react'
import type { VariableSummary } from '../../api/types'
import { topicsOf } from '../../topics'
import styles from './OutcomePicker.module.css'

export function searchMeasures(variables: VariableSummary[], query: string): VariableSummary[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  return variables.filter(
    (variable) =>
      variable.servable &&
      (variable.name.toLowerCase().includes(needle) ||
        variable.display_name.toLowerCase().includes(needle) ||
        (variable.label ?? '').toLowerCase().includes(needle) ||
        (variable.wording ?? '').toLowerCase().includes(needle)),
  )
}

export function OutcomePicker({
  variables,
  value,
  topic,
  onSelect,
}: {
  variables: VariableSummary[]
  /** The current outcome (may be unknown to the catalog). */
  value: string
  /** Topic mid-selection from the URL; absent = the outcome's family. */
  topic?: string
  /** A measure was picked (topic is then inferred), or only a topic. */
  onSelect: (selection: { outcome?: string; topic?: string }) => void
}) {
  const [query, setQuery] = useState('')
  const topicId = useId()
  const measureId = useId()
  const searchId = useId()

  const topics = useMemo(() => topicsOf(variables), [variables])
  const current = variables.find((variable) => variable.name === value)
  const activeTopic = topic ?? current?.family
  const active = topics.find((entry) => entry.family === activeTopic)
  const measureValue = current && current.family === activeTopic ? current.name : ''
  const servableCount = useMemo(
    () => variables.filter((variable) => variable.servable).length,
    [variables],
  )
  const matches = useMemo(() => searchMeasures(variables, query).slice(0, 8), [variables, query])

  const pick = (name: string) => {
    setQuery('')
    onSelect({ outcome: name })
  }

  return (
    <div className={styles.picker}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={topicId}>
          Topic
        </label>
        <select
          id={topicId}
          className={styles.select}
          value={active?.family ?? ''}
          onChange={(event) => onSelect({ topic: event.target.value })}
        >
          {!active && (
            <option value="" disabled>
              Choose a topic…
            </option>
          )}
          {topics.map((entry) => (
            <option key={entry.family} value={entry.family}>
              {entry.name} ({entry.measures.length})
            </option>
          ))}
        </select>
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={measureId}>
          Measure
        </label>
        <select
          id={measureId}
          className={styles.select}
          value={measureValue}
          onChange={(event) => {
            if (event.target.value) pick(event.target.value)
          }}
        >
          {!measureValue && (
            <option value="" disabled>
              Choose a measure…
            </option>
          )}
          {(active?.measures ?? []).map((option) => (
            <option key={option.name} value={option.name}>
              {option.display_name}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={searchId}>
          or search all {servableCount}
        </label>
        <div className={styles.searchWrap}>
          <input
            id={searchId}
            className={styles.search}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && matches[0]) {
                event.preventDefault()
                pick(matches[0].name)
              }
              if (event.key === 'Escape') setQuery('')
            }}
            placeholder="loneliness, prayer, exercise…"
          />
          {query.trim() && (
            <ul className={styles.results}>
              {matches.length === 0 && <li className={styles.noMatch}>No measure matches</li>}
              {matches.map((match) => (
                <li key={match.name}>
                  <button type="button" className={styles.result} onClick={() => pick(match.name)}>
                    <span>{match.display_name}</span>
                    <span className={styles.code}>{match.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
