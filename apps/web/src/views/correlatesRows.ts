// Pure helpers for the Correlates view: what to draw and how to word it.
// Nothing here computes a statistic — the rows arrive ranked and
// estimated; this file only names, keys and scales them for display.

import type { Country, EstimateRow, Meta, ResponseMeta, VariableSummary } from '../api/types'
import type { CorrelationMethod } from '../api/correlates'
import { WAVE_TITLES } from '../waves'

/** The country a URL without one shows: the catalog's first. */
export function defaultCountry(meta: Pick<Meta, 'countries'>): number | undefined {
  return meta.countries[0]?.code
}

/** The largest absolute estimate — the symmetric window a diverging
 * tint scale spans for coefficients (correlations already live in
 * [−1, 1], so they use 1). */
export function tintExtent(rows: readonly EstimateRow[], adjusted: boolean): number {
  if (!adjusted) return 1
  let extent = 0
  for (const row of rows) {
    if (row.estimate !== null) extent = Math.max(extent, Math.abs(row.estimate))
  }
  return extent > 0 ? extent : 1
}

/** Predictor × country lookup for the cross-country matrix. */
export function heatCells(rows: readonly EstimateRow[]): Map<string, EstimateRow> {
  const cells = new Map<string, EstimateRow>()
  for (const row of rows) {
    if (!row.predictor) continue
    cells.set(`${row.predictor}:${String(row.group['country_code'])}`, row)
  }
  return cells
}

export function heatKey(predictor: string, country: Country): string {
  return `${predictor}:${country.code}`
}

/** The statistic in words, for subtitles: what the number is and its range. */
export function statisticPhrase(adjusted: boolean, method: CorrelationMethod | undefined): string {
  if (adjusted) return 'adjusted association per one standard deviation of each measure'
  return method === 'spearman' ? 'rank correlation, −1 to 1' : 'weighted correlation, −1 to 1'
}

/** The controls the server says it held fixed, in words, from meta. */
export function controlsPhrase(meta: Pick<ResponseMeta, 'controls'>, served: Meta): string {
  const names = (meta.controls ?? []).map((column) =>
    column === 'country_code'
      ? 'country'
      : (served.breakdown_labels[column]?.display_name ?? column.replace(/_/g, ' ')).toLowerCase(),
  )
  if (names.length === 0) return 'nothing'
  if (names.length === 1) return names[0] as string
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** Subtitle for the ranked list: where, what, when. */
export function rankedSubtitle(
  countryName: string,
  adjusted: boolean,
  method: CorrelationMethod | undefined,
  wave: string,
): string {
  return `Strongest associations in ${countryName} · ${statisticPhrase(adjusted, method)} · ${WAVE_TITLES[wave] ?? wave}`
}

/** What the outcome's scale means for an adjusted coefficient. */
export function outcomeUnit(variable: Pick<VariableSummary, 'scale_type' | 'min' | 'max'>): string {
  if (variable.scale_type === 'binary') return 'log-odds of answering yes'
  if (variable.min !== null && variable.max !== null)
    return `points on its ${variable.min}–${variable.max} scale`
  return 'points on its own scale'
}
