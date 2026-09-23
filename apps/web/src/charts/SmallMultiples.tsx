// One panel per country for outcome × demographic (§2.6): faceted dot
// plots with shared scales, sortable by estimate, name, or the gap
// between levels. A second breakdown becomes a facet-column grid — one
// hue everywhere, so identity never rides on color for 4+ levels.
// Every cell is shown (ADR-0011). The facet column defaults to country;
// What Matters facets a single country's items by age band instead.

import * as Plot from '@observablehq/plot'
import type { EstimateRow, Meta, ResponseMeta, VariableSummary } from '../api/types'
import { groupValueLabel } from '../labels'
import type { SortDir } from '../sortRows'
import { dotEntries, dotMarks, type LevelLabeler } from './DotPlot'
import { ciExtents, fittedScale } from './domain'
import { FONT_FAMILY, INK, INK_SECONDARY, plotValue } from './theme'
import { chartWidth, usePlot } from './usePlot'

export type PanelSort = 'estimate' | 'name' | 'gap'

/** Facet (country) order under each sort rule and direction — the one
 * ordering the panels and the data table both consume. */
export function facetOrder(
  rows: EstimateRow[],
  meta: Meta,
  facetColumn: string,
  sort: PanelSort,
  dir: SortDir = sort === 'name' ? 'asc' : 'desc',
): string[] {
  const byFacet = new Map<string, number[]>()
  for (const row of rows) {
    const label = groupValueLabel(facetColumn, row.group[facetColumn] ?? null, meta)
    const value = plotValue(row)
    const bucket = byFacet.get(label) ?? []
    if (value !== null) bucket.push(value)
    byFacet.set(label, bucket)
  }
  const labels = [...byFacet.keys()]
  if (sort === 'name') {
    const sign = dir === 'asc' ? 1 : -1
    return labels.sort((a, b) => sign * a.localeCompare(b))
  }
  const score = (label: string): number => {
    const values = byFacet.get(label) ?? []
    if (values.length === 0) return -Infinity
    if (sort === 'gap') return Math.max(...values) - Math.min(...values)
    return values.reduce((sum, value) => sum + value, 0) / values.length
  }
  const sign = dir === 'desc' ? 1 : -1
  return labels.sort((a, b) => sign * (score(b) - score(a)) || a.localeCompare(b))
}

export function SmallMultiples({
  rows,
  meta,
  responseMeta,
  variable,
  color,
  levelColumn,
  levelDomain,
  seriesColumn,
  seriesDomain,
  sort,
  dir,
  labeler,
  facetColumn = 'country_code',
  facetDomain,
  labelWidth,
}: {
  rows: EstimateRow[]
  meta: Meta
  responseMeta: ResponseMeta
  variable: VariableSummary
  color: string
  /** The demographic on each panel's y axis. */
  levelColumn: string
  levelDomain: string[]
  /** One panel per value of this group column (country by default). */
  facetColumn?: string
  /** Panel order when it is served, not sorted (a demographic's levels). */
  facetDomain?: string[]
  /** Room for the row labels, when they run longer than a demographic's
   * levels (What Matters' item names); the phone keeps its own margin. */
  labelWidth?: number
  /** Optional second breakdown → facet columns (one hue, no legend). */
  seriesColumn?: string
  seriesDomain?: string[]
  sort: PanelSort
  dir?: SortDir
  labeler?: LevelLabeler
}) {
  const container = usePlot(
    (available) => {
      const entries = dotEntries(rows, meta, levelColumn, facetColumn, labeler).map((entry) => ({
        ...entry,
        series: seriesColumn
          ? groupValueLabel(seriesColumn, entry.row.group[seriesColumn] ?? null, meta, labeler)
          : '',
      }))
      const facets = facetDomain ?? facetOrder(rows, meta, facetColumn, sort, dir)
      const isShare = responseMeta.stat === 'proportion' || responseMeta.stat === 'distribution'
      // One shared, data-fitted window across every panel (F1): shared so
      // panels stay comparable, fitted so the variation is visible — and
      // its ticks repeat inside each panel, so no panel is read against an
      // axis 23 rows away.
      const width = chartWidth(seriesColumn ? 820 : 700, available)
      const narrow = width < 480
      const scale = fittedScale(ciExtents(entries.filter((entry) => entry.value !== null)), {
        // Fewer ticks when a second breakdown splits the width into columns.
        targetTicks: seriesColumn || narrow ? 4 : 5,
      })
      const tickLabel = (tick: number) => (isShare ? `${scale.format(tick)}%` : scale.format(tick))
      const panelHeight = levelDomain.length * 22 + 48
      const facetChannel: Record<string, string> = seriesColumn
        ? { fy: 'facet', fx: 'series' }
        : { fy: 'facet' }
      return Plot.plot({
        height: 76 + facets.length * panelHeight,
        width,
        marginLeft: narrow ? 90 : (labelWidth ?? 150),
        marginRight: narrow ? 92 : 110,
        marginTop: 60,
        style: {
          fontFamily: FONT_FAMILY,
          fontSize: '11px',
          background: 'transparent',
          color: INK_SECONDARY,
        },
        x: {
          domain: scale.domain,
          ticks: scale.ticks,
          tickFormat: tickLabel,
          axis: 'top',
          label: null,
          grid: true,
        },
        y: { domain: levelDomain, label: null, tickSize: 0 },
        fy: { domain: facets, paddingInner: 0.12 },
        ...(seriesColumn ? { fx: { domain: seriesDomain, label: null } } : {}),
        marks: [
          // Facet (country) labels at 13.5 in ink (§6); panel-level level
          // labels and the value axis stay the 11px plot size.
          Plot.axisFy({ label: null, fontSize: 13.5, fill: INK }),
          Plot.frame({ stroke: 'var(--grid)' }),
          // No facet channel → drawn in every panel, like Plot.frame: the
          // shared axis, labelled under each panel.
          Plot.text(scale.ticks, {
            x: (tick: number) => tick,
            text: tickLabel,
            frameAnchor: 'bottom',
            dy: -3,
            fill: INK_SECONDARY,
            fontSize: 11,
          }),
          ...dotMarks(entries, color, facetChannel, scale.domain[0]),
        ],
      })
    },
    [
      rows,
      meta,
      responseMeta,
      variable,
      color,
      levelColumn,
      levelDomain,
      seriesColumn,
      seriesDomain,
      sort,
      dir,
      labeler,
      facetColumn,
      facetDomain,
      labelWidth,
    ],
  )

  return <div ref={container} />
}
