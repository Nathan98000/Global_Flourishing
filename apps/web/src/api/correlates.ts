// GET /v1/correlates — what travels with an outcome (Phase 6). API-only:
// the static tier precomputes no associations, so this module never tries
// a static path. One request answers either the ranked sweep (every other
// ordered item, strongest first, cut by the server) or the predictors it
// names, across the groups asked for. Unadjusted rows are point estimates
// (`ci_method = "none"`) and are drawn without an interval; adjusted rows
// are model coefficients with a design-based CI, two per group (`measure`:
// `beta`, the raw coefficient, and `beta_per_sd`, the same per one SD of
// the measure — the one the charts compare across measures).

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { API_BASE_URL } from '../config'
import type { DomainFilter } from './estimates'
import { fetchApiJson } from './http'
import { useMeta } from './meta'
import type { EstimateResponse, EstimateRow, Wave } from './types'

export type CorrelationMethod = 'pearson' | 'spearman'
export const CORRELATION_METHODS: readonly CorrelationMethod[] = ['pearson', 'spearman']

/** The two rows an adjusted association ships per group. */
export type AssociationMeasure = 'beta' | 'beta_per_sd'

/** One /v1/correlates request, in the API's own vocabulary. */
export interface CorrelatesRequest {
  outcome: string
  wave: Wave
  /** Named predictors, reported in this order; absent = the ranked sweep. */
  against?: readonly string[]
  method?: CorrelationMethod
  adjusted?: boolean
  /** Group columns (country_code for the cross-country matrix; none for one country). */
  by: readonly string[]
  countries?: readonly number[]
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
  if (request.adjusted) params.set('adjusted', 'true')
  for (const column of request.by) params.append('by', column)
  for (const code of request.countries ?? []) params.append('filter', `country_code:${code}`)
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

export function useCorrelates(request: CorrelatesRequest | null) {
  const meta = useMeta()
  const dataVersion = meta.data?.meta.data_version ?? null
  return useQuery({
    queryKey: [
      'correlates',
      dataVersion,
      request === null ? 'none' : canonicalCorrelatesKey(request),
    ],
    enabled: request !== null,
    // Refetch keeps the frame (dimmed, with the progress bar) — no block flash.
    placeholderData: keepPreviousData,
    queryFn: () => {
      if (request === null) throw new Error('correlates query ran before its inputs')
      return fetchCorrelates(request)
    },
  })
}

// --- Row narrowing ---------------------------------------------------------

/** Whether a response carries adjusted-model coefficients (`stat = "beta"`). */
export function isAdjustedResponse(response: Pick<EstimateResponse, 'meta'>): boolean {
  return response.meta.stat === 'beta'
}

/** The rows a chart draws: one per (predictor, group). An adjusted
 * response contributes its per-SD coefficient — the one quantity that
 * compares across measures with different scales; the raw coefficient
 * stays in the data table. */
export function chartRows(
  rows: readonly EstimateRow[],
  measure: AssociationMeasure = 'beta_per_sd',
): EstimateRow[] {
  return rows.filter((row) => row.stat !== 'beta' || row.measure === measure)
}

/** Predictor names in the order the server returned them (ranked, for a sweep). */
export function predictorOrder(rows: readonly EstimateRow[]): string[] {
  const seen: string[] = []
  for (const row of rows) {
    if (row.predictor && !seen.includes(row.predictor)) seen.push(row.predictor)
  }
  return seen
}
