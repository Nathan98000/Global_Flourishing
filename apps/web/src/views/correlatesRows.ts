// Pure helpers for the Correlates view: what to draw and how to word it.
// Nothing here computes a statistic — the rows arrive ranked and
// estimated; this file only names, keys and scales them for display.

import type { Country, EstimateRow, Meta, ResponseMeta } from '../api/types'
import { WAVES } from '../api/types'
import type { CorrelationMethod } from '../api/correlates'
import { formatCount, formatEstimate } from '../format'
import { WAVE_CHIPS, WAVE_NAMES, WAVE_TITLES } from '../waves'

/** The country a URL without one shows: the United States (by its
 * ISO code in meta — the front end owns no country list), else the
 * catalog's first. */
export function defaultCountry(meta: Pick<Meta, 'countries'>): number | undefined {
  return meta.countries.find((country) => country.iso3 === 'USA')?.code ?? meta.countries[0]?.code
}

/** Countries A–Z by name (never by code): the Country select and every
 * country axis on this page. */
export function countriesByName(countries: readonly Country[]): Country[] {
  return [...countries].sort((a, b) => a.name.localeCompare(b.name))
}

/** "A", "A and B", "A, B and C". */
function listAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** Why the Wave options a measure was not asked in are unavailable, in
 * one line under the control; undefined when every wave is open (or
 * none is — the page says so in its own empty state). */
export function waveNote(asked: readonly string[]): string | undefined {
  const missing = WAVES.filter((wave) => !asked.includes(wave))
  const present = WAVES.filter((wave) => asked.includes(wave))
  if (missing.length === 0 || present.length === 0) return undefined
  const chips = listAnd(missing.map((wave) => WAVE_CHIPS[wave] ?? wave))
  if (missing.length === 1) {
    const [wave] = missing as [string]
    return `${chips} isn't available: this question wasn't asked in ${WAVE_NAMES[wave] ?? wave}.`
  }
  const only = listAnd(present.map((wave) => WAVE_NAMES[wave] ?? wave))
  return `${chips} aren't available: this question was asked only in ${only}.`
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

/** The Method disclosure: its button names the correlation in use. */
export function methodLabel(method: CorrelationMethod | undefined): string {
  return method === 'spearman' ? 'Method: by-rank correlation' : 'Method: straight-line correlation'
}

/** The line under the correlation choice, in plain words. */
export const METHOD_HINT =
  'Straight-line: how closely two answers follow a line. By rank: how consistently one rises with the other.'

/** The value axis title for the ranked list. */
export function axisTitle(method: CorrelationMethod | undefined): string {
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
export function statisticPhrase(method: CorrelationMethod | undefined): string {
  return method === 'spearman' ? 'rank correlation, −1 to 1' : 'weighted correlation, −1 to 1'
}

/** Subtitle for the ranked list: where, what, when. */
export function rankedSubtitle(
  countryName: string,
  method: CorrelationMethod | undefined,
  wave: string,
): string {
  return `Strongest associations in ${countryName} · ${statisticPhrase(method)} · ${WAVE_TITLES[wave] ?? wave}`
}
