// GET /v1/correlations/pair — two questions side by side (ADR-0018).
// API-only, like /v1/correlates: the static tier precomputes no pairs.
// One request answers the Compare two view: the weighted correlation of
// the measure (y) and the question it is compared with (x) in one
// country, and y's weighted mean in each group of x — x's answers, or
// bins of a long scale — in x's aligned order, each with its share of
// the people who answered both and whether it rests on too few of them.

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { API_BASE_URL } from '../config'
import type { CorrelationMethod } from './correlates'
import { fetchApiJson } from './http'
import { useMeta } from './meta'
import type { PairResponse, Wave } from './types'

/** One /v1/correlations/pair request, in the API's own vocabulary. */
export interface PairRequest {
  y: string
  x: string
  wave: Wave
  country: number
  method?: CorrelationMethod
}

/** Canonical query string: stable order in, stable cache keys out. */
export function canonicalPairParams(request: PairRequest): URLSearchParams {
  const params = new URLSearchParams()
  params.set('y', request.y)
  params.set('x', request.x)
  params.set('wave', request.wave)
  params.append('filter', `country_code:${request.country}`)
  if (request.method && request.method !== 'pearson') params.set('method', request.method)
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
