// Compare (Phase 5): two to five countries — or one demographic's levels
// within each of them — across the six SFI domains, one panel per
// domain reading down the page, each in its fixed hue (proposal §4.4),
// dots with CI whiskers on one shared, fitted window. A dumbbell per
// domain beats a radar: a radar distorts magnitude and has no honest
// place for an interval. Rows are synthesized by the view with a
// `outcome` group column; every cell is shown (ADR-0011). Never fetches.

import * as Plot from '@observablehq/plot'
import type { EstimateRow, Meta } from '../api/types'
import { groupValueLabel } from '../labels'
import { dotMarks, type DotEntry, type LevelLabeler } from './DotPlot'
import { ciExtents, fittedScale } from './domain'
import { FONT_FAMILY, INK, INK_SECONDARY, outcomeColor, plotCI, plotValue } from './theme'
import { chartWidth, usePlot } from './usePlot'

export function compareEntries(
  rows: EstimateRow[],
  meta: Meta,
  outcomeLabel: (outcome: string) => string,
  split: string | undefined,
  labeler?: LevelLabeler,
): DotEntry[] {
  return rows.map((row) => {
    const country = groupValueLabel('country_code', row.group['country_code'] ?? null, meta)
    const outcome = String(row.group['outcome'] ?? '')
    return {
      row,
      facet: outcomeLabel(outcome),
      level: split ? groupValueLabel(split, row.group[split] ?? null, meta, labeler) : country,
      column: split ? country : undefined,
      value: plotValue(row),
      ci: plotCI(row),
    }
  })
}

export function CompareDomains({
  rows,
  meta,
  outcomes,
  outcomeLabel,
  units,
  split,
  splitDomain,
  labeler,
}: {
  rows: EstimateRow[]
  meta: Meta
  /** Panel order: the domain (or item) ids. */
  outcomes: readonly string[]
  outcomeLabel: (outcome: string) => string
  /** Country names in display order (the compared units, or the columns
   * when split). */
  units: string[]
  /** A demographic column: each country becomes a column of its levels. */
  split?: string
  splitDomain?: string[]
  labeler?: LevelLabeler
}) {
  const container = usePlot(
    (available) => {
      const entries = compareEntries(rows, meta, outcomeLabel, split, labeler)
      const panels = outcomes.map(outcomeLabel)
      const width = chartWidth(split ? 860 : 700, available)
      const narrow = width < 480
      const scale = fittedScale(ciExtents(entries.filter((entry) => entry.value !== null)), {
        targetTicks: split || narrow ? 4 : 6,
      })
      const yDomain = split ? (splitDomain ?? []) : units
      const panelHeight = yDomain.length * 22 + 64
      const facetChannel: Record<string, string> = split
        ? { fy: 'facet', fx: 'column' }
        : { fy: 'facet' }
      const color = (entry: DotEntry) => outcomeColor(String(entry.row.group['outcome'] ?? ''))
      return Plot.plot({
        height: 60 + panels.length * panelHeight,
        width,
        marginLeft: narrow ? 96 : 140,
        marginRight: narrow ? 24 : 40,
        marginTop: split ? 44 : 30,
        style: {
          fontFamily: FONT_FAMILY,
          fontSize: '11px',
          background: 'transparent',
          color: INK_SECONDARY,
        },
        x: {
          domain: scale.domain,
          ticks: scale.ticks,
          tickFormat: scale.format,
          axis: 'top',
          label: null,
          grid: true,
        },
        // Room at the top of each panel for its domain name.
        y: { domain: yDomain, label: null, tickSize: 0, insetTop: 24 },
        fy: { domain: panels, axis: null, paddingInner: 0.14 },
        ...(split ? { fx: { domain: units, label: null } } : {}),
        marks: [
          Plot.frame({ stroke: 'var(--grid)' }),
          // The panel's name, inside its frame, in ink — the server's
          // display name verbatim.
          Plot.text(panels, {
            fy: (panel: string) => panel,
            text: (panel: string) => panel,
            frameAnchor: 'top-left',
            dx: 6,
            dy: 6,
            textAnchor: 'start',
            fill: INK,
            fontSize: 13.5,
            fontWeight: 600,
          }),
          Plot.text(scale.ticks, {
            x: (tick: number) => tick,
            text: scale.format,
            frameAnchor: 'bottom',
            dy: -3,
            fill: INK_SECONDARY,
            fontSize: 11,
          }),
          Plot.axisY({ tickSize: 0, label: null, fontSize: 13.5, fill: INK }),
          ...dotMarks(entries, color, facetChannel, scale.domain[0]),
        ],
      })
    },
    [rows, meta, outcomes, outcomeLabel, units, split, splitDomain, labeler],
  )

  return <div ref={container} />
}
