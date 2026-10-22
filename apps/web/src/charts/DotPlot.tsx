// Dots with CI whiskers for compact comparisons (breakdown levels within
// one panel). One hue; the level axis carries identity. Every cell is
// shown (ADR-0011): a level with no computable interval draws its dot
// without a whisker, and its hover card says why; one few people are
// behind is drawn hollow (ADR-0031).

import * as Plot from '@observablehq/plot'
import type { EstimateRow, Meta, ResponseMeta, VariableSummary } from '../api/types'
import { columnLabel, groupValueLabel } from '../labels'
import { ciExtents, fittedScale, measureBounds } from './domain'
import {
  FONT_FAMILY,
  INK,
  INK_SECONDARY,
  MIN_ROWS,
  ROW_HEIGHT,
  TIP_OPTIONS,
  WHISKER,
  isThin,
  markFill,
  markStroke,
  plotCI,
  plotValue,
  tipText,
  type TipContext,
} from './theme'
import { chartWidth, usePlot } from './usePlot'

export interface DotEntry {
  row: EstimateRow
  /** y — the breakdown level's display label. */
  level: string
  /** fy — the facet label (country), when faceted. */
  facet: string
  /** fx — a column facet (a second breakdown), when faceted both ways. */
  column?: string
  value: number | null
  ci: [number, number] | null
  /** The hover card's heading and the line under it (theme.ts tipText);
   * absent, the facet, column and level name the dot in one line. */
  heading?: string
  detail?: string
}

/** A dot's hover card: what it is, then its value, CI and n. */
function dotTip(entry: DotEntry, context: TipContext): string {
  const heading =
    entry.heading ?? [entry.facet, entry.column, entry.level].filter(Boolean).join(' · ')
  return tipText(entry.row, heading, { ...context, detail: entry.detail })
}

export type LevelLabeler = (column: string, value: string | number) => string | undefined

export function dotEntries(
  rows: EstimateRow[],
  meta: Meta,
  levelColumn: string,
  facetColumn: string | null,
  labeler?: LevelLabeler,
): DotEntry[] {
  return rows.map((row) => {
    const level = groupValueLabel(levelColumn, row.group[levelColumn] ?? null, meta, labeler)
    const facet = facetColumn
      ? groupValueLabel(facetColumn, row.group[facetColumn] ?? null, meta, labeler)
      : ''
    return {
      row,
      level,
      facet,
      value: plotValue(row),
      ci: plotCI(row),
      // The card names the panel (a country), then the level by its
      // breakdown: "Indonesia", "Age band: 30–39".
      heading: facet || level,
      detail: facet ? `${columnLabel(levelColumn, meta)}: ${level}` : undefined,
    }
  })
}

export function dotMarks(
  entries: DotEntry[],
  color: string,
  facetChannel: Record<string, string> = {},
  /** Where the pointer anchors for a valueless row — the fitted
   * domain's left edge, not 0 (F1). */
  anchorX = 0,
  /** What the hover cards need to say what the values are. */
  tipContext: TipContext = {},
) {
  const valid = entries.filter((entry) => entry.value !== null)
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
        // A whisker past the measure's own limit is clipped at the frame.
        clip: true,
      },
    ),
    // A dot few people are behind is hollow (ADR-0031): the paper inside
    // a ring in the hue; every other dot solid in a surface ring.
    Plot.dot(valid, {
      ...facetChannel,
      y: 'level',
      x: 'value',
      fill: (entry: DotEntry) => markFill(entry.row, color),
      r: (entry: DotEntry) => (isThin(entry.row) ? 3.75 : 4.5),
      stroke: (entry: DotEntry) => markStroke(entry.row, color),
      strokeWidth: (entry: DotEntry) => (isThin(entry.row) ? 1.5 : 2),
    }),
    Plot.tip(
      entries,
      Plot.pointerY({
        ...facetChannel,
        y: 'level',
        x: (entry: DotEntry) => entry.value ?? anchorX,
        // Every facet value rides in the card: country, column, level.
        title: (entry: DotEntry) => dotTip(entry, tipContext),
        ...TIP_OPTIONS,
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
        bounds: measureBounds(responseMeta.stat, variable),
      })
      const width = chartWidth(660, available)
      return Plot.plot({
        // Never shorter than four rows: the ticks clear the first row.
        height: 44 + Math.max(levelDomain.length, MIN_ROWS) * ROW_HEIGHT,
        width,
        marginLeft: width < 480 ? 100 : 150,
        marginRight: 40,
        style: {
          fontFamily: FONT_FAMILY,
          fontSize: '11px',
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
        y: { domain: levelDomain },
        marks: [
          // Row labels at 13.5 in ink (§6) — identity at comparable weight
          // to the values, while the value axis stays the 11px plot size.
          Plot.axisY({ tickSize: 0, label: null, fontSize: 13.5, fill: INK }),
          ...dotMarks(entries, color, {}, scale.domain[0], { range: variable }),
        ],
      })
    },
    [rows, meta, responseMeta, variable, color, levelColumn, levelDomain, labeler],
  )

  return <div ref={container} />
}
