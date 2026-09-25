// US state choropleth (Phase 5): Albers USA projection (Alaska and Hawaii
// inset by the projection), the quantized token ramp (mapScale.tsx),
// anchored to the observed range; states with no estimate wear the
// empty fill and say so in the tip, with the same bordered "no estimate"
// swatch in the legend. A pooled group's members all take the group's
// value and wear a dashed outline; every name in the tip is the
// server's (meta.state_labels). Never fetches.

import * as Plot from '@observablehq/plot'
import type { EstimateRow, Meta, ResponseMeta } from '../api/types'
import { ciLabel, formatCount, formatEstimate } from '../format'
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
} from './theme'
import { chartWidth, usePlot } from './usePlot'
import { joinStates, type StateEntry, type UsFeature } from './usTopology'

/** Whether a feature belongs to a pooled small-state group. */
export function isPooledState(entry: Pick<StateEntry, 'code'>, meta: Meta): boolean {
  return entry.code !== null && stateMembersOf(entry.code, meta).length > 1
}

/** The tip for one feature: the server's name (a pooled member names its
 * group), the estimate, the interval and the n. */
export function stateTipText(entry: StateEntry, meta: Meta): string {
  const where =
    entry.code && isPooledState(entry, meta)
      ? `${entry.name} — ${groupValueLabel('state', entry.code, meta)}`
      : entry.code
        ? groupValueLabel('state', entry.code, meta)
        : entry.name
  if (!entry.row) return `${where}\nno estimate`
  const row = entry.row
  const lines = [`${formatEstimate(row.estimate, row.stat)}  ${where}`]
  if (row.ci_lo !== null && row.ci_hi !== null) {
    lines.push(
      `${ciLabel(row.ci_level)} ${formatEstimate(row.ci_lo, row.stat)} to ${formatEstimate(row.ci_hi, row.stat)}`,
    )
  }
  lines.push(`n = ${formatCount(row.n)}`)
  return lines.join('\n')
}

export function StateChoropleth({
  rows,
  responseMeta,
  features,
  meta,
}: {
  rows: EstimateRow[]
  responseMeta: ResponseMeta
  features: UsFeature[]
  /** For the server's state names (pooled groups read "A, B & C (pooled)"). */
  meta: Meta
}) {
  const container = usePlot(
    (available) => {
      const { entries } = joinStates(rows, features)
      const domain = mapDomain(rows, responseMeta)
      const width = chartWidth(720, available)
      const color = quantizeColor(domain)
      const fillOf = (entry: StateEntry): string =>
        entry.value === null ? MAP_EMPTY : color(entry.value)
      const tipOf = (entry: StateEntry): string => stateTipText(entry, meta)
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
    [rows, responseMeta, features, meta],
  )

  return <div ref={container} />
}
