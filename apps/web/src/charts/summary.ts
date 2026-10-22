// The screen-reader summary for a chart: what it shows and its extremes
// (§2.10), plus the polite announcement when a view updates.

import type { EstimateRow, Meta } from '../api/types'
import { formatEstimate } from '../format'
import { groupValueLabel } from '../labels'

/** The last words of a chart no keyboard reads row by row yet (the What
 * Matters grids, Compare two's grid, a distribution, the map): where its
 * numbers are (owner decision 1, 22 Oct 2026) — in the chart node's
 * label, never a line under the chart (ADR-0024). */
export const CSV_SENTENCE = 'Every number, with its 95% CI and n, is in the CSV (Download).'

export function summarizeExtremes(rows: EstimateRow[], meta: Meta, subject: string): string {
  return summarizeCells(
    rows,
    (row) => groupValueLabel('country_code', row.group['country_code'] ?? null, meta),
    subject,
  )
}

/** A chart's extremes in words: its highest and lowest value, each named
 * by `nameOf` (a country; a grid's cell by its row and column) — picked
 * from the served numbers, never computed. */
export function summarizeCells(
  rows: readonly EstimateRow[],
  nameOf: (row: EstimateRow) => string,
  subject: string,
): string {
  const valid = rows
    .filter((row) => row.estimate !== null)
    .sort((a, b) => (b.estimate ?? 0) - (a.estimate ?? 0))
  const parts: string[] = [subject]
  const highest = valid[0]
  const lowest = valid[valid.length - 1]
  if (highest && lowest) {
    parts.push(
      `Highest: ${nameOf(highest)} ${formatEstimate(highest.estimate, highest.stat)};` +
        ` lowest: ${nameOf(lowest)} ${formatEstimate(lowest.estimate, lowest.stat)}.`,
    )
  } else {
    parts.push('No estimates to show.')
  }
  return parts.join(' ')
}

/** "A", "A and B", "A, B and C". */
export function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** What a statistic's values are called, several at once. */
const STAT_PLURAL: Record<string, string> = { mean: 'means', quantile: 'medians' }

/** A distribution's summary (H1): the countries drawn, in their order,
 * each with its served mean (or median) from the by-country estimates
 * the panel order already reads — "…how people in Indonesia, Mexico and
 * Poland answered — means 7.99, 7.85 and 7.52." */
export function summarizeDistribution(
  subject: string,
  countries: readonly string[],
  values: readonly (EstimateRow | undefined)[],
): string {
  if (countries.length === 0) return `${subject} No estimates to show.`
  const shown = values.filter((row): row is EstimateRow => row?.estimate != null)
  const stat = shown[0]?.stat
  const word = stat ? STAT_PLURAL[stat] : undefined
  const numbers =
    word && shown.length === values.length
      ? ` — ${word} ${listWords(shown.map((row) => formatEstimate(row.estimate, row.stat)))}`
      : ''
  return `${subject} How people in ${listWords(countries)} answered${numbers}. ${CSV_SENTENCE}`
}
