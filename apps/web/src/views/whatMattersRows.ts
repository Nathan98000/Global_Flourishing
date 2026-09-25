// The What Matters view's row bookkeeping, kept out of the component so
// fast refresh stays clean: the seven items' rows as one set, the row
// order a matrix and its data table share (countries, or one country's
// groups), each column's tint window, and the columns' labels and width.

import type { EstimateResponse, EstimateRow, Meta, VariableSummary } from '../api/types'
import { groupValueLabel } from '../labels'
import type { SortDir } from '../sortRows'

/** A matrix column's label: the item's `short_label` when the catalog
 * carries one, else its display name without the leading "Importance: "
 * — "Being a good person", "Money" — first letter capitalized; the
 * subtitle says "How important" once instead of every column. (The
 * catalog serves no variable-level `short_label` today — only answer
 * labels have one — so every column takes the fallback until it does.) */
export function itemLabel(item: VariableSummary & { short_label?: string | null }): string {
  const short = item.short_label?.trim()
  if (short) return short
  const name = item.display_name.replace(/^Importance:\s*/i, '')
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/** The narrowest text width at which every label wraps to at most
 * `maxLines` lines, breaking only between words and filling each line
 * greedily, as the browser does — so never narrower than the longest
 * word. `measure` is a string's width in the header's face. A line is
 * always a run of consecutive words, so the answer is one of their
 * widths: the smallest that fits. */
export function narrowestWrap(
  labels: readonly string[],
  measure: (text: string) => number,
  maxLines: number,
): number {
  const texts = labels.map((label) => label.split(/\s+/).filter(Boolean))
  const fits = (width: number) =>
    texts.every((words) => {
      let lines = 1
      let line = ''
      for (const word of words) {
        if (measure(word) > width) return false
        const next = line ? `${line} ${word}` : word
        if (line && measure(next) > width) {
          lines += 1
          line = word
        } else {
          line = next
        }
      }
      return lines <= maxLines
    })
  const runs = texts.flatMap((words) =>
    words.flatMap((_, start) =>
      words.slice(start).map((__, length) => words.slice(start, start + length + 1).join(' ')),
    ),
  )
  const widths = [...new Set(runs.map(measure))].sort((a, b) => a - b)
  return widths.find(fits) ?? 0
}

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

/** The rows in matrix order (row, then item), for the data table: rows
 * are `column`'s values in `rowOrder` (countries by default); a value
 * the matrix doesn't show sorts last. */
export function orderMatrixRows(
  rows: readonly EstimateRow[],
  rowOrder: readonly (string | number)[],
  items: readonly VariableSummary[],
  column = 'country_code',
): EstimateRow[] {
  const rowIndex = new Map<unknown, number>(rowOrder.map((value, index) => [value, index]))
  const itemIndex = new Map(items.map((item, index) => [item.name, index]))
  return [...rows].sort(
    (a, b) =>
      (rowIndex.get(a.group[column]) ?? rowOrder.length) -
        (rowIndex.get(b.group[column]) ?? rowOrder.length) ||
      (itemIndex.get(String(a.group['outcome'])) ?? items.length) -
        (itemIndex.get(String(b.group['outcome'])) ?? items.length),
  )
}

/** The country "Within a country" shows until one is chosen: the United
 * States (by its ISO code in meta — the front end owns no country list),
 * else the first country A–Z. */
export function defaultSplitCountry(meta: Pick<Meta, 'countries'>): number | undefined {
  const us = meta.countries.find((country) => country.iso3 === 'USA')
  if (us) return us.code
  return [...meta.countries].sort((a, b) => a.name.localeCompare(b.name))[0]?.code
}

/** One country's rows of the split, as matrix rows: `column`'s levels in
 * the served order (levelDomain's), keeping every level with at least
 * one row — even a row with no estimate or interval (ADR-0011) — and
 * omitting a level the country has no rows for at all (Japan × "Out of
 * work (reserve duty)"). Rows without a level (a missing demographic)
 * are no group. */
export function splitGroupOrder(
  rows: readonly EstimateRow[],
  column: string,
  meta: Pick<Meta, 'breakdown_labels'>,
): (string | number)[] {
  const present = new Set(rows.map((row) => row.group[column]))
  return (meta.breakdown_labels[column]?.levels ?? [])
    .map((level) => level.value)
    .filter((value) => present.has(value))
}

/** Each column's tint window, keyed by item: its own [lowest, highest]
 * estimate across the rows shown, so a column's shades compare the
 * rows on that item alone — widened to at least `minSpan` points about
 * its midpoint, or a column of near-equal values (US money by age runs
 * 7.46–7.66) would spread a fifth of a point over the whole ramp. */
export function columnRanges(
  rows: readonly EstimateRow[],
  minSpan = 1,
): Map<string, [number, number]> {
  const ranges = new Map<string, [number, number]>()
  for (const row of rows) {
    if (row.estimate === null) continue
    const item = String(row.group['outcome'])
    const [lo, hi] = ranges.get(item) ?? [Infinity, -Infinity]
    ranges.set(item, [Math.min(lo, row.estimate), Math.max(hi, row.estimate)])
  }
  for (const [item, [lo, hi]] of ranges) {
    if (hi - lo >= minSpan) continue
    const mid = (lo + hi) / 2
    ranges.set(item, [mid - minSpan / 2, mid + minSpan / 2])
  }
  return ranges
}
