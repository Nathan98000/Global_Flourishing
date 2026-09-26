// The single estimates fetcher (ADR-0009): compute the static path when
// the exporter precomputed this query, fall back to /v1/aggregate on a
// miss or on anything the static tier can't answer (filters, a
// variable-valued breakdown, quantiles, oriented). Both branches parse
// into the same generated EstimateResponse type; the caller learns which
// tier answered. Misses are cached per (data_version, path) so they cost
// one round trip, not one per render.

import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query'
import { API_BASE_URL, STATIC_BASE_URL } from '../config'
import { STATIC_MISS, fetchApiJson, fetchStaticJson } from './http'
import { type Tier, useMeta } from './meta'
import type { EstimateResponse, Stat, VariableSummary, Wave } from './types'
import { useVariables } from './variables'

export interface DomainFilter {
  column: string
  values: readonly (string | number)[]
}

/** One /v1/aggregate request, in the API's own vocabulary. */
export interface AggregateRequest {
  outcome: string
  wave: Wave
  stat: Stat
  /** Group columns in view order (country_code first for country views). */
  by: readonly string[]
  /** country_code filters (the API subsets these; all else is a domain). */
  countries?: readonly number[]
  filters?: readonly DomainFilter[]
  oriented?: boolean
  p?: readonly number[]
  /** The US state scopes (their weight is resolved by the server from
   * the weight table); absent = global. Never served statically. */
  scope?: 'global' | 'us_state' | 'us_state_adj'
}

/** Canonical query string: stable order in, stable cache keys out. */
export function canonicalParams(request: AggregateRequest): URLSearchParams {
  const params = new URLSearchParams()
  params.set('outcome', request.outcome)
  params.set('wave', request.wave)
  params.set('stat', request.stat)
  if (request.scope && request.scope !== 'global') params.set('scope', request.scope)
  for (const column of request.by) params.append('by', column)
  for (const code of request.countries ?? []) params.append('filter', `country_code:${code}`)
  for (const filter of request.filters ?? [])
    for (const value of filter.values) params.append('filter', `${filter.column}:${value}`)
  if (request.oriented) params.set('oriented', 'true')
  if (request.stat === 'quantile') for (const p of request.p ?? []) params.append('p', String(p))
  return params
}

export function canonicalKey(request: AggregateRequest): string {
  return canonicalParams(request).toString()
}

export interface StaticPathContext {
  /** The outcome's summary (default_stat, scale_type, waves_available). */
  variable: VariableSummary | undefined
  /** meta.breakdowns — the columns the exporter faceted by. */
  breakdowns: readonly string[]
}

/**
 * The exporter's path for this request, or null when only the API can
 * answer it. Mirrors flourish_pipeline.aggregate: per outcome × wave,
 * the default stat by country and by country × one demographic, plus a
 * distribution by country for 0–10 scales. A wrong guess is safe — the
 * 404 falls back to the API — so this is a fast path, not a contract.
 */
export function staticPathFor(
  request: AggregateRequest,
  context: StaticPathContext,
): string | null {
  const { variable, breakdowns } = context
  if (variable === undefined || !variable.servable) return null
  if (!variable.waves_available.includes(request.wave)) return null
  if (request.countries?.length || request.filters?.length) return null
  if (request.scope && request.scope !== 'global') return null
  if (request.oriented || request.stat === 'quantile') return null
  if (request.by[0] !== 'country_code') return null
  if (request.by.length === 1) {
    if (request.stat === 'distribution' && variable.scale_type === 'scale_0_10') {
      return `v1/${request.outcome}/${request.wave}/distribution_by-country_code.json`
    }
    if (request.stat === variable.default_stat) {
      return `v1/${request.outcome}/${request.wave}/${request.stat}_by-country_code.json`
    }
    return null
  }
  if (request.by.length !== 2 || request.stat !== variable.default_stat) return null
  const demographic = request.by[1]
  if (
    demographic === undefined ||
    demographic === 'country_code' ||
    !breakdowns.includes(demographic)
  ) {
    return null
  }
  return `v1/${request.outcome}/${request.wave}/${request.stat}_by-country_code-${demographic}.json`
}

export interface EstimatesResult {
  response: EstimateResponse
  source: Tier
}

const negativeCache = new Set<string>()

/** Test hook: forget which static paths have missed. */
export function resetNegativePathCache(): void {
  negativeCache.clear()
}

export async function fetchEstimates(
  request: AggregateRequest,
  context: StaticPathContext & { dataVersion: string | null },
): Promise<EstimatesResult> {
  const path = staticPathFor(request, context)
  if (path !== null) {
    const missKey = `${context.dataVersion ?? 'unknown'}:${path}`
    if (!negativeCache.has(missKey)) {
      const hit = await fetchStaticJson<EstimateResponse>(`${STATIC_BASE_URL}/${path}`)
      if (hit !== STATIC_MISS) return { response: hit, source: 'static' }
      negativeCache.add(missKey)
    }
  }
  const response = await fetchApiJson<EstimateResponse>(
    `${API_BASE_URL}/v1/aggregate?${canonicalParams(request).toString()}`,
  )
  return { response, source: 'api' }
}

/** The CSV download for the same query (served by the API). */
export function exportCsvUrl(request: AggregateRequest): string {
  return `${API_BASE_URL}/v1/export.csv?${canonicalParams(request).toString()}`
}

export function useEstimates(request: AggregateRequest | null) {
  const meta = useMeta()
  const variables = useVariables()
  const dataVersion = meta.data?.meta.data_version ?? null
  return useQuery({
    queryKey: ['estimates', dataVersion, request === null ? 'none' : canonicalKey(request)],
    enabled: request !== null && meta.isSuccess && variables.isSuccess,
    // Refetch keeps the frame: the previous render holds (dimmed by the
    // view) instead of a skeleton flash.
    placeholderData: keepPreviousData,
    queryFn: () => {
      if (request === null || meta.data === undefined || variables.data === undefined)
        throw new Error('estimates query ran before its inputs')
      return fetchEstimates(request, {
        variable: variables.data.byName[request.outcome],
        breakdowns: meta.data.meta.breakdowns,
        dataVersion,
      })
    },
  })
}

export interface EstimatesManyResult {
  /** One entry per request, in order; undefined until that one answers. */
  results: (EstimatesResult | undefined)[]
  isPending: boolean
  isError: boolean
  error: unknown
  isPlaceholderData: boolean
  isSuccess: boolean
}

/** Several cross-sections at once (What Matters' seven items) — the
 * same fetcher and cache keys as useEstimates, so a view that later asks
 * for one of them alone finds it already loaded. The list may change
 * length between renders (it comes from the catalog); useQueries keeps
 * the hook count constant. `enabled: false` holds every request (a view
 * that isn't on screen fetches nothing). */
export function useEstimatesMany(
  requests: readonly AggregateRequest[],
  options: { enabled?: boolean } = {},
): EstimatesManyResult {
  const meta = useMeta()
  const variables = useVariables()
  const dataVersion = meta.data?.meta.data_version ?? null
  const enabled = (options.enabled ?? true) && meta.isSuccess && variables.isSuccess
  return useQueries({
    queries: requests.map((request) => ({
      queryKey: ['estimates', dataVersion, canonicalKey(request)],
      enabled,
      placeholderData: keepPreviousData,
      queryFn: () => {
        if (meta.data === undefined || variables.data === undefined)
          throw new Error('estimates query ran before its inputs')
        return fetchEstimates(request, {
          variable: variables.data.byName[request.outcome],
          breakdowns: meta.data.meta.breakdowns,
          dataVersion,
        })
      },
    })),
    combine: (results) => ({
      results: results.map((result) => result.data),
      isPending: results.some((result) => result.isPending),
      isError: results.some((result) => result.isError),
      error: results.find((result) => result.error)?.error,
      isPlaceholderData: results.some((result) => result.isPlaceholderData),
      isSuccess: results.length > 0 && results.every((result) => result.isSuccess),
    }),
  })
}
