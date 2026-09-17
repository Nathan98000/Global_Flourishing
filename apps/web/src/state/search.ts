// Typed URL state: the URL *is* the state (proposal §4.4). Query params
// carry the API's own names (outcome, wave, stat, by, oriented); view-only
// params (view, sort, countries) are separate. Defaults are omitted from
// the URL; invalid values degrade to defaults and are reported through the
// `invalid` key, which renders as a notice and is recomputed on every
// parse — it can never be forged into or trapped in a shared URL.

import type { AggregateRequest } from '../api/estimates'
import type { Stat, VariableSummary, Wave } from '../api/types'
import { isStat, isWave } from '../api/types'
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

  take<T>(key: string, raw: Raw, parse: (value: unknown) => T | undefined, fallback: T): T {
    const value = first(raw, key)
    let out = fallback
    if (value !== undefined) {
      const parsed = parse(value)
      if (parsed === undefined) this.reject(key, (raw as Record<string, unknown>)[key])
      else out = parsed
    }
    const carried = carriedInvalid(raw)[key]
    if (
      !(key in this.raw) &&
      carried !== undefined &&
      parse(first({ [key]: carried }, key)) === undefined
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

/** `countries=1,22` (or repeated) → sorted unique positive ints. */
function parseCountries(raw: Raw): number[] | undefined {
  const pieces = all(raw, 'countries').flatMap((value) =>
    String(value)
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
  view: 'bars' | 'map'
  sort: 'estimate' | 'name'
  /** Absent = the sort's own default (values high-first, names A→Z). */
  dir?: SortDir
  countries: number[]
  /** Categorical outcomes: which answer level is ranked/mapped. */
  level?: number
  oriented?: boolean
  invalid?: string[]
  invalidRaw?: RawParams
}

export const ATLAS_DEFAULTS = {
  outcome: 'sfi',
  wave: 'Y1' as Wave,
  view: 'bars' as const,
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
    view: collect.take('view', raw, parseEnum('bars', 'map'), ATLAS_DEFAULTS.view),
    sort: collect.take('sort', raw, parseEnum('estimate', 'name'), ATLAS_DEFAULTS.sort),
    dir: collect.take('dir', raw, parseEnum('asc', 'desc'), undefined),
    countries: collect.take('countries', raw, () => parseCountries(raw), ATLAS_DEFAULTS.countries),
    topic: collect.take('topic', raw, parseName, undefined),
    stat: collect.take('stat', raw, parseStat, undefined),
    level: collect.take('level', raw, parseIntCode, undefined),
    oriented: collect.take('oriented', raw, parseTrue, undefined) ? true : undefined,
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
      view: search.view === ATLAS_DEFAULTS.view ? undefined : search.view,
      sort: search.sort === ATLAS_DEFAULTS.sort ? undefined : search.sort,
      dir: search.dir === defaultDir(search.sort ?? ATLAS_DEFAULTS.sort) ? undefined : search.dir,
      countries: search.countries?.length ? search.countries.join(',') : undefined,
      level: search.level,
      oriented: search.oriented ? true : undefined,
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
    oriented: search.oriented,
  }
}

// --- Breakdowns ------------------------------------------------------------

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
    countries: collect.take(
      'countries',
      raw,
      () => parseCountries(raw),
      BREAKDOWNS_DEFAULTS.countries,
    ),
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
