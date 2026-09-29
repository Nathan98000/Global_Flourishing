// Pure helpers for the Correlates view: what to draw and how to word it.
// Nothing here computes a statistic — the rows arrive ranked and
// estimated; this file only names, keys and scales them for display.

import type { Country, EstimateRow, Meta, VariableDetail, VariableSummary } from '../api/types'
import { WAVES } from '../api/types'
import type { CorrelationMethod } from '../api/correlates'
import { shareLabel } from '../charts/CrossTab'
import { formatEstimate } from '../format'
import { endpointsClause, shortName } from '../labels'
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

/** The Country select's first choice: every country pooled, each
 * weighted to its adult population (ADR-0020). */
export const ALL_COUNTRIES = 'All countries'

/** Every country A–Z, the chosen one pinned first (the matrix's columns);
 * pooled — no one country chosen — simply A–Z. */
export function pinnedFirst(
  countries: readonly Country[],
  chosen: number | 'all' | undefined,
): Country[] {
  const byName = countriesByName(countries)
  const pinned = byName.find((country) => country.code === chosen)
  return pinned ? [pinned, ...byName.filter((country) => country !== pinned)] : byName
}

export { shortName }

/** "A", "A and B", "A, B and C" (or "A, B or C"). */
function listAnd(items: readonly string[], conjunction = 'and'): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} ${conjunction} ${items[items.length - 1]}`
}

/** Where a pooled estimate stands (ADR-0020): "All countries, combined
 * by adult population", or — when it covers fewer (a question some
 * countries didn't ask) — "21 of 23 countries (not China or Egypt),
 * combined by adult population", naming the missing ones when there are
 * three or fewer. `covered`: the response's countries. */
export function pooledPlace(
  covered: readonly number[] | null | undefined,
  countries: readonly Country[],
): string {
  const inIt = new Set(covered ?? countries.map((country) => country.code))
  const missing = countriesByName(countries)
    .filter((country) => !inIt.has(country.code))
    .map((country) => country.name)
  if (missing.length === 0) return 'All countries, combined by adult population'
  const named = missing.length <= 3 ? ` (not ${listAnd(missing, 'or')})` : ''
  return `${countries.length - missing.length} of ${countries.length} countries${named}, combined by adult population`
}

/** The scope toggle's first choice (Compare two, Find related): "In
 * United States", or "All countries" when every country is pooled. */
export function scopeLabel(countryName: string): string {
  if (countryName === ALL_COUNTRIES) return ALL_COUNTRIES
  return countryName ? `In ${countryName}` : 'In one country'
}

/** A pooled estimate's tooltip line when it covers fewer countries than
 * all of them: "Asked in 21 of 23 countries." */
export function coverageLine(
  row: Pick<EstimateRow, 'n_countries'> | null | undefined,
  total: number,
): string | undefined {
  const covered = row?.n_countries
  return covered !== null && covered !== undefined && covered < total
    ? `Asked in ${covered} of ${total} countries.`
    : undefined
}

/** A tooltip with its coverage line, when there is one. */
export function withCoverage(tip: string, line: string | undefined): string {
  return line ? `${tip}\n${line}` : tip
}

/** Why the Wave options are unavailable, in one line under the row:
 * `open` are the waves the view's question — its pair, its table — can be
 * shown at; undefined when every wave is open (or none is — the page
 * says so in its own empty state). */
export function waveNote(
  open: readonly string[],
  who: 'question' | 'pair' | 'table' = 'question',
): string | undefined {
  const missing = WAVES.filter((wave) => !open.includes(wave))
  const present = WAVES.filter((wave) => open.includes(wave))
  if (missing.length === 0 || present.length === 0) return undefined
  const chips = listAnd(missing.map((wave) => WAVE_CHIPS[wave] ?? wave))
  const verb = missing.length === 1 ? "isn't" : "aren't"
  const names = (waves: readonly string[]) => listAnd(waves.map((wave) => WAVE_NAMES[wave] ?? wave))
  if (who === 'table')
    return `${chips} ${verb} available: fewer than two of these questions were asked in ${names(missing)}.`
  if (missing.length === 1)
    return who === 'pair'
      ? `${chips} isn't available: the two questions weren't both asked in ${names(missing)}.`
      : `${chips} isn't available: this question wasn't asked in ${names(missing)}.`
  return who === 'pair'
    ? `${chips} aren't available: the two questions were both asked only in ${names(present)}.`
    : `${chips} aren't available: this question was asked only in ${names(present)}.`
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

/** Find related's subtitle country by country: which questions, where,
 * when, what. */
export function acrossSubtitle(
  count: number,
  countryName: string,
  wave: string,
  method?: CorrelationMethod,
): string {
  const questions = count === 1 ? 'The 1 question' : `The ${count} questions`
  const place = countryName === ALL_COUNTRIES ? 'all countries combined' : countryName
  return `${questions} ranked for ${place}, country by country · ${WAVE_TITLES[wave] ?? wave} · ${statisticPhrase(method)}`
}

/** Whether a correlation rests on fewer people than the ranking floor
 * (the server's `min_n`): shown, with an asterisk (ADR-0019). */
export function belowFloor(row: Pick<EstimateRow, 'n'>, minN: number | null | undefined): boolean {
  return minN !== null && minN !== undefined && row.n < minN
}

/** Whether few people are behind a correlation: it has a value, and
 * rests on fewer people than the ranking floor. (No value: no asterisk
 * — the cell says there is no estimate instead.) */
export function fewPeople(
  row: Pick<EstimateRow, 'estimate' | 'n'>,
  minN: number | null | undefined,
): boolean {
  return row.estimate !== null && belowFloor(row, minN)
}

/** A cell with no value at all, in its tooltip. */
export const NO_ESTIMATE = 'No estimate: too few people answered both.'

/** The asterisk's key, wherever the page shows one (ADR-0020). */
export const FEW_PEOPLE_KEY = '* small sample size'

/** What a screen reader hears after a flagged value, in place of "*". */
export const FEW_PEOPLE_HIDDEN = ', small sample size'

/** The one note under every Correlates chart, after its data table
 * (ADR-0020): in place of the interval clause, where the n lives, any
 * footnote and the Methods link. */
export const CORRELATES_NOTE = "Weighted so each country's sample stands for its adult population."

/** A value, with its asterisk when few people are behind it. */
export function starred(text: string, flagged: boolean): string {
  return flagged ? `${text}*` : text
}

/** A run of a paragraph: plain words, or a method's name in bold. */
export type Words = string | { strong: string }

/** "What's the difference?" beside the correlation type (ADR-0020): four
 * short paragraphs in plain words, the method names in bold. */
export const METHOD_DIFFERENCE: readonly (readonly Words[])[] = [
  [
    'Both numbers run from −1 to 1. Near 0, answers to the two questions don’t go together. Toward +1, higher answers to one go with higher answers to the other; toward −1, higher goes with lower.',
  ],
  [
    { strong: 'Straight-line (Pearson)' },
    ' treats answers as numbers and asks how closely people fall along a straight line. The size of each gap counts, so it suits 0–10 scales, but a few unusual answers can pull it.',
  ],
  [
    { strong: 'By rank (Spearman)' },
    ' puts people in order on each question and asks how closely the two orders match. Only the order counts, not the size of the gaps, so it suits answers like “Never … Always”, and unusual answers pull it less.',
  ],
  [
    'The two are usually close. A big difference means the pattern bends (steep at one end, flat at the other), or a few unusual answers are pulling ',
    { strong: 'Straight-line' },
    '.',
  ],
]

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
  return method === 'spearman' ? 'correlation by rank, −1 to 1' : 'correlation, −1 to 1'
}

/** Subtitle for the ranked list: where, when, what. */
export function rankedSubtitle(
  countryName: string,
  method: CorrelationMethod | undefined,
  wave: string,
): string {
  return `${countryName} · ${WAVE_TITLES[wave] ?? wave} · ${statisticPhrase(method)}`
}

/** The ranked list's fixed window: a correlation always spans −1 to 1,
 * so "far right" is the same number for every measure (three ticks on a
 * phone). */
export const CORRELATION_SCALE = {
  domain: [-1, 1] as [number, number],
  ticks: [-1, -0.5, 0, 0.5, 1],
  narrowTicks: [-1, 0, 1],
}

/** The words under the axis's two ends (Find related). */
export function axisEnds(short: string): [string, string] {
  return [`← goes with a lower ${short}`, `goes with a higher ${short} →`]
}

/** A ranked row's tooltip: the signed value — with its asterisk when
 * few people are behind it — and the question; never the n (ADR-0016,
 * restored by ADR-0019). */
export function rankedTip(
  row: Pick<EstimateRow, 'estimate' | 'stat'>,
  label: string,
  flagged = false,
): string {
  return `${starred(formatEstimate(row.estimate, row.stat), flagged)} · ${label}`
}

// --- Compare two ------------------------------------------------------------

/** An axis title: the question's short name and, when the axis shows
 * numbers (a 0–10 or count item's answers), its ends in the item's own
 * words — "Life evaluation today · 0 = Worst possible, 10 = Best
 * possible". An axis of worded answers, or a score's bins, needs none. */
export function pairAxisTitle(
  variable: Pick<VariableSummary, 'display_name' | 'scale_type' | 'is_derived'>,
  detail: VariableDetail | undefined,
): string {
  const short = shortName(variable)
  const numbered =
    !variable.is_derived &&
    (variable.scale_type === 'scale_0_10' || variable.scale_type === 'count')
  const ends = numbered ? endpointsClause(detail).trim() : ''
  return ends ? `${short} · ${ends.slice(1, -1)}` : short
}

/** A cell's tooltip: the column's people, the share of them who gave the
 * row's answer (starred when few people are behind it) and its interval
 * (ADR-0016) — never the n. */
export function pairCellTip({
  aLevel,
  aShort,
  bLevel,
  bShort,
  share,
  interval,
  flagged,
}: {
  aLevel: string
  aShort: string
  bLevel: string
  bShort: string
  share: number | null
  interval: string | undefined
  flagged: boolean
}): string {
  if (share === null) return `Nobody here answered ${aLevel} to ${aShort}.`
  const lines = [
    `Of people who answered ${aLevel} to ${aShort}, ${starred(shareLabel(share), flagged)} answered ${bLevel} to ${bShort}.`,
  ]
  if (interval) lines.push(interval)
  return lines.join('\n')
}

/** A bar's tooltip: the share who gave that answer (starred when its
 * column rests on few people), and its interval. */
export function pairBarTip({
  level,
  short,
  share,
  interval,
  flagged,
}: {
  level: string
  short: string
  share: number
  interval: string | undefined
  flagged: boolean
}): string {
  const lines = [`${starred(shareLabel(share), flagged)} answered ${level} to ${short}.`]
  if (interval) lines.push(interval)
  return lines.join('\n')
}
