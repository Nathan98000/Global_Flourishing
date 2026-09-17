// One panel per country for outcome × demographic (§2.6): faceted dot
// plots with shared scales, sortable by estimate, name, or the gap
// between levels. A second breakdown becomes a facet-column grid — one
// hue everywhere, so identity never rides on color for 4+ levels.

import * as Plot from '@observablehq/plot'
import type { EstimateRow, Meta, ResponseMeta, VariableSummary } from '../api/types'
import { groupValueLabel } from '../labels'
import { dotEntries, dotMarks, type LevelLabeler } from './DotPlot'
import { FONT_FAMILY, INK_SECONDARY, axisLabel, plotValue } from './theme'
import { usePlot } from './usePlot'

export type PanelSort = 'estimate' | 'name' | 'gap'

/** Facet (country) order under each sort rule. */
export function facetOrder(
  rows: EstimateRow[],
  meta: Meta,
  facetColumn: string,
  sort: PanelSort,
): string[] {
  const byFacet = new Map<string, number[]>()
  for (const row of rows) {
    const label = groupValueLabel(facetColumn, row.group[facetColumn] ?? null, meta)
    const value = row.suppressed ? null : plotValue(row)
    const bucket = byFacet.get(label) ?? []
    if (value !== null) bucket.push(value)
    byFacet.set(label, bucket)
  }
  const labels = [...byFacet.keys()]
  if (sort === 'name') return labels.sort((a, b) => a.localeCompare(b))
  const score = (label: string): number => {
    const values = byFacet.get(label) ?? []
    if (values.length === 0) return -Infinity
    if (sort === 'gap') return Math.max(...values) - Math.min(...values)
    return values.reduce((sum, value) => sum + value, 0) / values.length
  }
  return labels.sort((a, b) => score(b) - score(a) || a.localeCompare(b))
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
  labeler,
}: {
  rows: EstimateRow[]
  meta: Meta
  responseMeta: ResponseMeta
  variable: VariableSummary
  color: string
  /** The demographic on each panel's y axis. */
  levelColumn: string
  levelDomain: string[]
  /** Optional second breakdown → facet columns (one hue, no legend). */
  seriesColumn?: string
  seriesDomain?: string[]
  sort: PanelSort
  labeler?: LevelLabeler
}) {
  const container = usePlot(() => {
    const entries = dotEntries(rows, meta, levelColumn, 'country_code', labeler).map((entry) => ({
      ...entry,
      series: seriesColumn
        ? groupValueLabel(seriesColumn, entry.row.group[seriesColumn] ?? null, meta, labeler)
        : '',
    }))
    const facets = facetOrder(rows, meta, 'country_code', sort)
    const isShare = responseMeta.stat === 'proportion' || responseMeta.stat === 'distribution'
    const maxX = Math.max(10, ...entries.map((entry) => entry.ci?.[1] ?? entry.value ?? 0)) * 1.05
    const panelHeight = levelDomain.length * 22 + 34
    const facetChannel: Record<string, string> = seriesColumn
      ? { fy: 'facet', fx: 'series' }
      : { fy: 'facet' }
    return Plot.plot({
      height: 60 + facets.length * panelHeight,
      width: seriesColumn ? 820 : 700,
      marginLeft: 150,
      marginRight: 110,
      style: {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        background: 'transparent',
        color: INK_SECONDARY,
      },
      x: {
        label: axisLabel(variable, responseMeta),
        labelAnchor: 'center',
        grid: true,
        tickFormat: isShare ? (d: number) => `${d}%` : undefined,
        ...(isShare ? { domain: [0, maxX] } : {}),
      },
      y: { domain: levelDomain, label: null, tickSize: 0 },
      fy: { domain: facets, label: null },
      ...(seriesColumn ? { fx: { domain: seriesDomain, label: null } } : {}),
      marks: [
        Plot.frame({ stroke: 'var(--grid)' }),
        ...dotMarks(entries, color, responseMeta.suppression.threshold, facetChannel),
      ],
    })
  }, [
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
    labeler,
  ])

  return <div ref={container} />
}
