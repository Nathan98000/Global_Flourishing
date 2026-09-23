// GET /v1/states — US state estimates on the state-calibrated weights
// (Phase 5). API-only, like /v1/change: the static tier has no state
// views. Same envelope as /v1/aggregate (rows grouped by `state`), so
// the charts and the table need nothing new. `adj=true` selects the
// adjusted weight variants — which do not exist for Wave 1; the view
// keeps that control unavailable on Y1 rather than asking and erroring.

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { API_BASE_URL } from '../config'
import type { DomainFilter } from './estimates'
import { fetchApiJson } from './http'
import { useMeta } from './meta'
import type { EstimateResponse, Stat, Wave } from './types'

/** The one wave the release has no adjusted state weight for. */
export const NO_ADJUSTED_WEIGHT_WAVE: Wave = 'Y1'

export function adjustedWeightsExist(wave: Wave): boolean {
  return wave !== NO_ADJUSTED_WEIGHT_WAVE
}

export interface StatesRequest {
  outcome: string
  wave: Wave
  stat: Stat
  adj?: boolean
  oriented?: boolean
  /** Extra group columns beyond `state` (demographics). */
  by?: readonly string[]
  filters?: readonly DomainFilter[]
}

export function canonicalStatesParams(request: StatesRequest): URLSearchParams {
  const params = new URLSearchParams()
  params.set('outcome', request.outcome)
  params.set('wave', request.wave)
  params.set('stat', request.stat)
  if (request.adj) params.set('adj', 'true')
  if (request.oriented) params.set('oriented', 'true')
  for (const column of request.by ?? []) params.append('by', column)
  for (const filter of request.filters ?? [])
    for (const value of filter.values) params.append('filter', `${filter.column}:${value}`)
  return params
}

export function canonicalStatesKey(request: StatesRequest): string {
  return canonicalStatesParams(request).toString()
}

export function fetchStates(request: StatesRequest): Promise<EstimateResponse> {
  return fetchApiJson<EstimateResponse>(
    `${API_BASE_URL}/v1/states?${canonicalStatesParams(request).toString()}`,
  )
}

export function useStates(request: StatesRequest | null) {
  const meta = useMeta()
  const dataVersion = meta.data?.meta.data_version ?? null
  return useQuery({
    queryKey: ['states', dataVersion, request === null ? 'none' : canonicalStatesKey(request)],
    enabled: request !== null,
    placeholderData: keepPreviousData,
    queryFn: () => {
      if (request === null) throw new Error('states query ran before its inputs')
      return fetchStates(request)
    },
  })
}
