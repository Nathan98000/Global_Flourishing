// How the same people answered later (Phase 5): one row per country,
// a dot at the mean within-person change with its CI whisker, on a
// change axis that always contains a marked zero — a change chart that
// crops zero is a lie. Built from DotPlot's marks, not a new mark set.
// A three-point response facets into one column per leg (2023 →
// mid-2024, mid-2024 → 2024, 2023 → 2024), each with its own zero rule.
// Rows arrive ordered (sortRows.ts — the data table's order); every
// cell is shown (ADR-0011): a row with no interval draws its dot alone.

import * as Plot from '@observablehq/plot'
import type { ChangeLeg } from '../api/change'
import type { EstimateRow, Meta } from '../api/types'
import { formatEstimate } from '../format'
import { groupValueLabel } from '../labels'
import { legTitle } from '../waves'
import { dotMarks, type DotEntry } from './DotPlot'
import { ciExtents, fittedScale } from './domain'
import {
  FACET_PADDING,
  FONT_FAMILY,
  INK,
  INK_SECONDARY,
  MIN_ROWS,
  ROW_HEIGHT,
  plotCI,
  plotValue,
} from './theme'
import { chartWidth, usePlot } from './usePlot'

/** Entries keyed by country (y) and, for a three-point panel, by leg (fx). */
export function changeEntries(rows: EstimateRow[], meta: Meta): DotEntry[] {
  return rows.map((row) => ({
    row,
    level: groupValueLabel('country_code', row.group['country_code'] ?? null, meta),
    facet: row.leg ? legTitle(row.leg) : '',
    value: plotValue(row),
    ci: plotCI(row),
  }))
}

/** The fitted window, widened to contain zero: with zero among the
 * fitted values the nice-step ticks always include it, so the zero rule
 * lands on a labelled tick. */
export function changeScale(
  entries: readonly DotEntry[],
  targetTicks = 6,
  bounds?: readonly [number, number],
) {
  return fittedScale([0, ...ciExtents(entries.filter((entry) => entry.value !== null))], {
    targetTicks,
    bounds,
  })
}

/** The widest a change can be: ±the measure's span for a mean change,
 * ±100 points for a share change. */
export function changeBounds(
  variable: { min: number | null; max: number | null },
  shareChange: boolean,
): [number, number] | undefined {
  if (shareChange) return [-100, 100]
  if (variable.min === null || variable.max === null) return undefined
  const span = variable.max - variable.min
  return [-span, span]
}

export function ChangeDots({
  rows,
  meta,
  color,
  countryDomain,
  legs,
  bounds,
}: {
  rows: EstimateRow[]
  meta: Meta
  color: string
  /** Country labels in display order (the sort the table shares). */
  countryDomain: string[]
  /** Present legs of a three-point response, in panel order; absent
   * for a plain pair. */
  legs?: readonly ChangeLeg[]
  /** The widest the change can be (see `changeBounds`). */
  bounds?: readonly [number, number]
}) {
  const container = usePlot(
    (available) => {
      const entries = changeEntries(rows, meta)
      const faceted = legs !== undefined && legs.length > 1
      const facetChannel: Record<string, string> = faceted ? { fx: 'facet' } : {}
      const width = chartWidth(faceted ? 820 : 660, available)
      const narrow = width < 480
      const scale = changeScale(entries, faceted || narrow ? 4 : 6, bounds)
      // 'United Kingdom' at 13.5px needs the extra 8px on a phone.
      const marginLeft = narrow ? 112 : 128
      const marginRight = faceted ? 24 : narrow ? 60 : 72
      const [lo, hi] = scale.domain
      return Plot.plot({
        // Never shorter than four rows: the ticks clear the first row and
        // the zero rule is never a stub.
        height: 60 + Math.max(countryDomain.length, MIN_ROWS) * ROW_HEIGHT,
        width,
        marginLeft,
        marginRight,
        marginTop: faceted ? 44 : 60,
        style: {
          fontFamily: FONT_FAMILY,
          fontSize: '11px',
          background: 'transparent',
          color: INK_SECONDARY,
        },
        x: {
          domain: scale.domain,
          ticks: scale.ticks,
          tickFormat: (tick: number) => (tick > 0 ? `+${scale.format(tick)}` : scale.format(tick)),
          axis: 'top',
          label: null,
          grid: true,
        },
        y: { domain: countryDomain },
        ...(faceted
          ? {
              fx: {
                domain: legs.map(legTitle),
                label: null,
                axis: 'top',
                paddingInner: FACET_PADDING,
              },
            }
          : {}),
        marks: [
          // Country labels at 13.5 in ink (§6); the value axis stays 11px.
          Plot.axisY({ tickSize: 0, label: null, fontSize: 13.5, fill: INK }),
          ...(faceted ? [Plot.frame({ stroke: 'var(--grid)' })] : []),
          // Zero, visible and marked in every panel.
          Plot.ruleX([0], { stroke: INK, strokeWidth: 1 }),
          ...dotMarks(entries, color, facetChannel, lo),
          ...(faceted
            ? []
            : [
                Plot.text(entries, {
                  y: 'level',
                  x: hi,
                  text: (entry: DotEntry) => formatEstimate(entry.row.estimate, entry.row.stat),
                  dx: 16,
                  textAnchor: 'start',
                  fill: INK,
                  fontSize: 14,
                  fontWeight: 500,
                }),
              ]),
        ],
      })
    },
    [rows, meta, color, countryDomain, legs, bounds],
  )

  return <div ref={container} />
}
