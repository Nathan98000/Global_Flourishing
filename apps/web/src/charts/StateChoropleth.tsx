// US state choropleth (Phase 5): Albers USA projection (Alaska and Hawaii
// inset by the projection), the quantized token ramp (mapScale.tsx),
// anchored to the observed range; states with no estimate wear the
// empty fill and say so in the tip, with the same bordered "no estimate"
// swatch in the legend. A pooled group's members all take the group's
// value and wear a dashed outline; every name in the tip is the
// server's (meta.state_labels). Never fetches.

import * as Plot from '@observablehq/plot'
import type { EstimateRow, Meta, ResponseMeta, VariableSummary } from '../api/types'
import { groupValueLabel, stateMembersOf } from '../labels'
import { mapDomain, quantizeColor } from './mapScale'
import {
  FONT_FAMILY,
  INK,
  INK_SECONDARY,
  MAP_EMPTY,
  MAP_EMPTY_OUTLINE,
  SURFACE,
  TIP_OPTIONS,
  tipText,
  type TipContext,
} from './theme'
import { chartWidth, usePlot } from './usePlot'
import { joinStates, type StateEntry, type UsFeature } from './usTopology'

/** Whether a feature belongs to a pooled small-state group. */
export function isPooledState(entry: Pick<StateEntry, 'code'>, meta: Meta): boolean {
  return entry.code !== null && stateMembersOf(entry.code, meta).length > 1
}

/** The hover card for one feature (theme.ts tipText): the server's name
 * — a pooled member's own name, then the group it is estimated with —
 * the value in words, its CI and its n. */
export function stateTipText(entry: StateEntry, meta: Meta, context: TipContext = {}): string {
  const pooled = entry.code !== null && isPooledState(entry, meta)
  const heading = pooled
    ? entry.name
    : entry.code
      ? groupValueLabel('state', entry.code, meta)
      : entry.name
  const detail =
    pooled && entry.code
      ? `One estimate for ${groupValueLabel('state', entry.code, meta)}`
      : undefined
  if (!entry.row) return [heading, detail, 'No estimate'].filter(Boolean).join('\n')
  return tipText(entry.row, heading, { ...context, detail })
}

export function StateChoropleth({
  rows,
  responseMeta,
  features,
  meta,
  variable,
  answer,
}: {
  rows: EstimateRow[]
  responseMeta: ResponseMeta
  features: UsFeature[]
  /** For the server's state names (pooled groups read "A, B & C (pooled)"). */
  meta: Meta
  /** The measure, for its scale in the hover cards ("on a 0–10 scale"). */
  variable?: VariableSummary
  /** The answer a share counts ("45.0% answered “Yes”"). */
  answer?: string
}) {
  const container = usePlot(
    (available) => {
      const { entries } = joinStates(rows, features)
      const domain = mapDomain(rows, responseMeta)
      const width = chartWidth(720, available)
      const color = quantizeColor(domain)
      const fillOf = (entry: StateEntry): string =>
        entry.value === null ? MAP_EMPTY : color(entry.value)
      const tipOf = (entry: StateEntry): string =>
        stateTipText(entry, meta, { answer, range: variable })
      const pooled = entries.filter((entry) => isPooledState(entry, meta))
      const empty = entries.filter((entry) => entry.value === null)
      return Plot.plot({
        width,
        height: Math.round((width * 450) / 720),
        style: {
          fontFamily: FONT_FAMILY,
          fontSize: '11px',
          background: 'transparent',
          color: INK_SECONDARY,
        },
        projection: 'albers-usa',
        marks: [
          Plot.geo(entries, {
            geometry: (entry: StateEntry) => entry.feature,
            fill: fillOf,
            stroke: SURFACE,
            strokeWidth: 0.6,
            tip: TIP_OPTIONS,
            title: tipOf,
          }),
          // States without an estimate: the neutral, outlined so it never
          // reads as the lowest bin.
          Plot.geo(empty, {
            geometry: (entry: StateEntry) => entry.feature,
            fill: MAP_EMPTY,
            stroke: MAP_EMPTY_OUTLINE,
            strokeWidth: 0.8,
            pointerEvents: 'none',
          }),
          // The pooled small-state groups: a dashed outline on each member.
          Plot.geo(pooled, {
            geometry: (entry: StateEntry) => entry.feature,
            fill: 'none',
            stroke: INK,
            strokeWidth: 1,
            strokeDasharray: '3 2',
            pointerEvents: 'none',
          }),
        ],
      })
    },
    [rows, responseMeta, features, meta, variable, answer],
  )

  return <div ref={container} />
}
