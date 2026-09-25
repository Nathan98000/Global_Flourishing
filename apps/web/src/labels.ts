// Group-key display: every code→label lookup goes through meta
// (countries, breakdown_labels) — the front end owns no copy of any
// label map (exit criterion 6).

import type { EstimateRow, Meta, VariableDetail, VariableSummary } from './api/types'

/** The subtitle that names the scale once (decision 2, revised in
 * ADR-0016): "Average score, 0–10 (0 = Not true of you at all, 10 =
 * Completely true of you)" — the endpoints in the item's own value
 * labels (lowest and highest valid code, exactly as the server gives
 * them; blank middle labels are never listed), never "higher is
 * better". A derived score (the index, its domains, the PHQ-2/GAD-2
 * scores) shows just the range. The callers append the wave clause
 * last (§7); the axis then carries only its ticks. */
export function scaleSubtitle(
  variable: Pick<VariableSummary, 'min' | 'max' | 'is_derived'>,
  stat: string,
  detail?: VariableDetail,
): string {
  const lead = stat === 'quantile' ? 'Median score' : 'Average score'
  const range =
    variable.min !== null && variable.max !== null ? `, ${variable.min}–${variable.max}` : ''
  return `${lead}${range}${variable.is_derived ? '' : endpointsClause(detail)}`
}

/** " (0 = Not true of you at all, 10 = Completely true of you)" from an
 * item's value labels — lowest and highest valid code — or '' when
 * either end is unlabelled. */
export function endpointsClause(detail: VariableDetail | undefined): string {
  const levels = outcomeLevels(detail)
  const low = levels[0]
  const high = levels[levels.length - 1]
  if (!low || !high || low === high) return ''
  if (!low.label.trim() || !high.label.trim()) return ''
  return ` (${low.value} = ${low.label}, ${high.value} = ${high.label})`
}

/** The states a server state code stands for: itself, or a pooled
 * group's members (from meta; the code's own underscores otherwise). */
export function stateMembersOf(code: string, meta: Pick<Meta, 'state_labels'>): string[] {
  return meta.state_labels?.[code]?.members ?? code.split('_').filter(Boolean)
}

export function columnLabel(column: string, meta: Meta): string {
  if (column === 'country_code') return 'Country'
  // A synthesized group column (Compare, What Matters): one measure per row.
  if (column === 'outcome') return 'Measure'
  // The US States view groups by the release's state codes.
  if (column === 'state') return 'State'
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
  // US state codes (and the pooled groups) are named by the server.
  if (column === 'state') {
    const state = meta.state_labels?.[String(value)]
    if (state) return state.name
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
export function highestLevel(rows: readonly EstimateRow[]): number | undefined {
  let highest: number | undefined
  for (const row of rows) {
    if (row.level !== null && row.level !== undefined) {
      if (highest === undefined || row.level > highest) highest = row.level
    }
  }
  return highest
}

/** The answer level a categorical outcome shows until the URL names one
 * — Atlas's rule, shared by every view that shows one level: the first
 * labelled answer; for a proportion with no labelled levels (derived
 * binaries: phq2_positive's {0, 1}), the highest level present. */
export function defaultLevel(
  detail: VariableDetail | undefined,
  rows: readonly EstimateRow[] = [],
): number | undefined {
  return outcomeLevels(detail)[0]?.value ?? highestLevel(rows)
}

/** Level display order for a breakdown column, from meta's labels — or,
 * for a survey-variable split, from that variable's own value labels. */
export function levelDomain(
  column: string,
  meta: {
    breakdown_labels: Record<string, { levels: { value: number | string; label: string }[] }>
  },
  detail?: VariableDetail,
): string[] {
  const labels = meta.breakdown_labels[column]
  if (labels) return labels.levels.map((level) => level.label)
  if (detail) return outcomeLevels(detail).map((level) => level.label)
  return []
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
