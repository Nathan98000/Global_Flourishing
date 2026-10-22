// A view's state in the controls' own words (ADR-0029): the chart's
// subtitle carries it — "Mean score, 0–10 · 2023 · all countries ·
// highest first" — and so does the phone's summary line. Control words
// only; every data label still comes from the server.

import type { EstimateRow } from '../api/types'
import type { SortDir } from '../sortRows'

/** The Countries control's state: "all countries", "3 countries". */
export function countriesPhrase(chosen: number, total: number): string {
  if (chosen === 0 || chosen === total) return 'all countries'
  return `${chosen} ${chosen === 1 ? 'country' : 'countries'}`
}

/** The order's state: "highest first" or "lowest first". */
export function orderPhrase(dir: SortDir): string {
  return dir === 'asc' ? 'lowest first' : 'highest first'
}

/** Clauses joined into one line, empty ones left out. */
export function stateLine(...clauses: (string | false | null | undefined)[]): string {
  return clauses.filter((clause): clause is string => Boolean(clause)).join(' · ')
}

/** The interval level a chart's key names, when its marks carry
 * intervals (a median ships none): the rows' own level. */
export function keyCiLevel(rows: readonly EstimateRow[]): number | undefined {
  const withCI = rows.find((row) => row.ci_lo !== null && row.ci_hi !== null)
  return withCI?.ci_level
}

/** The thin-estimate threshold a chart's key names, when any of its rows
 * is thin (ADR-0031): the server's `meta.suppression.flag_below`. */
export function keyThinBelow(
  rows: readonly Pick<EstimateRow, 'flagged' | 'estimate'>[],
  suppression: { flag_below: number } | undefined,
): number | undefined {
  return suppression &&
    suppression.flag_below > 0 &&
    rows.some((row) => row.flagged && row.estimate !== null)
    ? suppression.flag_below
    : undefined
}
