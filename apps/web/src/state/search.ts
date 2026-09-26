// Typed URL state: the URL *is* the state (proposal §4.4). Query params
// carry the API's own names (outcome, wave, stat, by); view-only
// params (sort, countries) are separate. Defaults are omitted from
// the URL; invalid values degrade to defaults and are reported through the
// `invalid` key, which renders as a notice and is recomputed on every
// parse — it can never be forged into or trapped in a shared URL.

import type { ChangeRequest } from '../api/change'
import type { CorrelatesRequest } from '../api/correlates'
import type { PairRequest, TableRequest } from '../api/correlations'
import type { AggregateRequest } from '../api/estimates'
import { adjustedWeightsExist, type StatesRequest } from '../api/states'
import type { Stat, VariableSummary, Wave } from '../api/types'
import { WAVES, isStat, isWave } from '../api/types'
import { defaultDir, type SortDir } from '../sortRows'
import type { RawSearch } from './searchCodec'

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/

type Raw = RawSearch | Record<string, unknown>

function first(raw: Raw, key: string): unknown {
  const value = (raw as Record<string, unknown>)[key]
  return Array.isArray(value) ? value[0] : value
}

function all(raw: Raw, key: string): unknown[] {
  const value = (raw as Record<string, unknown>)[key]
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

/** Rejected raws a state object carries into a re-parse. The router
 * re-validates coerced state during its own URL rebuilds; without this,
 * a rebuild would silently shorten the invalid list (the wave=Y9 the
 * visitor typed is already 'Y1' by then). Never a URL param — from a
 * URL this key is a string and is ignored. */
function carriedInvalid(raw: Raw): Record<string, unknown> {
  const carried = (raw as Record<string, unknown>)['invalidRaw']
  return typeof carried === 'object' && carried !== null && !Array.isArray(carried)
    ? (carried as Record<string, unknown>)
    : {}
}

class Collector {
  readonly dropped: string[] = []
  readonly raw: Record<string, unknown> = {}

  private reject(key: string, value: unknown): void {
    this.dropped.push(key)
    this.raw[key] = value
  }

  /** `whole`: hand the parser the key's full raw value (a repeated key
   * arrives as an array) instead of its first element. The parser must
   * judge from that value alone — the carried-raw re-check below feeds
   * it the typed value, not the raw object — or a rejection is lost on
   * the router's rebuild. */
  take<T>(
    key: string,
    raw: Raw,
    parse: (value: unknown) => T | undefined,
    fallback: T,
    whole = false,
  ): T {
    const value = whole ? (raw as Record<string, unknown>)[key] : first(raw, key)
    let out = fallback
    if (value !== undefined && !(Array.isArray(value) && value.length === 0)) {
      const parsed = parse(value)
      if (parsed === undefined) this.reject(key, (raw as Record<string, unknown>)[key])
      else out = parsed
    }
    const carried = carriedInvalid(raw)[key]
    if (
      !(key in this.raw) &&
      carried !== undefined &&
      parse(whole ? carried : first({ [key]: carried }, key)) === undefined
    ) {
      this.reject(key, carried)
    }
    return out
  }

  finish<T extends object>(search: T): T & { invalid?: string[]; invalidRaw?: RawParams } {
    // Always present (undefined when clean): a router state merge would
    // otherwise let a stale notice — or a rejected raw value in an
    // optional field — survive a re-parse.
    return {
      ...search,
      invalid: this.dropped.length ? this.dropped : undefined,
      invalidRaw: this.dropped.length ? this.raw : undefined,
    }
  }
}

export type RawParams = Record<string, unknown>

/** Serialization keeps the *rejected raw params* in the URL (they are
 * what was typed), so every re-parse recomputes the full invalid list —
 * a router rewrite can never silently shorten the notice. A key the
 * caller set to a real value (the user moved that control, or dismissed
 * the notice) drops its raw leftover. */
function withInvalidRaw(
  params: Record<string, unknown>,
  invalidRaw: RawParams | undefined,
): Record<string, unknown> {
  if (!invalidRaw) return params
  const result = { ...params }
  for (const [key, value] of Object.entries(invalidRaw)) {
    if (result[key] === undefined) result[key] = value
  }
  return result
}

const parseName = (value: unknown): string | undefined =>
  typeof value === 'string' && NAME_PATTERN.test(value) ? value : undefined

const parseWave = (value: unknown): Wave | undefined => (isWave(value) ? value : undefined)

const parseStat = (value: unknown): Stat | undefined => (isStat(value) ? value : undefined)

const parseEnum =
  <T extends string>(...allowed: T[]) =>
  (value: unknown): T | undefined =>
    typeof value === 'string' && (allowed as string[]).includes(value) ? (value as T) : undefined

const parseTrue = (value: unknown): boolean | undefined =>
  value === true || value === 'true' ? true : undefined

const parseIntCode = (value: unknown): number | undefined => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}

/** `countries=1,22` (or repeated) → sorted unique positive ints. Takes
 * the raw value itself (string or array), never the raw object. */
function parseCountries(value: unknown): number[] | undefined {
  const values = value === undefined ? [] : Array.isArray(value) ? value : [value]
  const pieces = values.flatMap((entry) =>
    String(entry)
      .split(',')
      .map((piece) => piece.trim())
      .filter(Boolean),
  )
  const codes = pieces.map(Number)
  if (codes.some((code) => !Number.isInteger(code) || code <= 0)) return undefined
  return [...new Set(codes)].sort((a, b) => a - b)
}

// --- Atlas -----------------------------------------------------------------

export interface AtlasSearch {
  outcome: string
  /** Topic (catalog family) mid-selection; absent = the outcome's own
   * family, so a shared link that names only the measure infers it. */
  topic?: string
  wave: Wave
  /** Absent = the variable's server-declared default_stat. */
  stat?: Stat
  sort: 'estimate' | 'name'
  /** Absent = the sort's own default (values high-first, names A→Z). */
  dir?: SortDir
  countries: number[]
  /** Categorical outcomes: which answer level is ranked/mapped. */
  level?: number
  invalid?: string[]
  invalidRaw?: RawParams
}

export const ATLAS_DEFAULTS = {
  outcome: 'sfi',
  wave: 'Y1' as Wave,
  sort: 'estimate' as const,
  countries: [] as number[],
}

export function parseAtlasSearch(raw: Raw): AtlasSearch {
  const collect = new Collector()
  // Optional keys are set explicitly (undefined when absent or invalid):
  // the router merges re-parsed state over the raw input, and only a
  // present-but-undefined key overrides a rejected raw value there.
  const search: AtlasSearch = {
    outcome: collect.take('outcome', raw, parseName, ATLAS_DEFAULTS.outcome),
    wave: collect.take('wave', raw, parseWave, ATLAS_DEFAULTS.wave),
    sort: collect.take('sort', raw, parseEnum('estimate', 'name'), ATLAS_DEFAULTS.sort),
    dir: collect.take('dir', raw, parseEnum('asc', 'desc'), undefined),
    countries: collect.take('countries', raw, parseCountries, ATLAS_DEFAULTS.countries, true),
    topic: collect.take('topic', raw, parseName, undefined),
    stat: collect.take('stat', raw, parseStat, undefined),
    level: collect.take('level', raw, parseIntCode, undefined),
  }
  return collect.finish(search)
}

/** Only the non-default params — what a shared URL should contain. */
export function atlasSearchParams(search: Partial<AtlasSearch>): Record<string, unknown> {
  return withInvalidRaw(
    {
      outcome: search.outcome === ATLAS_DEFAULTS.outcome ? undefined : search.outcome,
      topic: search.topic,
      wave: search.wave === ATLAS_DEFAULTS.wave ? undefined : search.wave,
      stat: search.stat,
      sort: search.sort === ATLAS_DEFAULTS.sort ? undefined : search.sort,
      dir: search.dir === defaultDir(search.sort ?? ATLAS_DEFAULTS.sort) ? undefined : search.dir,
      countries: search.countries?.length ? search.countries.join(',') : undefined,
      level: search.level,
    },
    search.invalidRaw,
  )
}

/** The /v1 query this view makes (country selection filters client-side). */
export function atlasRequest(
  search: AtlasSearch,
  variable: VariableSummary | undefined,
): AggregateRequest {
  return {
    outcome: search.outcome,
    wave: search.wave,
    stat: search.stat ?? (variable?.default_stat as Stat | undefined) ?? 'mean',
    by: ['country_code'],
  }
}

// --- Breakdowns (shown as Segments, /segments) ----------------------------

export interface BreakdownsSearch {
  outcome: string
  /** Topic (catalog family) mid-selection; see AtlasSearch.topic. */
  topic?: string
  wave: Wave
  /** 1–2 extra dimensions beyond country (demographics, or one survey variable). */
  by: string[]
  sort: 'estimate' | 'name' | 'gap'
  /** Absent = the sort's own default (values/gaps high-first, names A→Z). */
  dir?: SortDir
  countries: number[]
  /** Categorical outcomes: which answer level the cells show. */
  level?: number
  invalid?: string[]
  invalidRaw?: RawParams
}

export const BREAKDOWNS_DEFAULTS = {
  outcome: 'sfi',
  wave: 'Y1' as Wave,
  by: ['age_band'],
  sort: 'estimate' as const,
  countries: [] as number[],
}

function parseBy(raw: Raw): string[] | undefined {
  const values = all(raw, 'by').map(String)
  if (values.length === 0 || values.length > 2) return undefined
  if (!values.every((value) => NAME_PATTERN.test(value) && value !== 'country_code'))
    return undefined
  if (new Set(values).size !== values.length) return undefined
  return values
}

export function parseBreakdownsSearch(raw: Raw): BreakdownsSearch {
  const collect = new Collector()
  const search: BreakdownsSearch = {
    outcome: collect.take('outcome', raw, parseName, BREAKDOWNS_DEFAULTS.outcome),
    wave: collect.take('wave', raw, parseWave, BREAKDOWNS_DEFAULTS.wave),
    by: collect.take('by', raw, () => parseBy(raw), BREAKDOWNS_DEFAULTS.by),
    sort: collect.take('sort', raw, parseEnum('estimate', 'name', 'gap'), BREAKDOWNS_DEFAULTS.sort),
    dir: collect.take('dir', raw, parseEnum('asc', 'desc'), undefined),
    countries: collect.take('countries', raw, parseCountries, BREAKDOWNS_DEFAULTS.countries, true),
    topic: collect.take('topic', raw, parseName, undefined),
    level: collect.take('level', raw, parseIntCode, undefined),
  }
  return collect.finish(search)
}

export function breakdownsSearchParams(search: Partial<BreakdownsSearch>): Record<string, unknown> {
  const byIsDefault =
    search.by === undefined ||
    (search.by.length === BREAKDOWNS_DEFAULTS.by.length &&
      search.by.every((value, index) => value === BREAKDOWNS_DEFAULTS.by[index]))
  return withInvalidRaw(
    {
      outcome: search.outcome === BREAKDOWNS_DEFAULTS.outcome ? undefined : search.outcome,
      topic: search.topic,
      wave: search.wave === BREAKDOWNS_DEFAULTS.wave ? undefined : search.wave,
      by: byIsDefault ? undefined : search.by,
      sort: search.sort === BREAKDOWNS_DEFAULTS.sort ? undefined : search.sort,
      dir:
        search.dir === defaultDir(search.sort ?? BREAKDOWNS_DEFAULTS.sort) ? undefined : search.dir,
      countries: search.countries?.length ? search.countries.join(',') : undefined,
      level: search.level,
    },
    search.invalidRaw,
  )
}

export function breakdownsRequest(
  search: BreakdownsSearch,
  variable: VariableSummary | undefined,
): AggregateRequest {
  return {
    outcome: search.outcome,
    wave: search.wave,
    stat: (variable?.default_stat as Stat | undefined) ?? 'mean',
    by: ['country_code', ...search.by],
  }
}

/** The retired Compare page's links (ADR-0017): what carries over to
 * Segments — the outcome and the wave, each only when valid. Every
 * other param is dropped here, so the landing page shows no notice. */
export function compareRedirectSearch(
  raw: Raw,
): Partial<Pick<BreakdownsSearch, 'outcome' | 'wave'>> {
  const outcome = parseName(first(raw, 'outcome'))
  const wave = parseWave(first(raw, 'wave'))
  return {
    ...(outcome !== undefined ? { outcome } : {}),
    ...(wave !== undefined ? { wave } : {}),
  }
}

// --- Codebook --------------------------------------------------------------

export interface CodebookSearch {
  q: string
  family?: string
  wave?: Wave
  scale?: string
  invalid?: string[]
  invalidRaw?: RawParams
}

export function parseCodebookSearch(raw: Raw): CodebookSearch {
  const collect = new Collector()
  const search: CodebookSearch = {
    q: collect.take(
      'q',
      raw,
      (value) => (typeof value === 'string' ? value.slice(0, 200) : undefined),
      '',
    ),
    family: collect.take('family', raw, parseName, undefined),
    wave: collect.take('wave', raw, parseWave, undefined),
    scale: collect.take('scale', raw, parseName, undefined),
  }
  return collect.finish(search)
}

export function codebookSearchParams(search: Partial<CodebookSearch>): Record<string, unknown> {
  return withInvalidRaw(
    {
      q: search.q || undefined,
      family: search.family,
      wave: search.wave,
      scale: search.scale,
    },
    search.invalidRaw,
  )
}

// --- Change (Phase 5) --------------------------------------------------------
// `from`/`to`/`via` carry the API's own names. The default pair is
// 2023 → 2024; `via=MY` asks for the three-point panel. Bad or
// non-chronological waves degrade to the default pair with a notice.

export interface ChangeSearch {
  outcome: string
  topic?: string
  from: Wave
  to: Wave
  via?: 'MY'
  sort: 'change' | 'name'
  /** Absent = the sort's own default (changes high-first, names A→Z). */
  dir?: SortDir
  countries: number[]
  /** Categorical items: which answer level's share change is charted. */
  level?: number
  invalid?: string[]
  invalidRaw?: RawParams
}

export const CHANGE_DEFAULTS = {
  outcome: 'sfi',
  from: 'Y1' as Wave,
  to: 'Y2' as Wave,
  sort: 'change' as const,
  countries: [] as number[],
}

export function parseChangeSearch(raw: Raw): ChangeSearch {
  const collect = new Collector()
  // Contextual parsers: a rejection must be reproducible from the raw
  // value alone on the router's own re-parse (see Collector), so the
  // chronology and the via placement live inside the parsers, not in a
  // check after them.
  const parseEarlier = (value: unknown): Wave | undefined => {
    const wave = parseWave(value)
    return wave !== undefined && wave !== WAVES[WAVES.length - 1] ? wave : undefined
  }
  const from = collect.take('from', raw, parseEarlier, CHANGE_DEFAULTS.from)
  const parseLater = (value: unknown): Wave | undefined => {
    const wave = parseWave(value)
    return wave !== undefined && WAVES.indexOf(wave) > WAVES.indexOf(from) ? wave : undefined
  }
  const to = collect.take('to', raw, parseLater, CHANGE_DEFAULTS.to)
  const parseVia = (value: unknown): 'MY' | undefined =>
    value === 'MY' && from === 'Y1' && to === 'Y2' ? 'MY' : undefined
  const search: ChangeSearch = {
    outcome: collect.take('outcome', raw, parseName, CHANGE_DEFAULTS.outcome),
    topic: collect.take('topic', raw, parseName, undefined),
    from,
    to,
    via: collect.take('via', raw, parseVia, undefined),
    sort: collect.take('sort', raw, parseEnum('change', 'name'), CHANGE_DEFAULTS.sort),
    dir: collect.take('dir', raw, parseEnum('asc', 'desc'), undefined),
    countries: collect.take('countries', raw, parseCountries, CHANGE_DEFAULTS.countries, true),
    level: collect.take('level', raw, parseIntCode, undefined),
  }
  return collect.finish(search)
}

export function changeSearchParams(search: Partial<ChangeSearch>): Record<string, unknown> {
  return withInvalidRaw(
    {
      outcome: search.outcome === CHANGE_DEFAULTS.outcome ? undefined : search.outcome,
      topic: search.topic,
      from: search.from === CHANGE_DEFAULTS.from ? undefined : search.from,
      to: search.to === CHANGE_DEFAULTS.to ? undefined : search.to,
      via: search.via,
      sort: search.sort === CHANGE_DEFAULTS.sort ? undefined : search.sort,
      dir:
        search.dir === defaultDir(search.sort === 'name' ? 'name' : 'estimate')
          ? undefined
          : search.dir,
      countries: search.countries?.length ? search.countries.join(',') : undefined,
      level: search.level,
    },
    search.invalidRaw,
  )
}

/** The /v1/change query this view makes (country selection filters client-side). */
export function changeRequest(search: ChangeSearch): ChangeRequest {
  return {
    outcome: search.outcome,
    from: search.from,
    to: search.to,
    via: search.via,
    by: ['country_code'],
  }
}

// --- What Matters (Phase 5) --------------------------------------------------
// The midyear family at wave MY: rankings by country, the shift by a
// demographic (age band by default) within one country, and the
// chartable items — one of the three on screen at a time (`view`).

export interface WhatMattersSearch {
  /** Which chart is on screen: the matrix by country, the split within
   * one country, or one of the other midyear questions. */
  view: 'country' | 'within' | 'questions'
  /** The country whose ranking is split by `by`; absent = the United
   * States (else the first country A–Z), resolved from meta. */
  country?: number
  by: string
  /** A chartable (non-ranking) midyear item to show by country. */
  item?: string
  /** Categorical items: which answer level the item chart shows. */
  level?: number
  /** Country order of the matrix: 'name' (A–Z) or one importance item's
   * code (by that item's value); an unknown code reads as 'name'. */
  sort: string
  dir?: SortDir
  /** The other questions' chart has its own order, Atlas's controls and
   * defaults (by value, high first) — never the matrix's. */
  qsort: 'estimate' | 'name'
  qdir?: SortDir
  invalid?: string[]
  invalidRaw?: RawParams
}

export const WHAT_MATTERS_DEFAULTS = {
  view: 'country' as const,
  by: 'age_band',
  sort: 'name',
  qsort: 'estimate' as const,
}

const parseBreakdownColumn = (value: unknown): string | undefined => {
  const name = parseName(value)
  return name !== undefined && name !== 'country_code' ? name : undefined
}

const parseCountryCode = (value: unknown): number | undefined => {
  const code = Number(value)
  return Number.isInteger(code) && code > 0 ? code : undefined
}

export function parseWhatMattersSearch(raw: Raw): WhatMattersSearch {
  const collect = new Collector()
  const search: WhatMattersSearch = {
    view: collect.take(
      'view',
      raw,
      parseEnum('country', 'within', 'questions'),
      WHAT_MATTERS_DEFAULTS.view,
    ),
    country: collect.take('country', raw, parseCountryCode, undefined),
    by: collect.take('by', raw, parseBreakdownColumn, WHAT_MATTERS_DEFAULTS.by),
    item: collect.take('item', raw, parseName, undefined),
    level: collect.take('level', raw, parseIntCode, undefined),
    sort: collect.take('sort', raw, parseName, WHAT_MATTERS_DEFAULTS.sort),
    dir: collect.take('dir', raw, parseEnum('asc', 'desc'), undefined),
    qsort: collect.take('qsort', raw, parseEnum('estimate', 'name'), WHAT_MATTERS_DEFAULTS.qsort),
    qdir: collect.take('qdir', raw, parseEnum('asc', 'desc'), undefined),
  }
  return collect.finish(search)
}

export function whatMattersSearchParams(
  search: Partial<WhatMattersSearch>,
): Record<string, unknown> {
  return withInvalidRaw(
    {
      view: search.view === WHAT_MATTERS_DEFAULTS.view ? undefined : search.view,
      country: search.country,
      by: search.by === WHAT_MATTERS_DEFAULTS.by ? undefined : search.by,
      item: search.item,
      level: search.level,
      sort: search.sort === WHAT_MATTERS_DEFAULTS.sort ? undefined : search.sort,
      dir:
        search.dir === defaultDir(search.sort ?? WHAT_MATTERS_DEFAULTS.sort)
          ? undefined
          : search.dir,
      qsort: search.qsort === WHAT_MATTERS_DEFAULTS.qsort ? undefined : search.qsort,
      qdir:
        search.qdir === defaultDir(search.qsort ?? WHAT_MATTERS_DEFAULTS.qsort)
          ? undefined
          : search.qdir,
    },
    search.invalidRaw,
  )
}

/** The midyear cross-section for one item, by country (and optionally a split). */
export function whatMattersRequest(
  item: string,
  variable: VariableSummary | undefined,
  by?: string,
): AggregateRequest {
  return {
    outcome: item,
    wave: 'MY',
    stat: (variable?.default_stat as Stat | undefined) ?? 'mean',
    by: by ? ['country_code', by] : ['country_code'],
  }
}

// --- US States (Phase 5) -----------------------------------------------------

export interface StatesSearch {
  outcome: string
  topic?: string
  wave: Wave
  stat?: Stat
  /** The adjusted state-weight variants (never on Wave 1). */
  adj?: boolean
  view: 'map' | 'bars'
  sort: 'estimate' | 'name'
  dir?: SortDir
  level?: number
  invalid?: string[]
  invalidRaw?: RawParams
}

export const STATES_DEFAULTS = {
  outcome: 'sfi',
  wave: 'Y1' as Wave,
  view: 'map' as const,
  sort: 'estimate' as const,
}

export function parseStatesSearch(raw: Raw): StatesSearch {
  const collect = new Collector()
  const wave = collect.take('wave', raw, parseWave, STATES_DEFAULTS.wave)
  // The release has no adjusted Wave 1 weight: the control is unavailable
  // there, so the param is rejected (reproducibly — see Collector) rather
  // than sent to the API to fail.
  const parseAdj = (value: unknown): boolean | undefined =>
    parseTrue(value) && adjustedWeightsExist(wave) ? true : undefined
  const search: StatesSearch = {
    outcome: collect.take('outcome', raw, parseName, STATES_DEFAULTS.outcome),
    topic: collect.take('topic', raw, parseName, undefined),
    wave,
    stat: collect.take('stat', raw, parseStat, undefined),
    adj: collect.take('adj', raw, parseAdj, undefined),
    view: collect.take('view', raw, parseEnum('map', 'bars'), STATES_DEFAULTS.view),
    sort: collect.take('sort', raw, parseEnum('estimate', 'name'), STATES_DEFAULTS.sort),
    dir: collect.take('dir', raw, parseEnum('asc', 'desc'), undefined),
    level: collect.take('level', raw, parseIntCode, undefined),
  }
  return collect.finish(search)
}

export function statesSearchParams(search: Partial<StatesSearch>): Record<string, unknown> {
  return withInvalidRaw(
    {
      outcome: search.outcome === STATES_DEFAULTS.outcome ? undefined : search.outcome,
      topic: search.topic,
      wave: search.wave === STATES_DEFAULTS.wave ? undefined : search.wave,
      stat: search.stat,
      adj: search.adj ? true : undefined,
      view: search.view === STATES_DEFAULTS.view ? undefined : search.view,
      sort: search.sort === STATES_DEFAULTS.sort ? undefined : search.sort,
      dir: search.dir === defaultDir(search.sort ?? STATES_DEFAULTS.sort) ? undefined : search.dir,
      level: search.level,
    },
    search.invalidRaw,
  )
}

export function statesRequest(
  search: StatesSearch,
  variable: VariableSummary | undefined,
): StatesRequest {
  return {
    outcome: search.outcome,
    wave: search.wave,
    stat: search.stat ?? (variable?.default_stat as Stat | undefined) ?? 'mean',
    adj: search.adj,
  }
}

// --- Correlates (Phase 6) ----------------------------------------------------
// What travels with an outcome: the ranked list for one country, and the
// same items across every country — one of them on screen at a time
// (`view`, owner decision 25 Sept 2026). `method=spearman` asks for rank
// correlations. The country is absent when it is the catalog's first —
// the view resolves that from meta, so the URL never carries it. The
// adjusted models left the page (ADR-0018): an old link's `adjusted` is
// reported like any other invalid param, and never sent.

/** Which chart the Correlates page shows: the ranked list for one
 * country, its measures across every country, the measure beside one
 * other question (`x`), or a table of several (`vars`). */
export type CorrelatesViewName = 'ranked' | 'countries' | 'pair' | 'matrix'

/** A correlation table holds 2 to 10 questions. */
export const TABLE_MIN = 2
export const TABLE_MAX = 10

export interface CorrelatesSearch {
  outcome: string
  topic?: string
  wave: Wave
  /** The country whose ranked list is shown; absent = the catalog's first. */
  country?: number
  view: CorrelatesViewName
  /** Compare two: the question set beside the measure; absent = the
   * measure's top-ranked correlate in the country (the view resolves it
   * from the ranked list, so the URL never carries a default). */
  x?: string
  /** Compare several: the table's questions, in order; absent = the
   * measure and its top five correlates in the country. */
  vars?: string[]
  /** Rank correlation instead of Pearson. */
  method?: 'spearman'
  invalid?: string[]
  invalidRaw?: RawParams
}

export const CORRELATES_DEFAULTS = {
  outcome: 'sfi',
  wave: 'Y1' as Wave,
  view: 'ranked' as CorrelatesViewName,
}

/** `vars=A,B,C` (or repeated) → 2–10 distinct names, in order. Takes
 * the raw value itself (string or array), never the raw object. */
function parseTableVars(value: unknown): string[] | undefined {
  const values = value === undefined ? [] : Array.isArray(value) ? value : [value]
  const names = values.flatMap((entry) =>
    String(entry)
      .split(',')
      .map((piece) => piece.trim())
      .filter(Boolean),
  )
  if (names.length < TABLE_MIN || names.length > TABLE_MAX) return undefined
  if (new Set(names).size !== names.length) return undefined
  return names.every((name) => NAME_PATTERN.test(name)) ? names : undefined
}

/** A param the page no longer offers: present at all, it is reported. */
const parseRetired = (): undefined => undefined

export function parseCorrelatesSearch(raw: Raw): CorrelatesSearch {
  const collect = new Collector()
  const search: CorrelatesSearch = {
    outcome: collect.take('outcome', raw, parseName, CORRELATES_DEFAULTS.outcome),
    topic: collect.take('topic', raw, parseName, undefined),
    wave: collect.take('wave', raw, parseWave, CORRELATES_DEFAULTS.wave),
    country: collect.take('country', raw, parseCountryCode, undefined),
    view: collect.take(
      'view',
      raw,
      parseEnum<CorrelatesViewName>('ranked', 'countries', 'pair', 'matrix'),
      CORRELATES_DEFAULTS.view,
    ),
    x: collect.take('x', raw, parseName, undefined),
    vars: collect.take('vars', raw, parseTableVars, undefined, true),
    method: collect.take('method', raw, parseEnum('spearman'), undefined),
  }
  // The adjusted models are no longer offered (ADR-0018).
  collect.take('adjusted', raw, parseRetired, undefined)
  return collect.finish(search)
}

export function correlatesSearchParams(search: Partial<CorrelatesSearch>): Record<string, unknown> {
  return withInvalidRaw(
    {
      outcome: search.outcome === CORRELATES_DEFAULTS.outcome ? undefined : search.outcome,
      topic: search.topic,
      wave: search.wave === CORRELATES_DEFAULTS.wave ? undefined : search.wave,
      country: search.country,
      view: search.view === CORRELATES_DEFAULTS.view ? undefined : search.view,
      x: search.x,
      vars: search.vars?.length ? search.vars.join(',') : undefined,
      method: search.method,
    },
    search.invalidRaw,
  )
}

/** The ranked list for one country: the server sweeps, ranks and cuts. */
export function correlatesRequest(search: CorrelatesSearch, country: number): CorrelatesRequest {
  return {
    outcome: search.outcome,
    wave: search.wave,
    by: [],
    countries: [country],
    method: search.method,
  }
}

/** Compare two: the measure (y) beside one question (x) in one country. */
export function pairRequest(search: CorrelatesSearch, x: string, country: number): PairRequest {
  return {
    y: search.outcome,
    x,
    wave: search.wave,
    country,
    method: search.method,
  }
}

/** Compare several: the table's questions in one country. */
export function tableRequest(
  search: CorrelatesSearch,
  vars: readonly string[],
  country: number,
): TableRequest {
  return { vars, wave: search.wave, country, method: search.method }
}

/** The ranked list's own items, across every country. */
export function correlatesAcrossCountries(
  search: CorrelatesSearch,
  predictors: readonly string[],
): CorrelatesRequest {
  return {
    outcome: search.outcome,
    wave: search.wave,
    against: predictors,
    by: ['country_code'],
    method: search.method,
  }
}
