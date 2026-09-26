// Choosing a measure is two steps, not one list of 161 (owner decision
// 1): a topic select (the catalog families, with a count on each), then
// a measure select holding only that topic's items — plus a search
// field ("Search all {n} measures") that matches name, display name and
// question wording and selects a measure directly, setting the topic to
// match. A topic with subtopics (the server's `subfamily`, ADR-0016) gets
// a third step between the two: a Subtopic select that defaults to the
// current measure's subtopic and narrows the Measure list to it. Picking
// a topic selects that topic's first listed measure — the page's own
// list, first subtopic first — so every view goes through its
// new-measure branch and the old measure's settings (answer level, an
// unsupported comparison, a stale notice) never linger (25 Sept). Native
// controls only; the search results are plain buttons.

import { useId, useMemo, useState } from 'react'
import type { VariableSummary } from '../../api/types'
import { subtopicsOf, topicFamily, topicsOf } from '../../topics'
import styles from './OutcomePicker.module.css'

export interface PickerLabels {
  topic: string
  subtopic: string
  measure: string
  search: string
}

export const PICKER_LABELS: PickerLabels = {
  topic: 'Topic',
  subtopic: 'Subtopic',
  measure: 'Measure',
  search: 'Or search',
}

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
  fields = 'all',
  pairs = false,
  labels = PICKER_LABELS,
}: {
  variables: VariableSummary[]
  /** The current outcome (may be unknown to the catalog). */
  value: string
  /** Topic mid-selection from the URL; absent = the outcome's family. */
  topic?: string
  /** A measure was picked — by the Measure select, the search, or a
   * topic change (which picks the topic's first measure); the topic is
   * inferred from it. */
  onSelect: (selection: { outcome: string }) => void
  /** The phone fold (§8) splits the picker: Measure stays above the
   * fold, Topic + search move into the disclosure. Each narrow instance
   * renders its own subset; the search's query state stays local. */
  fields?: 'all' | 'measure' | 'topic-and-search'
  /** On a phone, Topic and Measure side by side with the search under
   * them (the Correlates layout) rather than one field per row. */
  pairs?: boolean
  /** The fields' names, when a page holds two pickers (Compare two's
   * "Compare with" beside the Measure). */
  labels?: PickerLabels
}) {
  const [query, setQuery] = useState('')
  // A subtopic chosen mid-selection (no measure picked yet) — local, like
  // the search query, and keyed by its topic so a topic change drops it.
  const [picked, setPicked] = useState<{ topic: string; code: string } | null>(null)
  const topicId = useId()
  const subtopicId = useId()
  const measureId = useId()
  const searchId = useId()

  const topics = useMemo(() => topicsOf(variables), [variables])
  const current = variables.find((variable) => variable.name === value)
  const activeTopic = topic ?? (current ? topicFamily(current) : undefined)
  const active = topics.find((entry) => entry.family === activeTopic)
  const subtopics = useMemo(() => (active ? subtopicsOf(active.measures) : []), [active])
  const inTopic = current !== undefined && topicFamily(current) === activeTopic
  const activeSubtopic =
    subtopics.length === 0
      ? undefined
      : picked && picked.topic === activeTopic
        ? picked.code
        : inTopic
          ? (current.subfamily ?? '')
          : subtopics[0]?.code
  const measures =
    activeSubtopic === undefined
      ? (active?.measures ?? [])
      : (subtopics.find((entry) => entry.code === activeSubtopic)?.measures ?? [])
  const measureValue =
    inTopic && (activeSubtopic === undefined || (current.subfamily ?? '') === activeSubtopic)
      ? current.name
      : ''
  const servableCount = useMemo(
    () => variables.filter((variable) => variable.servable).length,
    [variables],
  )
  const matches = useMemo(() => searchMeasures(variables, query).slice(0, 8), [variables, query])

  const pick = (name: string) => {
    setQuery('')
    setPicked(null)
    onSelect({ outcome: name })
  }
  /** A topic change is a measure change: the topic's first listed
   * measure (its first subtopic's, where it has them). */
  const pickTopic = (family: string) => {
    const target = topics.find((entry) => entry.family === family)
    if (!target) return
    const groups = subtopicsOf(target.measures)
    const first = (groups[0]?.measures ?? target.measures)[0]
    if (first) pick(first.name)
  }

  return (
    <div className={styles.picker} data-pairs={pairs || undefined}>
      {fields !== 'measure' && (
        <div className={styles.field} data-field="topic">
          <label className={styles.label} htmlFor={topicId}>
            {labels.topic}
          </label>
          <select
            id={topicId}
            className={styles.select}
            value={active?.family ?? ''}
            onChange={(event) => pickTopic(event.target.value)}
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
      )}
      {fields !== 'topic-and-search' && subtopics.length > 0 && activeTopic !== undefined && (
        <div className={styles.field} data-field="subtopic">
          <label className={styles.label} htmlFor={subtopicId}>
            {labels.subtopic}
          </label>
          <select
            id={subtopicId}
            className={styles.select}
            value={activeSubtopic}
            onChange={(event) => setPicked({ topic: activeTopic, code: event.target.value })}
          >
            {subtopics.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.name} ({entry.measures.length})
              </option>
            ))}
          </select>
        </div>
      )}
      {fields !== 'topic-and-search' && (
        <div className={styles.field} data-field="measure">
          <label className={styles.label} htmlFor={measureId}>
            {labels.measure}
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
            {measures.map((option) => (
              <option key={option.name} value={option.name}>
                {option.display_name}
              </option>
            ))}
          </select>
        </div>
      )}
      {fields !== 'measure' && (
        <div className={styles.field} data-field="search">
          <label className={styles.label} htmlFor={searchId}>
            {labels.search}
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
              placeholder={`Search all ${servableCount} measures`}
            />
            {query.trim() && (
              <ul className={styles.results}>
                {matches.length === 0 && <li className={styles.noMatch}>No measure matches</li>}
                {matches.map((match) => (
                  <li key={match.name}>
                    <button
                      type="button"
                      className={styles.result}
                      onClick={() => pick(match.name)}
                    >
                      <span>{match.display_name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
