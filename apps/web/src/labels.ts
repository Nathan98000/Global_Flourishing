// Group-key display: every code→label lookup goes through meta
// (countries, breakdown_labels) — the front end owns no copy of any
// label map (exit criterion 6).

import type { EstimateRow, Meta, VariableDetail, VariableSummary } from './api/types'

/** The server's direction enum in plain words (F6: no `direction: none`
 * on a public surface). */
export function directionPhrase(direction: string): string {
  if (direction === 'higher_better') return 'higher is better'
  if (direction === 'lower_better') return 'lower is better'
  return 'no better-or-worse direction'
}

/** The subtitle that names the scale and direction once (decision 2):
 * "Average score on a 0–10 scale · higher is better". The axis then
 * carries only its ticks. Everything comes from the variable's own
 * facts; nothing here re-derives a label. */
export function scaleSubtitle(
  variable: Pick<VariableSummary, 'min' | 'max' | 'direction'>,
  stat: string,
  oriented = false,
): string {
  const lead = stat === 'quantile' ? 'Median score' : 'Average score'
  const range =
    variable.min !== null && variable.max !== null
      ? ` on a ${variable.min}–${variable.max} scale`
      : ''
  const direction =
    variable.direction === 'lower_better' && oriented
      ? 'reversed so higher is better'
      : variable.direction === 'none'
        ? ''
        : directionPhrase(variable.direction)
  return `${lead}${range}${direction ? ` · ${direction}` : ''}`
}

export function columnLabel(column: string, meta: Meta): string {
  if (column === 'country_code') return 'Country'
  const labels = meta.breakdown_labels[column]
  if (labels) return labels.display_name
  return column
}

export function groupValueLabel(
  column: string,
  value: string | number | boolean | null | undefined,
  meta: Meta,
  fallback?: (column: string, value: string | number) => string | undefined,
): string {
  if (value === null || value === undefined) return '—'
  if (column === 'country_code') {
    const country = meta.countries.find((entry) => entry.code === value)
    if (country) return country.name
  }
  const labels = meta.breakdown_labels[column]
  if (labels) {
    const level = labels.levels.find((entry) => entry.value === value)
    if (level) return level.label
  }
  if (typeof value !== 'boolean') {
    const custom = fallback?.(column, value)
    if (custom !== undefined) return custom
  }
  return String(value)
}

export function rowGroupLabels(row: EstimateRow, by: readonly string[], meta: Meta): string[] {
  return by.map((column) => groupValueLabel(column, row.group[column] ?? null, meta))
}

/** For proportion responses with no labelled levels (derived binaries:
 * phq2_positive's {0, 1}), show the highest level — the "positive" share
 * the score's own display name describes. */
export function highestLevel(rows: EstimateRow[]): number | undefined {
  let highest: number | undefined
  for (const row of rows) {
    if (row.level !== null && row.level !== undefined) {
      if (highest === undefined || row.level > highest) highest = row.level
    }
  }
  return highest
}

/** Answer levels a categorical outcome can be ranked/mapped/split by —
 * from its own value labels (server truth), nonresponse codes excluded. */
export function outcomeLevels(
  detail: VariableDetail | undefined,
): { value: number; label: string }[] {
  if (!detail) return []
  const seen = new Map<number, string>()
  for (const label of detail.value_labels) {
    if (!label.is_nonresponse && !seen.has(label.code)) seen.set(label.code, label.label)
  }
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([value, label]) => ({ value, label }))
}
