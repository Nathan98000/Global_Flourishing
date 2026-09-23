// Owner decision 2 (Phase 5): retention is for the maths, not the
// interface. The one reserved exception — where a country's follow-up
// group is small enough that an estimate could mislead, the figure
// carries a single plain sentence: no number, no jargon, at most once
// per figure. The threshold is derived from what the response already
// carries (the change row's n against the same country's earlier-wave
// n) — never from a coverage fetch.

import type { EstimateRow } from '../api/types'

/** Fewer than half of the earlier group answering again is the line. */
export const FOLLOW_UP_CAUTION_RATIO = 0.5

export const FOLLOW_UP_CAUTION_COPY =
  'In some countries fewer people answered the second time, so those estimates are less certain.'

/** Earlier-wave n per country from a by-country cross-section. A mean
 * row carries the country's n outright; a proportion's rows carry one
 * n per answer level (the count answering that level), so the country's
 * n is their sum — a tally of the answers the response already lists,
 * not an estimate. */
export function earlierNByCountry(rows: readonly EstimateRow[]): Map<number, number> {
  const byCountry = new Map<number, number>()
  for (const row of rows) {
    const code = Number(row.group['country_code'])
    if (!Number.isFinite(code)) continue
    const perLevel = row.level !== null && row.level !== undefined
    const current = byCountry.get(code)
    if (current === undefined) byCountry.set(code, row.n)
    else if (perLevel) byCountry.set(code, current + row.n)
  }
  return byCountry
}

/** Country codes whose follow-up group (complete pairs) is below the
 * ratio of their earlier-wave n. Countries with no earlier n are never
 * flagged — there is nothing to compare against. */
export function lowFollowUpCountries(
  changeRows: readonly EstimateRow[],
  earlierN: ReadonlyMap<number, number>,
): number[] {
  const low = new Set<number>()
  for (const row of changeRows) {
    const code = Number(row.group['country_code'])
    const earlier = earlierN.get(code)
    if (earlier === undefined || earlier <= 0) continue
    if (row.n / earlier < FOLLOW_UP_CAUTION_RATIO) low.add(code)
  }
  return [...low].sort((a, b) => a - b)
}
