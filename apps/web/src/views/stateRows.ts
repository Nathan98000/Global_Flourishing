// The US States view's row bookkeeping, kept out of the component so
// fast refresh stays clean: one ordering for the chart and the data
// table, by value or by the server's state code.

import type { EstimateRow } from '../api/types'
import { plotValue } from '../charts/theme'

/** The United States' code in the release's countries table. */
export const US_COUNTRY_CODE = 22

/** States in the sort order the chart and the table share: by value or
 * by the server's code. */
export function sortStateRows(
  rows: EstimateRow[],
  sort: 'estimate' | 'name',
  dir: 'asc' | 'desc',
): EstimateRow[] {
  const code = (row: EstimateRow) => String(row.group['state'] ?? '')
  if (sort === 'name') {
    const sign = dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => sign * code(a).localeCompare(code(b)))
  }
  const sign = dir === 'desc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const va = plotValue(a)
    const vb = plotValue(b)
    if (va === null && vb === null) return code(a).localeCompare(code(b))
    if (va === null) return 1
    if (vb === null) return -1
    return sign * (vb - va) || code(a).localeCompare(code(b))
  })
}
