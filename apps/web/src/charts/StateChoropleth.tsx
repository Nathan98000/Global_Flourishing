// US state choropleth (Phase 5): Albers USA projection (Alaska and Hawaii
// inset by the projection), the same quantized token ramp as the world
// map, anchored to the observed range; states with no estimate wear the
// empty fill and say so in the tip, with the same bordered "no estimate"
// swatch in the legend. A pooled group's members all take the group's
// value. Never fetches.

import * as Plot from '@observablehq/plot'
import type { EstimateRow, ResponseMeta } from '../api/types'
import { ciLabel, formatEstimate } from '../format'
import { mapDomain, quantizeColor } from './Choropleth'
import { FONT_FAMILY, INK_SECONDARY, MAP_EMPTY, SURFACE } from './theme'
import { chartWidth, usePlot } from './usePlot'
import { joinStates, stateMembers, type StateEntry, type UsFeature } from './usTopology'

export function StateChoropleth({
  rows,
  responseMeta,
  features,
}: {
  rows: EstimateRow[]
  responseMeta: ResponseMeta
  features: UsFeature[]
}) {
  const container = usePlot(
    (available) => {
      const { entries } = joinStates(rows, features)
      const domain = mapDomain(rows, responseMeta)
      const width = chartWidth(720, available)
      const color = quantizeColor(domain)
      const fillOf = (entry: StateEntry): string =>
        entry.value === null ? MAP_EMPTY : color(entry.value)
      const tipOf = (entry: StateEntry): string => {
        const where =
          entry.code && stateMembers(entry.code).length > 1
            ? `${entry.name} (pooled as ${entry.code})`
            : entry.code
              ? `${entry.name} (${entry.code})`
              : entry.name
        if (!entry.row) return `${where}\nno estimate`
        const row = entry.row
        const lines = [`${formatEstimate(row.estimate, row.stat)}  ${where}`]
        if (row.ci_lo !== null && row.ci_hi !== null) {
          lines.push(
            `${ciLabel(row.ci_level)} ${formatEstimate(row.ci_lo, row.stat)} to ${formatEstimate(row.ci_hi, row.stat)}`,
          )
        }
        return lines.join('\n')
      }
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
            tip: true,
            title: tipOf,
          }),
        ],
      })
    },
    [rows, responseMeta, features],
  )

  return <div ref={container} />
}
