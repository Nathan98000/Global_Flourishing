// Ranked country bars with CI whiskers: one series, one hue (no legend —
// the title names it), thin bars rounded at the data end, suppression
// rendered in place as a hatched stub + "withheld (n = …)", the small-
// cell dagger on flagged bars, and a hover tip carrying estimate, CI,
// n and weight. Never fetches.

import * as Plot from '@observablehq/plot'
import type { EstimateRow, Meta, ResponseMeta, VariableSummary } from '../api/types'
import { formatCount, formatEstimate } from '../format'
import { groupValueLabel } from '../labels'
import {
  BAR_RADIUS,
  FONT_FAMILY,
  INK,
  INK_SECONDARY,
  ROW_HEIGHT,
  SUPPRESSED_HATCH_FILL,
  WHISKER,
  axisLabel,
  plotCI,
  plotValue,
  tipText,
} from './theme'
import { usePlot } from './usePlot'

interface Entry {
  row: EstimateRow
  label: string
  value: number | null
  ci: [number, number] | null
}

export function rankEntries(rows: EstimateRow[], meta: Meta, sort: 'estimate' | 'name'): Entry[] {
  const entries = rows.map((row) => ({
    row,
    label: groupValueLabel('country_code', row.group['country_code'] ?? null, meta),
    value: row.suppressed ? null : plotValue(row),
    ci: row.suppressed ? null : plotCI(row),
  }))
  if (sort === 'name') return entries.sort((a, b) => a.label.localeCompare(b.label))
  return entries.sort((a, b) => {
    if (a.value === null && b.value === null) return a.label.localeCompare(b.label)
    if (a.value === null) return 1
    if (b.value === null) return -1
    return b.value - a.value
  })
}

export function RankedBar({
  rows,
  meta,
  responseMeta,
  variable,
  color,
  sort,
  levelLabel,
}: {
  rows: EstimateRow[]
  meta: Meta
  responseMeta: ResponseMeta
  variable: VariableSummary
  color: string
  sort: 'estimate' | 'name'
  levelLabel?: string
}) {
  const container = usePlot(() => {
    const entries = rankEntries(rows, meta, sort)
    const domain = entries.map((entry) => entry.label)
    const valid = entries.filter((entry) => entry.value !== null)
    const suppressed = entries.filter((entry) => entry.row.suppressed)
    const isShare = responseMeta.stat === 'proportion' || responseMeta.stat === 'distribution'
    const xMax = isShare
      ? Math.max(10, ...valid.map((entry) => (entry.ci?.[1] ?? entry.value ?? 0) * 1.05))
      : (variable.max ?? Math.max(...valid.map((entry) => entry.value ?? 0)))
    const top = sort === 'estimate' ? valid[0] : null
    const threshold = responseMeta.suppression.threshold

    return Plot.plot({
      height: 44 + entries.length * ROW_HEIGHT,
      width: 660,
      marginLeft: 128,
      marginRight: 56,
      style: {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        background: 'transparent',
        color: INK_SECONDARY,
      },
      x: {
        domain: [0, xMax],
        label: axisLabel(variable, responseMeta, levelLabel),
        labelAnchor: 'center',
        grid: true,
        tickFormat: isShare ? (d: number) => `${d}%` : undefined,
      },
      y: { domain, label: null, tickSize: 0 },
      marks: [
        Plot.barX(valid, {
          y: 'label',
          x: 'value',
          fill: color,
          rx2: BAR_RADIUS,
          insetTop: 3,
          insetBottom: 3,
        }),
        Plot.ruleY(
          valid.filter((entry) => entry.ci !== null),
          {
            y: 'label',
            x1: (entry: Entry) => entry.ci?.[0],
            x2: (entry: Entry) => entry.ci?.[1],
            stroke: WHISKER,
            strokeWidth: 1.5,
          },
        ),
        Plot.barX(suppressed, {
          y: 'label',
          x: xMax * 0.035,
          fill: SUPPRESSED_HATCH_FILL,
          stroke: 'var(--suppressed-hatch)',
          strokeWidth: 0.5,
          insetTop: 5,
          insetBottom: 5,
        }),
        Plot.text(suppressed, {
          y: 'label',
          x: xMax * 0.045,
          text: (entry: Entry) => `withheld (n = ${formatCount(entry.row.n)})`,
          textAnchor: 'start',
          fill: INK_SECONDARY,
          fontSize: 11,
        }),
        Plot.text(
          valid.filter((entry) => entry.row.flagged),
          {
            y: 'label',
            x: (entry: Entry) => entry.ci?.[1] ?? entry.value,
            text: () => '†',
            dx: 10,
            fill: 'var(--warn-text)',
            fontSize: 12,
          },
        ),
        ...(top
          ? [
              Plot.text([top], {
                y: 'label',
                x: (entry: Entry) => entry.ci?.[1] ?? entry.value,
                text: (entry: Entry) => formatEstimate(entry.row.estimate, entry.row.stat),
                dx: top.row.flagged ? 22 : 8,
                textAnchor: 'start',
                fill: INK,
                fontSize: 12,
                fontWeight: 600,
              }),
            ]
          : []),
        Plot.tip(
          entries,
          Plot.pointerY({
            y: 'label',
            x: (entry: Entry) => entry.value ?? 0,
            title: (entry: Entry) => tipText(entry.row, entry.label, threshold),
            fontFamily: FONT_FAMILY,
          }),
        ),
      ],
    })
  }, [rows, meta, responseMeta, variable, color, sort, levelLabel])

  return <div ref={container} />
}
