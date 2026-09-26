// Ranked countries, one series, one hue (no legend — the title names
// it), a hover tip carrying estimate, CI and n, and a direct value label
// on every row (F16). Two marks by scale (F1 / ADR-0010 revised): shares
// keep zero-based bars; 0–10 location stats (means, medians) render as
// dot + CI on a data-fitted window whose edges are always labelled
// ticks, with the axis on top so the window is stated before the rows.
// Every cell is shown (ADR-0011); a row with no computable interval
// draws its dot without a whisker, and a missing value reads "—".
// Never fetches.

import * as Plot from '@observablehq/plot'
import type { EstimateRow, Meta, ResponseMeta, VariableSummary } from '../api/types'
import { formatEstimate } from '../format'
import { groupValueLabel } from '../labels'
import { ciExtents, fittedScale, measureBounds } from './domain'
import {
  BAR_RADIUS,
  FONT_FAMILY,
  INK,
  INK_SECONDARY,
  MIN_ROWS,
  ROW_HEIGHT,
  TIP_OPTIONS,
  WHISKER,
  plotCI,
  plotValue,
  tipText,
  whiskerOverBars,
} from './theme'
import { chartWidth, usePlot } from './usePlot'

interface Entry {
  row: EstimateRow
  label: string
  value: number | null
  ci: [number, number] | null
}

/** Rows arrive already ordered (src/sortRows.ts — the same order the
 * data table renders); the chart never re-sorts. Rows are countries
 * unless another group column is named (the US States view's `state`,
 * whose codes are the server's own labels) or the caller labels rows
 * itself (the Correlates view: one measure per row, named from the
 * catalog). */
export function rankEntries(
  rows: EstimateRow[],
  meta: Meta,
  labelColumn = 'country_code',
  labelOf?: (row: EstimateRow) => string,
): Entry[] {
  return rows.map((row) => ({
    row,
    label: labelOf
      ? labelOf(row)
      : groupValueLabel(labelColumn, row.group[labelColumn] ?? null, meta),
    value: plotValue(row),
    ci: plotCI(row),
  }))
}

/** A reference estimate drawn as a dashed rule with its label (the US
 * overall figure behind the states). */
export interface Reference {
  value: number
  label: string
}

export function RankedBar({
  rows,
  meta,
  responseMeta,
  variable,
  color,
  levelLabel,
  labelColumn = 'country_code',
  labelOf,
  colorOf,
  zeroRule = false,
  labelWidth,
  labelFontSize = 13.5,
  reference,
  axisTitle,
}: {
  rows: EstimateRow[]
  meta: Meta
  responseMeta: ResponseMeta
  variable: VariableSummary
  color: string
  levelLabel?: string
  /** The group column that names each row (country by default). */
  labelColumn?: string
  /** Names rows itself (takes precedence over `labelColumn`). */
  labelOf?: (row: EstimateRow) => string
  /** Per-row hue (a signed quantity: rust below zero, teal above). */
  colorOf?: (row: EstimateRow) => string
  /** A signed quantity: keep zero in the window and rule it in ink. */
  zeroRule?: boolean
  /** Room for the row labels; the default fits country names, measure
   * names (the Correlates view) need more. */
  labelWidth?: number
  /** Row-label size: 13.5 by default; 12 (the chart ladder's small step)
   * lets long measure names fit a phone column without the chart
   * shrinking or scrolling. */
  labelFontSize?: number
  /** A reference figure to draw as a dashed rule (already plot-scaled). */
  reference?: Reference
  /** A title for the value axis (fitted-window charts; absent = none). */
  axisTitle?: string
}) {
  const container = usePlot(
    (available) => {
      const entries = rankEntries(rows, meta, labelColumn, labelOf)
      const fillOf = (entry: Entry) => (colorOf ? colorOf(entry.row) : color)
      const referenceMarks = reference
        ? [
            Plot.ruleX([reference.value], { stroke: INK, strokeDasharray: '3 3' }),
            Plot.text([reference.value], {
              x: (value: number) => value,
              text: () => reference.label,
              frameAnchor: 'bottom',
              dy: 14,
              fill: INK_SECONDARY,
              fontSize: 11,
            }),
          ]
        : []
      const domain = entries.map((entry) => entry.label)
      const valid = entries.filter((entry) => entry.value !== null)
      const isShare = responseMeta.stat === 'proportion' || responseMeta.stat === 'distribution'
      const style = {
        fontFamily: FONT_FAMILY,
        fontSize: '11px',
        background: 'transparent',
        color: INK_SECONDARY,
      }
      const width = chartWidth(660, available)
      const narrow = width < 480
      const marginLeft = labelWidth ?? (narrow ? 104 : 128)
      // Sized for the value column (14px, 12px on a phone), 16px off the
      // plot's right edge (§5).
      const marginRight = narrow ? 56 : 72
      const valueFontSize = narrow ? 12 : 14
      // Never shorter than four rows: the top ticks clear the first row
      // and a zero rule is never a stub.
      const height = 44 + Math.max(entries.length, MIN_ROWS) * ROW_HEIGHT
      const valueOf = (entry: Entry) => formatEstimate(entry.row.estimate, entry.row.stat)

      if (!isShare) {
        // Location stats on a bounded scale: dot + CI on a fitted window.
        const scale = fittedScale(
          [...ciExtents(valid), ...(reference ? [reference.value] : []), ...(zeroRule ? [0] : [])],
          { targetTicks: narrow ? 5 : 7, bounds: measureBounds(responseMeta.stat, variable) },
        )
        const [lo, hi] = scale.domain
        return Plot.plot({
          height: height + 16 + (reference ? 18 : 0),
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
            label: axisTitle ?? null,
            labelAnchor: 'center',
            labelOffset: 44,
            grid: true,
          },
          y: { domain },
          marks: [
            // Country labels at 13.5 in ink (§6); the value axis stays 11px.
            Plot.axisY({ tickSize: 0, label: null, fontSize: labelFontSize, fill: INK }),
            Plot.ruleY(
              valid.filter((entry) => entry.ci !== null),
              {
                y: 'label',
                x1: (entry: Entry) => entry.ci?.[0],
                x2: (entry: Entry) => entry.ci?.[1],
                stroke: WHISKER,
                strokeWidth: 1.5,
                clip: true,
              },
            ),
            ...(zeroRule ? [Plot.ruleX([0], { stroke: INK })] : []),
            Plot.dot(valid, {
              y: 'label',
              x: 'value',
              fill: fillOf,
              r: 4.5,
              stroke: 'var(--surface)',
              strokeWidth: 2,
            }),
            Plot.text(entries, {
              y: 'label',
              x: hi,
              text: valueOf,
              dx: 16,
              textAnchor: 'start',
              fill: INK,
              fontSize: valueFontSize,
              fontWeight: 500,
            }),
            Plot.tip(
              entries,
              Plot.pointerY({
                y: 'label',
                x: (entry: Entry) => entry.value ?? lo,
                title: (entry: Entry) => tipText(entry.row, entry.label),
                ...TIP_OPTIONS,
              }),
            ),
            ...referenceMarks,
          ],
        })
      }

      // Shares: zero-based bars (a length encoding needs its baseline).
      const xMax = Math.max(
        10,
        ...valid.map((entry) => (entry.ci?.[1] ?? entry.value ?? 0) * 1.05),
        (reference?.value ?? 0) * 1.05,
      )
      return Plot.plot({
        height: height + (reference ? 18 : 0),
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
        y: { domain },
        marks: [
          Plot.axisY({ tickSize: 0, label: null, fontSize: labelFontSize, fill: INK }),
          Plot.barX(valid, {
            y: 'label',
            x: 'value',
            fill: color,
            rx2: BAR_RADIUS,
            insetTop: 3,
            insetBottom: 3,
          }),
          // The whisker over a bar: a thin ink rule with end caps, so it
          // reads on the bar's own hue.
          ...whiskerOverBars(
            valid.filter((entry) => entry.ci !== null),
            {
              y: 'label',
              x1: (entry: Entry) => entry.ci?.[0],
              x2: (entry: Entry) => entry.ci?.[1],
            },
          ),
          Plot.text(entries, {
            y: 'label',
            x: xMax,
            text: valueOf,
            dx: 16,
            textAnchor: 'start',
            fill: INK,
            fontSize: valueFontSize,
            fontWeight: 500,
          }),
          Plot.tip(
            entries,
            Plot.pointerY({
              y: 'label',
              x: (entry: Entry) => entry.value ?? 0,
              title: (entry: Entry) => tipText(entry.row, entry.label),
              ...TIP_OPTIONS,
            }),
          ),
          ...referenceMarks,
        ],
      })
    },
    [
      rows,
      meta,
      responseMeta,
      variable,
      color,
      levelLabel,
      labelColumn,
      labelOf,
      colorOf,
      zeroRule,
      labelWidth,
      labelFontSize,
      reference,
      axisTitle,
    ],
  )

  return <div ref={container} />
}
