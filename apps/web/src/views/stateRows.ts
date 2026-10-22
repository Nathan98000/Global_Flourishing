// The US States view's row bookkeeping, kept out of the component so
// fast refresh stays clean: one ordering for the chart and the CSV, by
// value (ADR-0029).

import type { EstimateRow } from '../api/types'
import { plotValue } from '../charts/theme'

/** The United States' code in the release's countries table. */
export const US_COUNTRY_CODE = 22

/** States by value in the order the chart and the CSV share, ties in
 * name order (the server's label for the code; the code itself when no
 * labeller is given). */
export function sortStateRows(
  rows: EstimateRow[],
  dir: 'asc' | 'desc',
  labelOf?: (code: string) => string,
): EstimateRow[] {
  const raw = (row: EstimateRow) => String(row.group['state'] ?? '')
  const code = (row: EstimateRow) => (labelOf ? labelOf(raw(row)) : raw(row))
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
