// Pure helpers for the Correlates view: what to draw and how to word it.
// Nothing here computes a statistic — the rows arrive ranked and
// estimated; this file only names, keys and scales them for display.

import type { Country, EstimateRow, Meta, ResponseMeta, VariableSummary } from '../api/types'
import { WAVES } from '../api/types'
import type { CorrelationMethod } from '../api/correlates'
import { ciLabel, formatCount, formatEstimate } from '../format'
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

/** Every country A–Z, the chosen one pinned first (the matrix's columns). */
export function pinnedFirst(countries: readonly Country[], chosen: number | undefined): Country[] {
  const byName = countriesByName(countries)
  const pinned = byName.find((country) => country.code === chosen)
  return pinned ? [pinned, ...byName.filter((country) => country !== pinned)] : byName
}

/** What the page calls a measure in its keys and axis ends ("goes with
 * higher …"): the catalog's short label when it serves one, else the
 * display name — the catalog serves no variable-level short label today
 * (only answers have one), so this is the display name. */
export function shortName(
  variable: Pick<VariableSummary, 'display_name'> & { short_label?: string | null },
): string {
  return variable.short_label?.trim() || variable.display_name
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

/** The diverging legend's ends: "−0.52" and "+0.52". */
export function legendEnds(extent: number, stat: string): [string, string] {
  return [formatEstimate(-extent, stat), formatEstimate(extent, stat)]
}

/** The Across countries subtitle: which measures, where, when, what. */
export function acrossSubtitle(count: number, countryName: string, wave: string): string {
  const measures = count === 1 ? 'The 1 measure' : `The ${count} measures`
  return `${measures} ranked for ${countryName}, in every country · ${WAVE_TITLES[wave] ?? wave} · correlation, −1 to 1`
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

// --- Compare two ------------------------------------------------------------

/** The correlation in words, for a subtitle: "straight-line" or "by rank". */
export function methodWords(method: CorrelationMethod | undefined): string {
  return method === 'spearman' ? 'by rank' : 'straight-line'
}

/** Compare two's subtitle: where, when, what each dot is, and the
 * correlation with its n. */
export function pairSubtitle({
  countryName,
  wave,
  y,
  x,
  binary,
  binned,
  correlation,
  method,
}: {
  countryName: string
  wave: string
  y: string
  x: string
  /** A yes/no Y: each dot is the share answering yes. */
  binary: boolean
  /** X's groups are bins of a long scale, not its answers. */
  binned: boolean
  correlation: Pick<EstimateRow, 'estimate' | 'stat' | 'n'>
  method: CorrelationMethod | undefined
}): string {
  const what = binary ? `share answering yes to ${y}` : `average ${y}`
  const per = binned ? `across the range of ${x}` : `for each answer to ${x}`
  return `${countryName} · ${WAVE_TITLES[wave] ?? wave} · ${what} ${per} · correlation ${formatEstimate(correlation.estimate, correlation.stat)} (${methodWords(method)}), ${formatCount(correlation.n)} people`
}

/** A group's share of the people, as a whole percent (one decimal
 * under 1%, so a sliver never reads 0%). */
export function shareText(share: number): string {
  const percent = share * 100
  return percent > 0 && percent < 1 ? `${percent.toFixed(1)}%` : `${Math.round(percent)}%`
}

/** One group's tooltip: its share of the people, Y there with its
 * interval, and how many people it rests on (the pair view's rule —
 * ADR-0018 — since a group's n is what its dot's size and its flag
 * are about). */
export function pairTip(
  point: { label: string; share: number; row: EstimateRow },
  { yShort, binary, binned }: { yShort: string; binary: boolean; binned: boolean },
): string {
  const { row } = point
  const who = binned
    ? `${shareText(point.share)} at ${point.label}`
    : `${shareText(point.share)} answered ${point.label}`
  const interval =
    row.ci_lo !== null && row.ci_hi !== null
      ? ` (${ciLabel(row.ci_level)} ${formatEstimate(row.ci_lo, row.stat)}–${formatEstimate(row.ci_hi, row.stat)})`
      : ''
  const value = `${binary ? 'Answered yes' : `Average ${yShort}`}: ${formatEstimate(row.estimate, row.stat)}${interval}`
  return [who, value, `${formatCount(row.n)} ${row.n === 1 ? 'person' : 'people'}`].join('\n')
}

/** The footnote's words for the hollow groups, when there are any. */
export function hollowNote(
  labels: readonly string[],
  minN: number,
  binned: boolean,
): string | undefined {
  if (labels.length === 0) return undefined
  const named = listAnd(labels.map((label) => `“${label}”`))
  const where = binned ? `are in ${named}` : `gave ${named}`
  const dots = labels.length === 1 ? 'its dot is' : 'their dots are'
  return `Fewer than ${formatCount(minN)} people ${where}: ${dots} drawn hollow.`
}
