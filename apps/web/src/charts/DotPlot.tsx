// Dots with CI whiskers for compact comparisons (breakdown levels within
// one panel). One hue; the level axis carries identity. Suppressed
// levels render as text with their n, in place.

import * as Plot from '@observablehq/plot'
import type { EstimateRow, Meta, ResponseMeta, VariableSummary } from '../api/types'
import { formatCount } from '../format'
import { groupValueLabel } from '../labels'
import { ciExtents, fittedScale } from './domain'
import {
  FONT_FAMILY,
  INK_SECONDARY,
  ROW_HEIGHT,
  WHISKER,
  plotCI,
  plotValue,
  tipText,
} from './theme'
import { chartWidth, usePlot } from './usePlot'

export interface DotEntry {
  row: EstimateRow
  /** y — the breakdown level's display label. */
  level: string
  /** fy — the facet label (country), when faceted. */
  facet: string
  value: number | null
  ci: [number, number] | null
}

export type LevelLabeler = (column: string, value: string | number) => string | undefined

export function dotEntries(
  rows: EstimateRow[],
  meta: Meta,
  levelColumn: string,
  facetColumn: string | null,
  labeler?: LevelLabeler,
): DotEntry[] {
  return rows.map((row) => ({
    row,
    level: groupValueLabel(levelColumn, row.group[levelColumn] ?? null, meta, labeler),
    facet: facetColumn
      ? groupValueLabel(facetColumn, row.group[facetColumn] ?? null, meta, labeler)
      : '',
    value: row.suppressed ? null : plotValue(row),
    ci: row.suppressed ? null : plotCI(row),
  }))
}

export function dotMarks(
  entries: DotEntry[],
  color: string,
  threshold: number,
  facetChannel: Record<string, string> = {},
  /** Where "withheld" text anchors — the domain's left edge, not 0,
   * when the window is data-fitted (F1). */
  suppressedX = 0,
) {
  const valid = entries.filter((entry) => entry.value !== null)
  const suppressed = entries.filter((entry) => entry.row.suppressed)
  return [
    Plot.ruleY(
      valid.filter((entry) => entry.ci !== null),
      {
        ...facetChannel,
        y: 'level',
        x1: (entry: DotEntry) => entry.ci?.[0],
        x2: (entry: DotEntry) => entry.ci?.[1],
        stroke: WHISKER,
        strokeWidth: 1.5,
      },
    ),
    Plot.dot(valid, {
      ...facetChannel,
      y: 'level',
      x: 'value',
      fill: color,
      r: 4.5,
      stroke: 'var(--surface)',
      strokeWidth: 2,
    }),
    Plot.text(suppressed, {
      ...facetChannel,
      y: 'level',
      x: suppressedX,
      dx: 4,
      text: (entry: DotEntry) => `withheld (n = ${formatCount(entry.row.n)})`,
      textAnchor: 'start',
      fill: INK_SECONDARY,
      fontSize: 11,
    }),
    Plot.text(
      valid.filter((entry) => entry.row.flagged),
      {
        ...facetChannel,
        y: 'level',
        x: (entry: DotEntry) => entry.ci?.[1] ?? entry.value,
        text: () => '†',
        dx: 10,
        fill: 'var(--warn-text)',
        fontSize: 12,
      },
    ),
    Plot.tip(
      entries,
      Plot.pointerY({
        ...facetChannel,
        y: 'level',
        x: (entry: DotEntry) => entry.value ?? suppressedX,
        title: (entry: DotEntry) =>
          tipText(
            entry.row,
            entry.facet ? `${entry.facet} · ${entry.level}` : entry.level,
            threshold,
          ),
        fontFamily: FONT_FAMILY,
      }),
    ),
  ]
}

export function DotPlot({
  rows,
  meta,
  responseMeta,
  variable,
  color,
  levelColumn,
  levelDomain,
  labeler,
}: {
  rows: EstimateRow[]
  meta: Meta
  responseMeta: ResponseMeta
  variable: VariableSummary
  color: string
  levelColumn: string
  levelDomain: string[]
  labeler?: LevelLabeler
}) {
  const container = usePlot(
    (available) => {
      const entries = dotEntries(rows, meta, levelColumn, null, labeler)
      const isShare = responseMeta.stat === 'proportion' || responseMeta.stat === 'distribution'
      const scale = fittedScale(ciExtents(entries.filter((entry) => entry.value !== null)), {
        targetTicks: 6,
      })
      const width = chartWidth(660, available)
      return Plot.plot({
        height: 44 + levelDomain.length * ROW_HEIGHT,
        width,
        marginLeft: width < 480 ? 100 : 150,
        marginRight: 40,
        style: {
          fontFamily: FONT_FAMILY,
          fontSize: '12px',
          background: 'transparent',
          color: INK_SECONDARY,
        },
        x: {
          domain: scale.domain,
          ticks: scale.ticks,
          label: null,
          grid: true,
          tickFormat: isShare ? (d: number) => `${scale.format(d)}%` : scale.format,
        },
        y: { domain: levelDomain, label: null, tickSize: 0 },
        marks: dotMarks(entries, color, responseMeta.suppression.threshold, {}, scale.domain[0]),
      })
    },
    [rows, meta, responseMeta, variable, color, levelColumn, levelDomain, labeler],
  )

  return <div ref={container} />
}
