// The What Matters view's row bookkeeping, kept out of the component so
// fast refresh stays clean: the seven items' rows as one set, the
// country order the matrix and the data table share, and the range the
// matrix's tints span.

import type { EstimateResponse, EstimateRow, Meta, VariableSummary } from '../api/types'
import { groupValueLabel } from '../labels'
import type { SortDir } from '../sortRows'

/** The seven items' rows stamped with their `outcome`, for one row set. */
export function rankingRows(
  results: readonly (EstimateResponse | undefined)[],
  items: readonly VariableSummary[],
  countries?: readonly number[],
): EstimateRow[] {
  const rows: EstimateRow[] = []
  results.forEach((response, index) => {
    const item = items[index]
    if (!response || !item) return
    for (const row of response.rows) {
      if (countries && !countries.includes(Number(row.group['country_code']))) continue
      rows.push({ ...row, group: { outcome: item.name, ...row.group } })
    }
  })
  return rows
}

/** Country codes in the matrix's order: A–Z by name (`sort = 'name'`),
 * or by one item's estimate (`sort` = that item's code), countries
 * without an estimate for it last either way. */
export function matrixCountryOrder(
  rows: readonly EstimateRow[],
  meta: Meta,
  sort: string,
  dir: SortDir,
): number[] {
  const codes = [...new Set(rows.map((row) => Number(row.group['country_code'])))]
  const name = (code: number) => groupValueLabel('country_code', code, meta)
  if (sort === 'name') {
    const sign = dir === 'asc' ? 1 : -1
    return codes.sort((a, b) => sign * name(a).localeCompare(name(b)))
  }
  const value = new Map<number, number>()
  for (const row of rows) {
    if (row.group['outcome'] === sort && row.estimate !== null)
      value.set(Number(row.group['country_code']), row.estimate)
  }
  const sign = dir === 'desc' ? 1 : -1
  return codes.sort((a, b) => {
    const va = value.get(a)
    const vb = value.get(b)
    if (va === undefined && vb === undefined) return name(a).localeCompare(name(b))
    if (va === undefined) return 1
    if (vb === undefined) return -1
    return sign * (vb - va) || name(a).localeCompare(name(b))
  })
}

/** The rows in matrix order (country, then item), for the data table. */
export function orderMatrixRows(
  rows: readonly EstimateRow[],
  countryOrder: readonly number[],
  items: readonly VariableSummary[],
): EstimateRow[] {
  const countryIndex = new Map(countryOrder.map((code, index) => [code, index]))
  const itemIndex = new Map(items.map((item, index) => [item.name, index]))
  return [...rows].sort(
    (a, b) =>
      (countryIndex.get(Number(a.group['country_code'])) ?? countryOrder.length) -
        (countryIndex.get(Number(b.group['country_code'])) ?? countryOrder.length) ||
      (itemIndex.get(String(a.group['outcome'])) ?? items.length) -
        (itemIndex.get(String(b.group['outcome'])) ?? items.length),
  )
}

/** The [lowest, highest] estimate in the matrix — what its tints span. */
export function matrixRange(rows: readonly EstimateRow[]): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const row of rows) {
    if (row.estimate === null) continue
    lo = Math.min(lo, row.estimate)
    hi = Math.max(hi, row.estimate)
  }
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : [0, 1]
}
