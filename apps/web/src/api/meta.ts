// Boot data: /data/meta.json first (the app must paint with the API cold,
// down, or data-less — ADR-0009), /v1/meta as fallback. One /health ping
// on mount reports the live tier honestly and warms a scaled-to-zero
// Cloud Run instance while the visitor reads a static chart.

import { useQuery } from '@tanstack/react-query'
import { API_BASE_URL, STATIC_BASE_URL } from '../config'
import { STATIC_MISS, fetchApiJson, fetchStaticJson } from './http'
import type { ApiHealth, Meta } from './types'

export type Tier = 'static' | 'api'

export interface MetaResult {
  meta: Meta
  source: Tier
}

export async function fetchMeta(): Promise<MetaResult> {
  const fromStatic = await fetchStaticJson<Meta>(`${STATIC_BASE_URL}/meta.json`)
  if (fromStatic !== STATIC_MISS) return { meta: fromStatic, source: 'static' }
  const fromApi = await fetchApiJson<Meta>(`${API_BASE_URL}/v1/meta`)
  return { meta: fromApi, source: 'api' }
}

export function useMeta() {
  return useQuery({ queryKey: ['meta'], queryFn: fetchMeta })
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => fetchApiJson<ApiHealth>(`${API_BASE_URL}/health`),
  })
}

export type BootState =
  | 'loading'
  | 'ready' // static tier + live API
  | 'static-only' // static tier answers; the API is unreachable or data-less
  | 'api-only' // no static tier shipped; everything hits the API
  | 'no-data' // neither tier reachable — the shell still renders, honestly

export interface BootStatus {
  state: BootState
  meta: Meta | null
  metaSource: Tier | null
  health: ApiHealth | null
  apiReachable: boolean
  apiHasData: boolean
}

export function useBootStatus(): BootStatus {
  const meta = useMeta()
  const health = useHealth()
  const apiReachable = health.isSuccess
  const apiHasData = health.isSuccess && health.data.data === 'ok'
  let state: BootState = 'loading'
  if (meta.isSuccess) {
    if (meta.data.source === 'static') state = apiHasData ? 'ready' : 'static-only'
    else state = 'api-only'
  } else if (meta.isError) {
    // fetchMeta already fell back static → API, so this is both tiers.
    state = 'no-data'
  }
  return {
    state,
    meta: meta.data?.meta ?? null,
    metaSource: meta.data?.source ?? null,
    health: health.data ?? null,
    apiReachable,
    apiHasData,
  }
}
