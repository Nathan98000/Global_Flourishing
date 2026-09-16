// The variable catalog: one fetch, filtered in memory (182 rows — never a
// request per keystroke into a 60/min rate limit). Static tier first,
// API fallback, one generated type either way.

import { useQuery } from '@tanstack/react-query'
import { API_BASE_URL, STATIC_BASE_URL } from '../config'
import { STATIC_MISS, fetchApiJson, fetchStaticJson } from './http'
import type { Tier } from './meta'
import type { VariableDetail, VariableList, VariableSummary } from './types'

export interface VariablesResult {
  list: VariableSummary[]
  byName: Record<string, VariableSummary>
  source: Tier
}

export async function fetchVariables(): Promise<VariablesResult> {
  const fromStatic = await fetchStaticJson<VariableList>(`${STATIC_BASE_URL}/variables.json`)
  const result =
    fromStatic !== STATIC_MISS
      ? { payload: fromStatic, source: 'static' as const }
      : {
          payload: await fetchApiJson<VariableList>(`${API_BASE_URL}/v1/variables`),
          source: 'api' as const,
        }
  const byName: Record<string, VariableSummary> = {}
  for (const variable of result.payload.variables) byName[variable.name] = variable
  return { list: result.payload.variables, byName, source: result.source }
}

export function useVariables() {
  return useQuery({ queryKey: ['variables'], queryFn: fetchVariables })
}

export interface VariableDetailResult {
  detail: VariableDetail
  source: Tier
}

export async function fetchVariableDetail(name: string): Promise<VariableDetailResult> {
  const fromStatic = await fetchStaticJson<VariableDetail>(
    `${STATIC_BASE_URL}/v1/${encodeURIComponent(name)}/variable.json`,
  )
  if (fromStatic !== STATIC_MISS) return { detail: fromStatic, source: 'static' }
  const fromApi = await fetchApiJson<VariableDetail>(
    `${API_BASE_URL}/v1/variables/${encodeURIComponent(name)}`,
  )
  return { detail: fromApi, source: 'api' }
}

export function useVariable(name: string | null) {
  return useQuery({
    queryKey: ['variable', name],
    enabled: name !== null,
    queryFn: () => fetchVariableDetail(name as string),
  })
}
