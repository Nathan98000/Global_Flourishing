// Group-key display: every code→label lookup goes through meta
// (countries, breakdown_labels) — the front end owns no copy of any
// label map (exit criterion 6).

import type { EstimateRow, Meta } from './api/types'

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
