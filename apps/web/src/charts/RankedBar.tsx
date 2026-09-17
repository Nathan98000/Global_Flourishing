// Ranked countries, one series, one hue (no legend — the title names
// it), suppression rendered in place, the small-cell dagger, a hover tip
// carrying estimate, CI, n and weight, and a direct value label on every
// row (F16). Two marks by scale (F1 / ADR-0010 revised): shares keep
// zero-based bars; 0–10 location stats (means, medians) render as dot +
// CI on a data-fitted window whose edges are always labelled ticks, with
// the axis on top so the window is stated before the rows. Never fetches.

import * as Plot from '@observablehq/plot'
import type { EstimateRow, Meta, ResponseMeta, VariableSummary } from '../api/types'
import { formatCount, formatEstimate } from '../format'
import { groupValueLabel } from '../labels'
import { ciExtents, fittedScale } from './domain'
import {
  BAR_RADIUS,
  FONT_FAMILY,
  INK,
  INK_SECONDARY,
  ROW_HEIGHT,
  SUPPRESSED_HATCH_FILL,
  WHISKER,
  plotCI,
  plotValue,
  tipText,
} from './theme'
import { chartWidth, usePlot } from './usePlot'

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
  const container = usePlot(
    (available) => {
      const entries = rankEntries(rows, meta, sort)
      const domain = entries.map((entry) => entry.label)
      const valid = entries.filter((entry) => entry.value !== null)
      const suppressed = entries.filter((entry) => entry.row.suppressed)
      const isShare = responseMeta.stat === 'proportion' || responseMeta.stat === 'distribution'
      const threshold = responseMeta.suppression.threshold
      const style = {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        background: 'transparent',
        color: INK_SECONDARY,
      }
      const width = chartWidth(660, available)
      const narrow = width < 480
      const marginLeft = narrow ? 104 : 128
      const marginRight = narrow ? 52 : 64
      const height = 44 + entries.length * ROW_HEIGHT
      const valueOf = (entry: Entry) =>
        formatEstimate(entry.row.estimate, entry.row.stat) + (entry.row.flagged ? ' †' : '')

      if (!isShare) {
        // Location stats on a bounded scale: dot + CI on a fitted window.
        const scale = fittedScale(ciExtents(valid), { targetTicks: narrow ? 5 : 7 })
        const [lo, hi] = scale.domain
        return Plot.plot({
          height: height + 16,
          width,
          marginLeft,
          marginRight,
          marginTop: 60,
          style,
          x: {
            domain: scale.domain,
            ticks: scale.ticks,
            tickFormat: scale.format,
            axis: 'top',
            label: null,
            grid: true,
          },
          y: { domain, label: null, tickSize: 0 },
          marks: [
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
            Plot.dot(valid, {
              y: 'label',
              x: 'value',
              fill: color,
              r: 4.5,
              stroke: 'var(--surface)',
              strokeWidth: 2,
            }),
            Plot.text(suppressed, {
              y: 'label',
              x: lo,
              text: (entry: Entry) => `withheld (n = ${formatCount(entry.row.n)})`,
              textAnchor: 'start',
              fill: INK_SECONDARY,
              fontSize: 11,
            }),
            Plot.text(valid, {
              y: 'label',
              x: hi,
              text: valueOf,
              dx: 8,
              textAnchor: 'start',
              fill: INK,
              fontSize: 12,
              fontWeight: 600,
            }),
            Plot.tip(
              entries,
              Plot.pointerY({
                y: 'label',
                x: (entry: Entry) => entry.value ?? lo,
                title: (entry: Entry) => tipText(entry.row, entry.label, threshold),
                fontFamily: FONT_FAMILY,
              }),
            ),
          ],
        })
      }

      // Shares: zero-based bars (a length encoding needs its baseline).
      const xMax = Math.max(10, ...valid.map((entry) => (entry.ci?.[1] ?? entry.value ?? 0) * 1.05))
      return Plot.plot({
        height,
        width,
        marginLeft,
        marginRight,
        style,
        x: {
          domain: [0, xMax],
          label: null,
          grid: true,
          tickFormat: (d: number) => `${d}%`,
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
          Plot.text(valid, {
            y: 'label',
            x: xMax,
            text: valueOf,
            dx: 8,
            textAnchor: 'start',
            fill: INK,
            fontSize: 12,
            fontWeight: 600,
          }),
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
    },
    [rows, meta, responseMeta, variable, color, sort, levelLabel],
  )

  return <div ref={container} />
}
