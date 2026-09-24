// The Compare view's row bookkeeping, kept out of the component so fast
// refresh stays clean: the compared units and the one row set the chart
// and the data table share.

import type { Country, EstimateResponse, EstimateRow, Meta } from '../api/types'
import { highestLevel } from '../labels'

/** The three countries a Compare without a URL selection starts with,
 * by ISO code — Indonesia, the United States, Japan — when the release
 * has all three; otherwise none (the view then asks). */
export const DEFAULT_COMPARE_ISO3: readonly string[] = ['IDN', 'USA', 'JPN']

export function defaultCompareCountries(countries: readonly Country[]): number[] {
  const codes = DEFAULT_COMPARE_ISO3.map(
    (iso3) => countries.find((country) => country.iso3 === iso3)?.code,
  )
  return codes.every((code): code is number => code !== undefined) ? codes : []
}

/** Country names in A–Z order for the chosen codes — the compared units. */
export function compareUnits(countries: readonly number[], meta: Meta): string[] {
  return meta.countries
    .filter((country) => countries.includes(country.code))
    .map((country) => country.name)
    .sort((a, b) => a.localeCompare(b))
}

/** One row set for the chart and the table: each response's rows for the
 * chosen countries, stamped with their `outcome`. A proportion response
 * keeps its highest level (the "positive" share a binary item's name
 * describes). */
export function combineRows(
  results: readonly (EstimateResponse | undefined)[],
  outcomes: readonly string[],
  countries: readonly number[],
): EstimateRow[] {
  const rows: EstimateRow[] = []
  results.forEach((response, index) => {
    const outcome = outcomes[index]
    if (!response || outcome === undefined) return
    const level = response.meta.stat === 'proportion' ? highestLevel(response.rows) : undefined
    for (const row of response.rows) {
      if (!countries.includes(Number(row.group['country_code']))) continue
      if (level !== undefined && row.level !== level) continue
      rows.push({ ...row, group: { outcome, ...row.group } })
    }
  })
  return rows
}
