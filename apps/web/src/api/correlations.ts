// GET /v1/correlations/pair — two questions side by side — and GET
// /v1/correlations — a table of 2–10 (ADR-0018). API-only, like
// /v1/correlates: the static tier precomputes no pairs.
// One request answers the Compare two view: a weighted cross-tab of the
// question on the columns (x) and the one on the rows (y) in one country
// — each cell the share of its column who gave the row's answer, each
// column's share of the people, flagged where few people are behind a
// number (ADR-0019) — and the two questions' weighted correlation.

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { API_BASE_URL } from '../config'
import { appendScope, type CorrelationMethod, type CountryScope } from './correlates'
import { fetchApiJson } from './http'
import { useMeta } from './meta'
import type { CorrelationsResponse, PairResponse, Wave } from './types'

/** One /v1/correlations/pair request, in the API's own vocabulary. */
export interface PairRequest {
  y: string
  x: string
  wave: Wave
  /** One country, or every country pooled (ADR-0020). */
  country: CountryScope
  method?: CorrelationMethod
  /** At the midyear survey, when a question is from another wave: the
   * wave its answers come from (ADR-0020). */
  otherWave?: 'Y1' | 'Y2'
}

/** Canonical query string: stable order in, stable cache keys out. */
export function canonicalPairParams(request: PairRequest): URLSearchParams {
  const params = new URLSearchParams()
  params.set('y', request.y)
  params.set('x', request.x)
  params.set('wave', request.wave)
  appendScope(params, request.country)
  if (request.method && request.method !== 'pearson') params.set('method', request.method)
  if (request.otherWave) params.set('other_wave', request.otherWave)
  return params
}

export function fetchPair(request: PairRequest): Promise<PairResponse> {
  return fetchApiJson<PairResponse>(
    `${API_BASE_URL}/v1/correlations/pair?${canonicalPairParams(request).toString()}`,
  )
}

/** `enabled: false` keeps the query idle while another view is on screen. */
export function usePair(request: PairRequest | null, { enabled = true } = {}) {
  const meta = useMeta()
  const dataVersion = meta.data?.meta.data_version ?? null
  return useQuery({
    queryKey: [
      'correlation-pair',
      dataVersion,
      request === null ? 'none' : canonicalPairParams(request).toString(),
    ],
    enabled: request !== null && enabled,
    placeholderData: keepPreviousData,
    queryFn: () => {
      if (request === null) throw new Error('pair query ran before its inputs')
      return fetchPair(request)
    },
  })
}

/** One /v1/correlations request: the table's questions, in order. */
export interface TableRequest {
  vars: readonly string[]
  wave: Wave
  /** One country, or every country pooled (ADR-0020). */
  country: CountryScope
  method?: CorrelationMethod
  /** At the midyear survey, as PairRequest's. */
  otherWave?: 'Y1' | 'Y2'
}

export function canonicalTableParams(request: TableRequest): URLSearchParams {
  const params = new URLSearchParams()
  for (const name of request.vars) params.append('vars', name)
  params.set('wave', request.wave)
  appendScope(params, request.country)
  if (request.method && request.method !== 'pearson') params.set('method', request.method)
  if (request.otherWave) params.set('other_wave', request.otherWave)
  return params
}

export function fetchTable(request: TableRequest): Promise<CorrelationsResponse> {
  return fetchApiJson<CorrelationsResponse>(
    `${API_BASE_URL}/v1/correlations?${canonicalTableParams(request).toString()}`,
  )
}

export function useCorrelationTable(request: TableRequest | null, { enabled = true } = {}) {
  const meta = useMeta()
  const dataVersion = meta.data?.meta.data_version ?? null
  return useQuery({
    queryKey: [
      'correlation-table',
      dataVersion,
      request === null ? 'none' : canonicalTableParams(request).toString(),
    ],
    enabled: request !== null && enabled,
    placeholderData: keepPreviousData,
    queryFn: () => {
      if (request === null) throw new Error('table query ran before its inputs')
      return fetchTable(request)
    },
  })
}
