// GET /v1/change — how the same people answered later (Phase 5). API-only:
// nothing in the static tier precomputes change, so this module never
// tries a static path. One request returns several row kinds in one
// envelope, discriminated by `row.stat`; the narrowing helpers below are
// the only place the app reads that discriminator. `ChangeStat` is
// deliberately separate from `Stat` (types.ts), which the Atlas and the
// static tier depend on.

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { API_BASE_URL } from '../config'
import type { DomainFilter } from './estimates'
import { fetchApiJson } from './http'
import { useMeta } from './meta'
import type { EstimateResponse, EstimateRow, Wave } from './types'

/** The stats /v1/change rows carry — never widened into `Stat`. A
 * numeric measure's change is `change` (the mean change on values
 * aligned to the label) with its `change_distribution`; a categorical
 * item's is `change_share` (the change in the share answering each
 * level, a fraction — shown in percentage points) with its
 * `transition` matrix. */
export type ChangeStat = 'change' | 'change_share' | 'change_distribution' | 'transition'
export const CHANGE_STATS: readonly ChangeStat[] = [
  'change',
  'change_share',
  'change_distribution',
  'transition',
]

export function isChangeStat(value: unknown): value is ChangeStat {
  return (CHANGE_STATS as readonly unknown[]).includes(value)
}

/** Legs of the three-point panel, as the engine names them. */
export type ChangeLeg = 'y1_my' | 'my_y2' | 'y1_y2'
export const CHANGE_LEGS: readonly ChangeLeg[] = ['y1_my', 'my_y2', 'y1_y2']

export type TransitionMeasure = 'transition_joint' | 'transition_conditional'

export type Scope = 'global' | 'us_state' | 'us_state_adj'

/** One /v1/change request, in the API's own vocabulary. */
export interface ChangeRequest {
  outcome: string
  from: Wave
  to: Wave
  /** `MY` asks for the three-point panel (Y1 → MY → Y2). */
  via?: 'MY'
  /** Group columns (country_code for the global scope; state under US scopes). */
  by: readonly string[]
  countries?: readonly number[]
  filters?: readonly DomainFilter[]
  scope?: Scope
  /** The alternative rectangular panel weight (Y1 → Y2 only). */
  rect?: boolean
}

/** Canonical query string: stable order in, stable cache keys out. */
export function canonicalChangeParams(request: ChangeRequest): URLSearchParams {
  const params = new URLSearchParams()
  params.set('outcome', request.outcome)
  params.set('from', request.from)
  if (request.via) params.set('via', request.via)
  params.set('to', request.to)
  for (const column of request.by) params.append('by', column)
  for (const code of request.countries ?? []) params.append('filter', `country_code:${code}`)
  for (const filter of request.filters ?? [])
    for (const value of filter.values) params.append('filter', `${filter.column}:${value}`)
  if (request.scope && request.scope !== 'global') params.set('scope', request.scope)
  if (request.rect) params.set('rect', 'true')
  return params
}

export function canonicalChangeKey(request: ChangeRequest): string {
  return canonicalChangeParams(request).toString()
}

export function fetchChange(request: ChangeRequest): Promise<EstimateResponse> {
  return fetchApiJson<EstimateResponse>(
    `${API_BASE_URL}/v1/change?${canonicalChangeParams(request).toString()}`,
  )
}

export function useChange(request: ChangeRequest | null) {
  const meta = useMeta()
  const dataVersion = meta.data?.meta.data_version ?? null
  return useQuery({
    queryKey: ['change', dataVersion, request === null ? 'none' : canonicalChangeKey(request)],
    enabled: request !== null,
    // Refetch keeps the frame (dimmed, with the progress bar) — no block flash.
    placeholderData: keepPreviousData,
    queryFn: () => {
      if (request === null) throw new Error('change query ran before its inputs')
      return fetchChange(request)
    },
  })
}

// --- Row narrowing ---------------------------------------------------------

export function rowsOfStat(rows: readonly EstimateRow[], stat: ChangeStat): EstimateRow[] {
  return rows.filter((row) => row.stat === stat)
}

/** Mean within-person change rows; `leg` narrows a three-point response. */
export function changeRows(rows: readonly EstimateRow[], leg?: ChangeLeg): EstimateRow[] {
  const change = rowsOfStat(rows, 'change')
  return leg === undefined ? change : change.filter((row) => row.leg === leg)
}

/** The change in share answering one level (the chosen one, or the
 * lowest level present while the codebook detail is still loading). */
export function changeShareRows(rows: readonly EstimateRow[], level?: number): EstimateRow[] {
  const share = rowsOfStat(rows, 'change_share')
  if (share.length === 0) return share
  const chosen = level ?? Math.min(...share.map((row) => row.level as number))
  return share.filter((row) => row.level === chosen)
}

/** The histogram of individual change; `level` is the signed bucket. */
export function changeDistributionRows(rows: readonly EstimateRow[]): EstimateRow[] {
  return rowsOfStat(rows, 'change_distribution')
}

/** Transition cells for one measure (conditional by default: of the
 * people who answered i first, the share answering j later). */
export function transitionRows(
  rows: readonly EstimateRow[],
  measure: TransitionMeasure = 'transition_conditional',
): EstimateRow[] {
  return rowsOfStat(rows, 'transition').filter((row) => row.measure === measure)
}

/** The legs a three-point response actually carries, in panel order. */
export function legsPresent(rows: readonly EstimateRow[]): ChangeLeg[] {
  const present = new Set(changeRows(rows).map((row) => row.leg))
  return CHANGE_LEGS.filter((leg) => present.has(leg))
}
