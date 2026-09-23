// The What Matters view's row bookkeeping and the one piece of copy that
// depends on the catalog, kept out of the component so fast refresh
// stays clean.

import type { EstimateResponse, EstimateRow, VariableSummary } from '../api/types'
import type { Crossing } from '../topics'
import { WAVE_TITLES } from '../waves'

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

/** Why a crossing cannot be made from this release: each side's waves,
 * in words, and the plain consequence. */
export function crossingUnavailableCopy(
  crossing: Crossing,
  byName: Record<string, VariableSummary | undefined>,
): string {
  const side = (name: string) => {
    const variable = byName[name]
    if (!variable) return `${name} is not in this release's codebook`
    const waves = variable.waves_available.map((wave) => WAVE_TITLES[wave] ?? wave)
    return `${variable.display_name} was asked in the ${waves.join(' and the ')}`
  }
  return (
    `${crossing.title}: not possible from this release's data. ${side(crossing.by)}; ` +
    `${side(crossing.outcome)} — never in the same interview, so this comparison needs a ` +
    `crossing of survey rounds that the data service does not offer yet.`
  )
}
