// Pure helpers for the Correlates view: what to draw and how to word it.
// Nothing here computes a statistic — the rows arrive ranked and
// estimated; this file only names, keys and scales them for display.

import type { Country, EstimateRow, Meta, ResponseMeta, VariableSummary } from '../api/types'
import type { CorrelationMethod } from '../api/correlates'
import { formatCount, formatEstimate } from '../format'
import { WAVE_TITLES } from '../waves'

/** The country a URL without one shows: the United States (by its
 * ISO code in meta — the front end owns no country list), else the
 * catalog's first. */
export function defaultCountry(meta: Pick<Meta, 'countries'>): number | undefined {
  return meta.countries.find((country) => country.iso3 === 'USA')?.code ?? meta.countries[0]?.code
}

/** The largest absolute estimate in view — the symmetric window the
 * diverging tint scale spans, fitted to the data for correlations and
 * coefficients alike (a fixed ±1 leaves every real correlation in the
 * two palest tints). */
export function tintExtent(rows: readonly EstimateRow[]): number {
  let extent = 0
  for (const row of rows) {
    if (row.estimate !== null) extent = Math.max(extent, Math.abs(row.estimate))
  }
  return extent > 0 ? extent : 1
}

/** The matrix caption in plain words: what the hues mean and what the
 * deepest tint stands for. */
export function matrixCaption(outcome: string, extent: number, stat: string): string {
  return `${outcome} — rust: a negative association, teal: positive; the deeper the tint, the stronger it is (the deepest tint is ${formatEstimate(extent, stat).replace('+', '')} either way)`
}

/** The ranked sweep's floor, in words, when it left measures out. */
export function excludedNote(meta: Pick<ResponseMeta, 'min_n' | 'n_excluded'>): string | undefined {
  const excluded = meta.n_excluded ?? 0
  if (excluded === 0 || meta.min_n === null || meta.min_n === undefined) return undefined
  const floor = formatCount(meta.min_n)
  return excluded === 1
    ? `1 measure with fewer than ${floor} respondents is not ranked.`
    : `${formatCount(excluded)} measures with fewer than ${floor} respondents are not ranked.`
}

/** Whether a matrix cell rests on too few cases to be ranked. */
export function belowFloor(row: Pick<EstimateRow, 'n'>, minN: number | null | undefined): boolean {
  return minN !== null && minN !== undefined && row.n < minN
}

/** The one-line hint under the correlation choice. */
export const METHOD_HINT =
  'Pearson measures how closely two answers follow a straight line; Spearman, how consistently one rises with the other, by rank.'

/** The value axis title for the ranked list. */
export function axisTitle(
  adjusted: boolean,
  method: CorrelationMethod | undefined,
  variable: Pick<VariableSummary, 'display_name' | 'scale_type' | 'min' | 'max'>,
): string {
  if (adjusted) {
    return variable.scale_type === 'binary'
      ? `${variable.display_name}: log-odds per 1 SD of the measure`
      : `${variable.display_name}: points per 1 SD of the measure`
  }
  return method === 'spearman' ? 'Rank correlation (Spearman)' : 'Weighted correlation (Pearson)'
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
  if (adjusted) return 'adjusted difference per 1 SD of each measure'
  return method === 'spearman' ? 'rank correlation, −1 to 1' : 'weighted correlation, −1 to 1'
}

/** The adjusted subtitle's unit and control set, both from the server:
 * "Happiness points per 1 SD of each measure, holding age band, gender
 * … fixed". */
export function adjustedPhrase(
  variable: Pick<VariableSummary, 'display_name' | 'scale_type'>,
  meta: Pick<ResponseMeta, 'controls'>,
  served: Meta,
): string {
  const unit = variable.scale_type === 'binary' ? 'log-odds' : 'points'
  return `${variable.display_name} ${unit} per 1 SD of each measure, holding ${controlsPhrase(meta, served)} fixed`
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

/** Subtitle for the ranked list: where, what, when. The adjusted phrase
 * (unit and controls, from the server) replaces the statistic's name. */
export function rankedSubtitle(
  countryName: string,
  adjusted: boolean,
  method: CorrelationMethod | undefined,
  wave: string,
  adjustedWording?: string,
): string {
  const what = adjusted && adjustedWording ? adjustedWording : statisticPhrase(adjusted, method)
  return `Strongest associations in ${countryName} · ${what} · ${WAVE_TITLES[wave] ?? wave}`
}

/** What the outcome's scale means for an adjusted coefficient. */
export function outcomeUnit(variable: Pick<VariableSummary, 'scale_type' | 'min' | 'max'>): string {
  if (variable.scale_type === 'binary') return 'log-odds of answering yes'
  if (variable.min !== null && variable.max !== null)
    return `points on its ${variable.min}–${variable.max} scale`
  return 'points on its own scale'
}
