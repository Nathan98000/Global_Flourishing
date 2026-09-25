// The Change view's row bookkeeping, kept out of the component so fast
// refresh stays clean: one ordering for the chart and the data table
// (sortRows.ts), the signed buckets the change histogram bins into, and
// the signed tick labels.

import type { ChangeLeg } from '../api/change'
import type { EstimateRow, Meta, VariableSummary } from '../api/types'
import { groupValueLabel } from '../labels'
import { sortAtlasRows } from '../sortRows'
import type { ChangeSearch } from '../state/search'

/** The countries shown, in the sort order the chart and table share. A
 * three-point response orders countries by its 2023 → 2024 leg and keeps
 * the legs together within each country. */
export function orderChangeRows(
  rows: EstimateRow[],
  meta: Meta,
  sort: ChangeSearch['sort'],
  dir: 'asc' | 'desc',
  countries: readonly number[],
  legs: readonly ChangeLeg[] | undefined,
): { rows: EstimateRow[]; countryDomain: string[] } {
  const selected = countries.length
    ? rows.filter((row) => countries.includes(Number(row.group['country_code'])))
    : rows
  const anchorLeg = legs?.includes('y1_y2') ? 'y1_y2' : legs?.[0]
  const base = anchorLeg ? selected.filter((row) => row.leg === anchorLeg) : selected
  const ordered = sortAtlasRows(base, meta, sort === 'change' ? 'estimate' : 'name', dir)
  const label = (row: EstimateRow) =>
    groupValueLabel('country_code', row.group['country_code'] ?? null, meta)
  const countryDomain = ordered.map(label)
  if (!legs) return { rows: ordered, countryDomain }
  const countryIndex = new Map(countryDomain.map((name, index) => [name, index]))
  const legIndex = new Map(legs.map((leg, index) => [leg, index]))
  const withLegs = [...selected].sort(
    (a, b) =>
      (countryIndex.get(label(a)) ?? countryDomain.length) -
        (countryIndex.get(label(b)) ?? countryDomain.length) ||
      (legIndex.get(a.leg as ChangeLeg) ?? legs.length) -
        (legIndex.get(b.leg as ChangeLeg) ?? legs.length),
  )
  return { rows: withLegs, countryDomain }
}

/** The signed change buckets the histogram bins into: −span … +span. */
export function changeLevels(variable: { min: number | null; max: number | null }): number[] {
  if (variable.min === null || variable.max === null) return []
  const span = variable.max - variable.min
  return Array.from({ length: 2 * span + 1 }, (_, index) => index - span)
}

export const signedLevel = (level: number): string =>
  level > 0 ? `+${level}` : level < 0 ? `−${Math.abs(level)}` : String(level)

/** For a categorical item's share change: whether a rise in the share
 * answering `level` is better (true), worse (false) or neither
 * (undefined). Levels are raw codes — shares are never re-coded
 * (ADR-0015) — so the answer comes from the server's direction and the
 * item's coded ends: the level is the better end when it is the min of
 * a lower_better item or the max of a higher_better one, the worse end
 * when it is the opposite; middle levels and undirected items say
 * nothing. */
export function shareRiseIsBetter(
  variable: Pick<VariableSummary, 'direction' | 'min' | 'max'>,
  level: number | undefined,
): boolean | undefined {
  if (level === undefined || variable.direction === 'none') return undefined
  if (variable.min === null || variable.max === null) return undefined
  const [better, worse] =
    variable.direction === 'lower_better'
      ? [variable.min, variable.max]
      : [variable.max, variable.min]
  if (level === better) return true
  if (level === worse) return false
  return undefined
}
