// Aliases over the generated OpenAPI types (schema.d.ts, `pnpm gen:api`).
// Every response the app touches is one of these server models — no
// hand-written response interfaces anywhere (ADR-0008/0009).

import type { components, paths } from './schema'

export type ApiHealth = paths['/health']['get']['responses']['200']['content']['application/json']
export type Meta = components['schemas']['MetaResponse']
export type Country = components['schemas']['CountryModel']
export type WeightSpec = components['schemas']['WeightSpecModel']
export type BreakdownLabels = components['schemas']['BreakdownLabelsModel']
export type BreakdownLevel = components['schemas']['BreakdownLevelModel']
export type VariableList = components['schemas']['VariableList']
export type VariableSummary = components['schemas']['VariableSummary']
export type VariableDetail = components['schemas']['VariableDetail']
export type ValueLabel = components['schemas']['ValueLabelModel']
export type MissingnessRow = components['schemas']['MissingnessRow']
export type EstimateResponse = components['schemas']['EstimateResponse']
export type EstimateRow = components['schemas']['EstimateRow']
export type ResponseMeta = components['schemas']['ResponseMeta']
export type PairResponse = components['schemas']['PairResponse']
export type PairGroup = components['schemas']['PairGroupModel']
export type CorrelationsResponse = components['schemas']['CorrelationsResponse']
export type CorrelationPair = components['schemas']['CorrelationPairModel']

export type Wave = 'Y1' | 'MY' | 'Y2'
export const WAVES: readonly Wave[] = ['Y1', 'MY', 'Y2']

export type Stat = 'mean' | 'proportion' | 'distribution' | 'quantile'
export const STATS: readonly Stat[] = ['mean', 'proportion', 'distribution', 'quantile']

export function isWave(value: unknown): value is Wave {
  return value === 'Y1' || value === 'MY' || value === 'Y2'
}

export function isStat(value: unknown): value is Stat {
  return (STATS as readonly unknown[]).includes(value)
}
