// Outcome selection: a quick filter narrowing a grouped native select
// (derived scores first, then families). Native controls only — fully
// keyboard and screen-reader capable without a combobox re-implementation.

import { useId, useMemo, useState } from 'react'
import type { VariableSummary } from '../../api/types'
import styles from './OutcomePicker.module.css'

export function groupVariables(
  variables: VariableSummary[],
  filter: string,
): { family: string; options: VariableSummary[] }[] {
  const needle = filter.trim().toLowerCase()
  const matches = variables.filter(
    (variable) =>
      variable.servable &&
      (!needle ||
        variable.name.toLowerCase().includes(needle) ||
        variable.display_name.toLowerCase().includes(needle) ||
        (variable.label ?? '').toLowerCase().includes(needle)),
  )
  const families = new Map<string, VariableSummary[]>()
  for (const variable of matches) {
    const bucket = families.get(variable.family) ?? []
    bucket.push(variable)
    families.set(variable.family, bucket)
  }
  const names = [...families.keys()].sort((a, b) =>
    a === 'derived' ? -1 : b === 'derived' ? 1 : a.localeCompare(b),
  )
  return names.map((family) => ({ family, options: families.get(family) ?? [] }))
}

export function OutcomePicker({
  variables,
  value,
  onChange,
}: {
  variables: VariableSummary[]
  value: string
  onChange: (outcome: string) => void
}) {
  const [filter, setFilter] = useState('')
  const filterId = useId()
  const selectId = useId()
  const groups = useMemo(() => groupVariables(variables, filter), [variables, filter])
  const visible = groups.some((group) => group.options.some((option) => option.name === value))
  return (
    <div className={styles.picker}>
      <label className={styles.label} htmlFor={filterId}>
        Filter outcomes
      </label>
      <input
        id={filterId}
        className={styles.filter}
        type="search"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="happiness, PHQ, meaning…"
      />
      <label className={styles.label} htmlFor={selectId}>
        Outcome
      </label>
      <select
        id={selectId}
        className={styles.select}
        value={visible ? value : ''}
        onChange={(event) => {
          if (event.target.value) onChange(event.target.value)
        }}
      >
        {!visible && (
          <option value="" disabled>
            {groups.length ? 'Pick a match…' : 'No outcomes match the filter'}
          </option>
        )}
        {groups.map((group) => (
          <optgroup
            key={group.family}
            label={group.family === 'derived' ? 'derived scores' : group.family}
          >
            {group.options.map((option) => (
              <option key={option.name} value={option.name}>
                {option.display_name} ({option.name})
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  )
}
