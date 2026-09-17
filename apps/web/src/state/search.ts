// Typed URL state: the URL *is* the state (proposal §4.4). Query params
// carry the API's own names (outcome, wave, stat, by, oriented); view-only
// params (view, sort, countries) are separate. Defaults are omitted from
// the URL; invalid values degrade to defaults and are reported through the
// `invalid` key, which renders as a notice and is recomputed on every
// parse — it can never be forged into or trapped in a shared URL.

import type { AggregateRequest } from '../api/estimates'
import type { Stat, VariableSummary, Wave } from '../api/types'
import { isStat, isWave } from '../api/types'
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

class Collector {
  readonly dropped: string[] = []

  take<T>(key: string, raw: Raw, parse: (value: unknown) => T | undefined, fallback: T): T {
    const value = first(raw, key)
    if (value === undefined) return fallback
    const parsed = parse(value)
    if (parsed === undefined) {
      this.dropped.push(key)
      return fallback
    }
    return parsed
  }

  finish<T extends object>(search: T): T & { invalid?: string[] } {
    return this.dropped.length ? { ...search, invalid: this.dropped } : search
  }
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
  wave: Wave
  /** Absent = the variable's server-declared default_stat. */
  stat?: Stat
  view: 'bars' | 'map'
  sort: 'estimate' | 'name'
  countries: number[]
  /** Categorical outcomes: which answer level is ranked/mapped. */
  level?: number
  oriented?: boolean
  invalid?: string[]
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
  const search: AtlasSearch = {
    outcome: collect.take('outcome', raw, parseName, ATLAS_DEFAULTS.outcome),
    wave: collect.take('wave', raw, parseWave, ATLAS_DEFAULTS.wave),
    view: collect.take('view', raw, parseEnum('bars', 'map'), ATLAS_DEFAULTS.view),
    sort: collect.take('sort', raw, parseEnum('estimate', 'name'), ATLAS_DEFAULTS.sort),
    countries: collect.take('countries', raw, () => parseCountries(raw), ATLAS_DEFAULTS.countries),
  }
  const stat = collect.take('stat', raw, parseStat, undefined)
  if (stat !== undefined) search.stat = stat
  const level = collect.take('level', raw, parseIntCode, undefined)
  if (level !== undefined) search.level = level
  if (collect.take('oriented', raw, parseTrue, undefined)) search.oriented = true
  return collect.finish(search)
}

/** Only the non-default params — what a shared URL should contain. */
export function atlasSearchParams(search: Partial<AtlasSearch>): Record<string, unknown> {
  return {
    outcome: search.outcome === ATLAS_DEFAULTS.outcome ? undefined : search.outcome,
    wave: search.wave === ATLAS_DEFAULTS.wave ? undefined : search.wave,
    stat: search.stat,
    view: search.view === ATLAS_DEFAULTS.view ? undefined : search.view,
    sort: search.sort === ATLAS_DEFAULTS.sort ? undefined : search.sort,
    countries: search.countries?.length ? search.countries.join(',') : undefined,
    level: search.level,
    oriented: search.oriented ? true : undefined,
    invalid: search.invalid?.length ? search.invalid : undefined,
  }
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
  wave: Wave
  /** 1–2 extra dimensions beyond country (demographics, or one survey variable). */
  by: string[]
  sort: 'estimate' | 'name' | 'gap'
  countries: number[]
  /** Categorical outcomes: which answer level the cells show. */
  level?: number
  invalid?: string[]
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
    countries: collect.take(
      'countries',
      raw,
      () => parseCountries(raw),
      BREAKDOWNS_DEFAULTS.countries,
    ),
  }
  const level = collect.take('level', raw, parseIntCode, undefined)
  if (level !== undefined) search.level = level
  return collect.finish(search)
}

export function breakdownsSearchParams(search: Partial<BreakdownsSearch>): Record<string, unknown> {
  const byIsDefault =
    search.by === undefined ||
    (search.by.length === BREAKDOWNS_DEFAULTS.by.length &&
      search.by.every((value, index) => value === BREAKDOWNS_DEFAULTS.by[index]))
  return {
    outcome: search.outcome === BREAKDOWNS_DEFAULTS.outcome ? undefined : search.outcome,
    wave: search.wave === BREAKDOWNS_DEFAULTS.wave ? undefined : search.wave,
    by: byIsDefault ? undefined : search.by,
    sort: search.sort === BREAKDOWNS_DEFAULTS.sort ? undefined : search.sort,
    countries: search.countries?.length ? search.countries.join(',') : undefined,
    level: search.level,
    invalid: search.invalid?.length ? search.invalid : undefined,
  }
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
  }
  const family = collect.take('family', raw, parseName, undefined)
  if (family !== undefined) search.family = family
  const wave = collect.take('wave', raw, parseWave, undefined)
  if (wave !== undefined) search.wave = wave
  const scale = collect.take('scale', raw, parseName, undefined)
  if (scale !== undefined) search.scale = scale
  return collect.finish(search)
}

export function codebookSearchParams(search: Partial<CodebookSearch>): Record<string, unknown> {
  return {
    q: search.q || undefined,
    family: search.family,
    wave: search.wave,
    scale: search.scale,
    invalid: search.invalid?.length ? search.invalid : undefined,
  }
}
