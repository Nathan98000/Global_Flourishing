// GET /v1/correlates — what travels with an outcome (Phase 6). API-only:
// the static tier precomputes no associations, so this module never tries
// a static path. One request answers either the ranked sweep (every other
// ordered item, strongest first, cut by the server) or the predictors it
// names, across the groups asked for. Rows are weighted correlations —
// point estimates (`ci_method = "none"`), drawn without an interval. The
// page never asks for the adjusted models (ADR-0018: off by default on
// the server, and no longer offered here).

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { API_BASE_URL } from '../config'
import type { DomainFilter } from './estimates'
import { fetchApiJson } from './http'
import { useMeta } from './meta'
import type { EstimateResponse, EstimateRow, Wave } from './types'

export type CorrelationMethod = 'pearson' | 'spearman'
export const CORRELATION_METHODS: readonly CorrelationMethod[] = ['pearson', 'spearman']

/** Where a correlation is taken: one country by its code, or every
 * country — each on its own, and their plain average (ADR-0020). */
export type CountryScope = number | 'all'

/** A scope as the API's parameters: a country filter, or `pooled`. */
export function appendScope(params: URLSearchParams, scope: CountryScope): void {
  if (scope === 'all') params.set('pooled', 'average')
  else params.append('filter', `country_code:${scope}`)
}

/** One /v1/correlates request, in the API's own vocabulary. */
export interface CorrelatesRequest {
  outcome: string
  wave: Wave
  /** Named predictors, reported in this order; absent = the ranked sweep. */
  against?: readonly string[]
  method?: CorrelationMethod
  /** Group columns (country_code for the cross-country matrix; none for one country). */
  by: readonly string[]
  countries?: readonly number[]
  /** Every country averaged (ADR-0020), in place of `countries`. */
  pooled?: boolean
  /** At the midyear survey: the wave the other questions' answers come
   * from (ADR-0020); absent = the server's default, 2023. */
  otherWave?: 'Y1' | 'Y2'
  filters?: readonly DomainFilter[]
  /** Predictors a ranked sweep returns (the server's default otherwise). */
  limit?: number
}

/** Canonical query string: stable order in, stable cache keys out. */
export function canonicalCorrelatesParams(request: CorrelatesRequest): URLSearchParams {
  const params = new URLSearchParams()
  params.set('outcome', request.outcome)
  params.set('wave', request.wave)
  for (const name of request.against ?? []) params.append('against', name)
  if (request.method && request.method !== 'pearson') params.set('method', request.method)
  for (const column of request.by) params.append('by', column)
  for (const code of request.countries ?? []) params.append('filter', `country_code:${code}`)
  if (request.pooled) params.set('pooled', 'average')
  if (request.otherWave) params.set('other_wave', request.otherWave)
  for (const filter of request.filters ?? [])
    for (const value of filter.values) params.append('filter', `${filter.column}:${value}`)
  if (request.limit !== undefined) params.set('limit', String(request.limit))
  return params
}

export function canonicalCorrelatesKey(request: CorrelatesRequest): string {
  return canonicalCorrelatesParams(request).toString()
}

export function fetchCorrelates(request: CorrelatesRequest): Promise<EstimateResponse> {
  return fetchApiJson<EstimateResponse>(
    `${API_BASE_URL}/v1/correlates?${canonicalCorrelatesParams(request).toString()}`,
  )
}

/** `enabled: false` keeps a view's query idle while another view is on
 * screen (the request is still known, so the cache key is stable). */
export function useCorrelates(
  request: CorrelatesRequest | null,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const meta = useMeta()
  const dataVersion = meta.data?.meta.data_version ?? null
  return useQuery({
    queryKey: [
      'correlates',
      dataVersion,
      request === null ? 'none' : canonicalCorrelatesKey(request),
    ],
    enabled: request !== null && enabled,
    // Refetch keeps the frame (dimmed, with the progress bar) — no block flash.
    placeholderData: keepPreviousData,
    queryFn: () => {
      if (request === null) throw new Error('correlates query ran before its inputs')
      return fetchCorrelates(request)
    },
  })
}

// --- Row narrowing ---------------------------------------------------------

/** Predictor names in the order the server returned them (ranked, for a sweep). */
export function predictorOrder(rows: readonly EstimateRow[]): string[] {
  const seen: string[] = []
  for (const row of rows) {
    if (row.predictor && !seen.includes(row.predictor)) seen.push(row.predictor)
  }
  return seen
}
