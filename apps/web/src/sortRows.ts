// One ordering, two consumers: the chart and the CSV both render
// rows in the order these functions produce (round-2 items 5 and 13), so
// they cannot drift. Every chart is ordered by value (owner, 22 Oct
// 2026; ADR-0029): highest first unless the URL's `dir` reverses it, a
// tie falling back to name order — a tie-break, never a choice.

import type { EstimateRow, Meta } from './api/types'
import { plotValue } from './charts/theme'
import { groupValueLabel } from './labels'

export type SortDir = 'asc' | 'desc'

/** The direction an order reads in when none is chosen: highest first. */
export const DEFAULT_DIR: SortDir = 'desc'

/** The two directions in words, highest first by default. */
export const VALUE_ORDER: readonly { value: SortDir; label: string }[] = [
  { value: 'desc', label: 'Highest first' },
  { value: 'asc', label: 'Lowest first' },
]

/** The other direction: what a second click on a value label asks for. */
export function reversed(dir: SortDir): SortDir {
  return dir === 'desc' ? 'asc' : 'desc'
}

/** Atlas rows by value (nulls last, whatever the direction), ties in
 * name order. */
export function sortAtlasRows(rows: EstimateRow[], meta: Meta, dir: SortDir): EstimateRow[] {
  const label = (row: EstimateRow) =>
    groupValueLabel('country_code', row.group['country_code'] ?? null, meta)
  const sign = dir === 'desc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const va = plotValue(a)
    const vb = plotValue(b)
    if (va === null && vb === null) return label(a).localeCompare(label(b))
    if (va === null) return 1
    if (vb === null) return -1
    return sign * (vb - va) || label(a).localeCompare(label(b))
  })
}

/** Breakdown rows: countries in the panel order (value or gap under
 * the chosen direction), levels in the served display order within each
 * country — exactly the order the small-multiples panels draw. */
export function sortBreakdownRows(
  rows: EstimateRow[],
  meta: Meta,
  facetOrderOf: (rows: EstimateRow[]) => string[],
  levelLabelOf: (row: EstimateRow) => string,
  levelDomain: string[],
): EstimateRow[] {
  const facets = facetOrderOf(rows)
  const facetIndex = new Map(facets.map((name, index) => [name, index]))
  const levelIndex = new Map(levelDomain.map((name, index) => [name, index]))
  const label = (row: EstimateRow) =>
    groupValueLabel('country_code', row.group['country_code'] ?? null, meta)
  return [...rows].sort((a, b) => {
    const fa = facetIndex.get(label(a)) ?? facets.length
    const fb = facetIndex.get(label(b)) ?? facets.length
    if (fa !== fb) return fa - fb
    const la = levelIndex.get(levelLabelOf(a)) ?? levelDomain.length
    const lb = levelIndex.get(levelLabelOf(b)) ?? levelDomain.length
    return la - lb
  })
}
