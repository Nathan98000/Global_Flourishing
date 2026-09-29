// Typed URL state: the URL *is* the state (proposal §4.4). Query params
// carry the API's own names (outcome, wave, stat, by); view-only
// params (sort, countries) are separate. Defaults are omitted from
// the URL; invalid values degrade to defaults and are reported through the
// `invalid` key, which renders as a notice and is recomputed on every
// parse — it can never be forged into or trapped in a shared URL.

import type { ChangeRequest } from '../api/change'
import type { CorrelatesRequest, CountryScope } from '../api/correlates'
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

// --- Correlates (Phase 6; organized by task, ADR-0019) ----------------------
// Three views, one on screen at a time (`view`): Compare two (`a` on the
// columns beside `b` on the rows — the default view), Compare several (a
// table of `vars`) and Find related (what goes with `outcome`, in one
// country or, `scope=all`, in every country). Each view's first question
// seeds the next: Compare two's `a` and Find related's `outcome` are one
// question under two names, so a parse folds the other view's name into
// the one on screen. `method=spearman` asks for rank correlations. The
// country is absent when it is the default — the view resolves that from
// meta. Old links still land: `view=ranked` is Find related,
// `view=countries` Find related in every country, and an old
// `view=pair` link's `x` and `outcome` become `a` and `b`. The adjusted
// models left the page (ADR-0018): an old link's `adjusted` is reported
// like any other invalid param, and never sent.

/** Which chart the Correlates page shows: two questions side by side, a
 * table of several, or what goes with one. */
export type CorrelatesViewName = 'pair' | 'matrix' | 'related'

/** Find related: the chosen country, or every country. */
export type CorrelatesScope = 'country' | 'all'

/** Compare several's order: as the questions were added, or with the
 * ones that go together side by side (the server's `similar_order`). */
export type CorrelatesOrder = 'added' | 'similar'

/** A correlation table holds 2 to 10 questions. */
export const TABLE_MIN = 2
export const TABLE_MAX = 10

export interface CorrelatesSearch {
  view: CorrelatesViewName
  /** Compare two's first question (the columns); absent = Find related's
   * question, else the default pair's first. */
  a?: string
  /** Compare two's second question (the rows); absent = the default
   * pair's second (its first, when that is `a`). */
  b?: string
  /** Find related's question; absent = Compare two's first. */
  outcome?: string
  /** Find related: in the chosen country, or in every country. */
  scope: CorrelatesScope
  /** Compare several: the table's questions, in order; absent = the pair
   * and the first question's top four correlates. */
  vars?: string[]
  /** Compare several: as added, or similar together. */
  order: CorrelatesOrder
  wave: Wave
  /** The country every view is taken in — or `all`, the average of every
   * country (ADR-0020); absent = the default one. */
  country?: CountryScope
  /** Rank correlation instead of Pearson. */
  method?: 'spearman'
  /** At Midyear: the wave the other questions' answers come from, the
   * same people's (ADR-0020); absent = 2023. */
  other?: 'Y1' | 'Y2'
  invalid?: string[]
  invalidRaw?: RawParams
}

export const CORRELATES_DEFAULTS = {
  view: 'pair' as CorrelatesViewName,
  scope: 'country' as CorrelatesScope,
  order: 'added' as CorrelatesOrder,
  wave: 'Y1' as Wave,
}

/** The pair a first visit shows (owner decision, 28 Sept 2026). */
export const DEFAULT_PAIR = { a: 'WB_TODAY', b: 'INCOME_FEELINGS' } as const

type Questions = Partial<Pick<CorrelatesSearch, 'a' | 'b' | 'outcome'>>

/** Compare two's first question: its own, else Find related's, else the
 * default pair's. */
export function firstQuestion(search: Questions): string {
  return search.a ?? search.outcome ?? DEFAULT_PAIR.a
}

/** The second question a first question gets by default: the default
 * pair's second — its first, when the first is that. */
function defaultSecond(first: string): string {
  return first === DEFAULT_PAIR.b ? DEFAULT_PAIR.a : DEFAULT_PAIR.b
}

/** Compare two's second question: its own, else the default. */
export function secondQuestion(search: Questions): string {
  return search.b ?? defaultSecond(firstQuestion(search))
}

/** Find related's question: its own, else Compare two's first. */
export function relatedQuestion(search: Questions): string {
  return search.outcome ?? search.a ?? DEFAULT_PAIR.a
}

/** The patch that puts a view on screen, carrying its first question
 * across under the name that view uses. */
export function viewPatch(search: Questions, view: CorrelatesViewName): Partial<CorrelatesSearch> {
  if (view === 'pair') return { view, a: search.a ?? search.outcome, outcome: undefined }
  if (view === 'related') return { view, outcome: search.outcome ?? search.a, a: undefined }
  return { view }
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

/** The view, old names included: the ranked list and the matrix across
 * countries are both Find related now. */
const parseCorrelatesView = (value: unknown): CorrelatesViewName | undefined =>
  value === 'ranked' || value === 'countries'
    ? 'related'
    : parseEnum<CorrelatesViewName>('pair', 'matrix', 'related')(value)

/** A param the page no longer offers: present at all, it is reported. */
const parseRetired = (): undefined => undefined

/** `country=all` (every country, pooled) or a country's code. */
const parseCountryScope = (value: unknown): CountryScope | undefined =>
  value === 'all' ? 'all' : parseCountryCode(value)

export function parseCorrelatesSearch(raw: Raw): CorrelatesSearch {
  const collect = new Collector()
  const named = first(raw, 'view')
  const view = collect.take('view', raw, parseCorrelatesView, CORRELATES_DEFAULTS.view)
  const scope = collect.take(
    'scope',
    raw,
    parseEnum<CorrelatesScope>('country', 'all'),
    named === 'countries' ? 'all' : CORRELATES_DEFAULTS.scope,
  )
  let a = collect.take('a', raw, parseName, undefined)
  let b = collect.take('b', raw, parseName, undefined)
  let outcome = collect.take('outcome', raw, parseName, undefined)
  // One first question, named for the view on screen (see above).
  if (view === 'pair') {
    if (named === 'pair') {
      // An old Compare two link: the compared question was on x, the
      // measure on y — now the columns and the rows.
      a = a ?? collect.take('x', raw, parseName, undefined)
      b = b ?? outcome
    } else {
      a = a ?? outcome
    }
    outcome = undefined
  } else if (view === 'related') {
    outcome = outcome ?? a
    a = undefined
  }
  const search: CorrelatesSearch = {
    view,
    a,
    b,
    outcome,
    scope,
    vars: collect.take('vars', raw, parseTableVars, undefined, true),
    order: collect.take(
      'order',
      raw,
      parseEnum<CorrelatesOrder>('added', 'similar'),
      CORRELATES_DEFAULTS.order,
    ),
    wave: collect.take('wave', raw, parseWave, CORRELATES_DEFAULTS.wave),
    country: collect.take('country', raw, parseCountryScope, undefined),
    method: collect.take('method', raw, parseEnum('spearman'), undefined),
    other: collect.take('other', raw, parseEnum<'Y1' | 'Y2'>('Y1', 'Y2'), undefined),
  }
  // The adjusted models are no longer offered (ADR-0018).
  collect.take('adjusted', raw, parseRetired, undefined)
  return collect.finish(search)
}

export function correlatesSearchParams(search: Partial<CorrelatesSearch>): Record<string, unknown> {
  // A question equal to its default stays out, when leaving it out
  // resolves to the same question.
  const a = search.a === DEFAULT_PAIR.a && search.outcome === undefined ? undefined : search.a
  const b =
    search.b !== undefined && search.b === defaultSecond(firstQuestion(search))
      ? undefined
      : search.b
  const outcome =
    search.outcome === DEFAULT_PAIR.a && search.a === undefined ? undefined : search.outcome
  return withInvalidRaw(
    {
      view: search.view === CORRELATES_DEFAULTS.view ? undefined : search.view,
      a,
      b,
      outcome,
      scope: search.scope === CORRELATES_DEFAULTS.scope ? undefined : search.scope,
      vars: search.vars?.length ? search.vars.join(',') : undefined,
      order: search.order === CORRELATES_DEFAULTS.order ? undefined : search.order,
      wave: search.wave === CORRELATES_DEFAULTS.wave ? undefined : search.wave,
      country: search.country,
      method: search.method,
      other: search.other === 'Y2' ? 'Y2' : undefined,
    },
    search.invalidRaw,
  )
}

/** A ranked list for one question in one country — or the average of
 * every country: the server sweeps, averages, ranks and cuts. */
export function correlatesRequest(
  search: Pick<CorrelatesSearch, 'wave' | 'method'>,
  outcome: string,
  country: CountryScope,
  against?: readonly string[],
  otherWave?: 'Y1' | 'Y2',
): CorrelatesRequest {
  return {
    outcome,
    wave: search.wave,
    ...(against ? { against } : {}),
    by: [],
    ...(country === 'all' ? { pooled: true } : { countries: [country] }),
    method: search.method,
    ...(otherWave ? { otherWave } : {}),
  }
}

/** Compare two: the second question (rows, the API's `y`) beside the
 * first (columns, its `x`) in one country. */
export function pairRequest(
  search: Pick<CorrelatesSearch, 'wave' | 'method'>,
  pair: { a: string; b: string },
  country: CountryScope,
  otherWave?: 'Y1' | 'Y2',
): PairRequest {
  return {
    y: pair.b,
    x: pair.a,
    wave: search.wave,
    country,
    method: search.method,
    ...(otherWave ? { otherWave } : {}),
  }
}

/** Compare several: the table's questions in one country. */
export function tableRequest(
  search: Pick<CorrelatesSearch, 'wave' | 'method'>,
  vars: readonly string[],
  country: CountryScope,
  otherWave?: 'Y1' | 'Y2',
): TableRequest {
  return {
    vars,
    wave: search.wave,
    country,
    method: search.method,
    ...(otherWave ? { otherWave } : {}),
  }
}

/** A question's ranked list, across every country. */
export function correlatesAcrossCountries(
  search: Pick<CorrelatesSearch, 'wave' | 'method'>,
  outcome: string,
  predictors: readonly string[],
  otherWave?: 'Y1' | 'Y2',
): CorrelatesRequest {
  return {
    outcome,
    wave: search.wave,
    against: predictors,
    by: ['country_code'],
    method: search.method,
    ...(otherWave ? { otherWave } : {}),
  }
}
