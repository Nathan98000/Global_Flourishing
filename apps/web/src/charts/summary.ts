// The screen-reader summary for a chart: what it shows and its extremes
// (§2.10), plus the polite announcement when a view updates.

import type { EstimateRow, Meta } from '../api/types'
import { formatEstimate } from '../format'
import { groupValueLabel } from '../labels'

export function summarizeExtremes(rows: EstimateRow[], meta: Meta, subject: string): string {
  const valid = rows
    .filter((row) => row.estimate !== null)
    .sort((a, b) => (b.estimate ?? 0) - (a.estimate ?? 0))
  const parts: string[] = [subject]
  const highest = valid[0]
  const lowest = valid[valid.length - 1]
  if (highest && lowest) {
    const name = (row: EstimateRow) =>
      groupValueLabel('country_code', row.group['country_code'] ?? null, meta)
    parts.push(
      `Highest: ${name(highest)} ${formatEstimate(highest.estimate, highest.stat)};` +
        ` lowest: ${name(lowest)} ${formatEstimate(lowest.estimate, lowest.stat)}.`,
    )
  } else {
    parts.push('No estimates to show.')
  }
  parts.push('The data table below carries every number.')
  return parts.join(' ')
}
