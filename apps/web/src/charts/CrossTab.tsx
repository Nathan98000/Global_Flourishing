// Compare two's heat grid (ADR-0019): a column-percent cross-tab of two
// questions in one Observable Plot SVG, so the PNG export carries all of
// it. Columns are the first question's answers, least to most; rows are
// the second's, the most at the top. Each cell is the share of its
// column's people who gave the row's answer ("57%", "<1%"), tinted on the
// sequential ramp in fixed bins — the same shade is the same share in
// every pair — its ink the ramp step's own. A cell few people are behind
// wears an asterisk and a dashed inner outline. Above the grid, one bar
// per column, aligned to it, shows the share of respondents who gave that
// answer, its caption beside the bars in the row labels' column. Both
// axes are titled. The layout is in pixels on a linear scale (not Plot's
// band axes) so the bars, the grid and every label share one x; under
// 520px each row's label moves onto its own line above the row, so the
// grid takes the full width. Tooltips are Plot's own tips. Never fetches.

import * as Plot from '@observablehq/plot'
import { textMeasurer, wrapLabel } from './RankedBar'
import {
  FONT_FAMILY,
  GRID,
  INK,
  INK_MUTED,
  INK_SECONDARY,
  SEQUENTIAL_RAMP,
  TIP_OPTIONS,
} from './theme'
import { tintInk } from './TransitionTable'
import { chartWidth, usePlot } from './usePlot'

/** The tint bins' lower edges, in percent: 0, 5, 10, 20, 30, 45, 60+. */
export const SHARE_BINS = [0, 5, 10, 20, 30, 45, 60] as const

/** A column share onto the seven sequential ramp tokens, in fixed bins
 * (never fitted to the pair). No share: no tint. */
export function shareTint(share: number | null): string {
  if (share === null) return 'transparent'
  const percent = share * 100
  let step = 0
  SHARE_BINS.forEach((edge, index) => {
    if (percent >= edge) step = index
  })
  return SEQUENTIAL_RAMP[step] ?? SEQUENTIAL_RAMP[0]
}

/** A share as the grid writes it: "57%"; "<1%" for a sliver, so nothing
 * above zero reads 0%. */
export function shareLabel(share: number): string {
  const percent = share * 100
  if (percent > 0 && percent < 1) return '<1%'
  return `${Math.round(percent)}%`
}

export interface CrossTabColumn {
  key: string
  label: string
  /** The share of respondents who gave this answer (0–1). */
  share: number
  flagged: boolean
  tip: string
}

export interface CrossTabRow {
  key: string
  label: string
}

export interface CrossTabCell {
  column: string
  row: string
  /** The share of the column's people who gave the row's answer (0–1);
   * null for a column nobody is in. */
  share: number | null
  flagged: boolean
  tip: string
}

const BAR_HEIGHT = 72
const BAR_HEIGHT_NARROW = 60
const LINE = 14
/** Under this width, row labels sit on their own line above each row. */
export const STACK_BELOW = 520

export function CrossTab({
  columns,
  rows,
  cells,
  xTitle,
  yTitle,
  barCaption,
}: {
  /** Left to right: the first question's answers, least to most. */
  columns: readonly CrossTabColumn[]
  /** Top to bottom: the second question's answers, most first. */
  rows: readonly CrossTabRow[]
  cells: readonly CrossTabCell[]
  /** Under the grid: the first question, and its scale's ends. */
  xTitle: string
  /** Over the row labels: the second question. */
  yTitle: string
  /** Beside the bars: what they show. */
  barCaption: string
}) {
  const container = usePlot(
    (available) => {
      const width = chartWidth(660, available)
      const stacked = width < STACK_BELOW
      const laidOut = available !== null
      const measure11 = textMeasurer(11, laidOut)
      const measure12 = textMeasurer(12, laidOut)
      const labelSize = stacked ? 12 : 12.5
      const measureLabel = textMeasurer(labelSize, laidOut)

      // The row labels' gutter (a desktop only): fitted to the longest
      // label, wrapped to three lines at most, never more than a third
      // of the chart; the bars' caption and the rows' title wrap in it.
      let marginLeft = 4
      let rowLines = rows.map((row) => [row.label])
      if (!stacked) {
        const cap = Math.min(220, Math.round(width * 0.34))
        rowLines = rows.map((row) => wrapLabel(row.label, cap - 12, measureLabel, 3))
        const widest = Math.max(0, ...rowLines.flat().map((line) => measureLabel(line)))
        marginLeft = Math.ceil(Math.max(96, Math.min(cap, widest + 12)))
      }
      const marginRight = 4
      const plotWidth = width - marginLeft - marginRight
      const columnWidth = plotWidth / Math.max(1, columns.length)
      const gutter = marginLeft - 12
      const captionLines = stacked
        ? wrapLabel(barCaption, plotWidth, measure12, 3)
        : wrapLabel(barCaption, gutter, measure12, 5)
      const titleLines = stacked
        ? wrapLabel(yTitle, plotWidth, measure12, 2)
        : wrapLabel(yTitle, gutter, measure12, 3)
      const tickLines = columns.map((column) =>
        wrapLabel(column.label, Math.max(20, columnWidth - 6), measure11, 4),
      )
      const xTitleLines = wrapLabel(xTitle, plotWidth - 8, measure12, 3)

      // Top to bottom, in pixels.
      const barHeight = stacked ? BAR_HEIGHT_NARROW : BAR_HEIGHT
      const captionTop = 4
      const barTop = stacked ? captionTop + captionLines.length * LINE + 22 : 22
      const barBase = barTop + barHeight
      const titleBottom = barBase + 8 + titleLines.length * LINE
      const cellHeight = stacked ? 30 : 32
      const labelRoom = stacked ? LINE + 4 : 0
      const gridTop = titleBottom + 8 + labelRoom
      const rowTop = (index: number) => gridTop + index * (cellHeight + labelRoom)
      const gridBottom = rowTop(rows.length) - labelRoom
      const ticksTop = gridBottom + 6
      const ticksBottom = ticksTop + Math.max(1, ...tickLines.map((lines) => lines.length)) * 13
      const height = ticksBottom + 10 + xTitleLines.length * LINE + 6

      const maxShare = Math.max(0.01, ...columns.map((column) => column.share))
      const columnIndex = new Map(columns.map((column, index) => [column.key, index]))
      const rowIndex = new Map(rows.map((row, index) => [row.key, index]))
      const bars = columns.map((column, index) => ({ ...column, index }))
      const grid = cells.flatMap((cell) => {
        const i = columnIndex.get(cell.column)
        const j = rowIndex.get(cell.row)
        return i === undefined || j === undefined ? [] : [{ ...cell, i, j }]
      })
      type GridCell = (typeof grid)[number]
      const barEnd = (share: number) => barBase - (share / maxShare) * barHeight
      const cellSize = columnWidth < 38 ? 10.5 : 12
      const star = (text: string, flagged: boolean) => (flagged ? `${text}*` : text)
      const left = { x: 0, dx: -marginLeft + 4, textAnchor: 'start' } as const

      return Plot.plot({
        width,
        height,
        marginLeft,
        marginRight,
        marginTop: 0,
        marginBottom: 0,
        style: { fontFamily: FONT_FAMILY, fontSize: '11px', background: 'transparent' },
        x: { domain: [0, Math.max(1, columns.length)], axis: null },
        y: { domain: [0, height], range: [0, height], axis: null },
        marks: [
          // The bars: who gave each of the first question's answers.
          Plot.ruleY([barBase], { x1: 0, x2: columns.length, stroke: GRID }),
          Plot.rect(bars, {
            x1: (bar: (typeof bars)[number]) => bar.index + 0.2,
            x2: (bar: (typeof bars)[number]) => bar.index + 0.8,
            y1: barBase,
            y2: (bar: (typeof bars)[number]) => barEnd(bar.share),
            fill: INK_MUTED,
          }),
          Plot.text(bars, {
            x: (bar: (typeof bars)[number]) => bar.index + 0.5,
            y: (bar: (typeof bars)[number]) => barEnd(bar.share) - 4,
            text: (bar: (typeof bars)[number]) => star(shareLabel(bar.share), bar.flagged),
            lineAnchor: 'bottom',
            fill: INK_SECONDARY,
            fontSize: 11,
          }),
          Plot.text([captionLines.join('\n')], {
            ...(stacked ? { x: 0, textAnchor: 'start' } : left),
            y: stacked ? captionTop : barBase - barHeight / 2,
            lineAnchor: stacked ? 'top' : 'middle',
            fill: INK_SECONDARY,
            fontSize: 12,
          }),
          // The rows' title, over their labels.
          Plot.text([titleLines.join('\n')], {
            ...(stacked ? { x: 0, textAnchor: 'start' } : left),
            y: titleBottom,
            lineAnchor: 'bottom',
            fill: INK,
            fontSize: 12.5,
            fontWeight: 600,
          }),
          // The grid: each cell tinted in fixed bins, its share in the
          // step's own ink, a flagged one outlined and starred.
          Plot.rect(grid, {
            x1: (cell: GridCell) => cell.i,
            x2: (cell: GridCell) => cell.i + 1,
            y1: (cell: GridCell) => rowTop(cell.j),
            y2: (cell: GridCell) => rowTop(cell.j) + cellHeight,
            inset: 1,
            fill: (cell: GridCell) => shareTint(cell.share),
          }),
          Plot.rect(
            grid.filter((cell) => cell.flagged && cell.share !== null),
            {
              x1: (cell: GridCell) => cell.i,
              x2: (cell: GridCell) => cell.i + 1,
              y1: (cell: GridCell) => rowTop(cell.j),
              y2: (cell: GridCell) => rowTop(cell.j) + cellHeight,
              inset: 4,
              fill: 'none',
              stroke: (cell: GridCell) => tintInk(shareTint(cell.share)) ?? INK_SECONDARY,
              strokeOpacity: 0.7,
              strokeDasharray: '3,2',
            },
          ),
          Plot.text(grid, {
            x: (cell: GridCell) => cell.i + 0.5,
            y: (cell: GridCell) => rowTop(cell.j) + cellHeight / 2,
            text: (cell: GridCell) =>
              cell.share === null ? '' : star(shareLabel(cell.share), cell.flagged),
            fill: (cell: GridCell) => tintInk(shareTint(cell.share)) ?? INK,
            fontSize: cellSize,
          }),
          // The rows' labels: beside the grid, or over each row.
          Plot.text(
            rows.map((_, index) => index),
            stacked
              ? {
                  x: 0,
                  y: (index: number) => rowTop(index) - 3,
                  text: (index: number) => rows[index]?.label ?? '',
                  textAnchor: 'start',
                  lineAnchor: 'bottom',
                  fill: INK,
                  fontSize: labelSize,
                }
              : {
                  x: 0,
                  y: (index: number) => rowTop(index) + cellHeight / 2,
                  dx: -8,
                  text: (index: number) => (rowLines[index] ?? []).join('\n'),
                  textAnchor: 'end',
                  lineAnchor: 'middle',
                  fill: INK,
                  fontSize: labelSize,
                },
          ),
          // The columns' labels, then the first question's title.
          Plot.text(bars, {
            x: (bar: (typeof bars)[number]) => bar.index + 0.5,
            y: ticksTop,
            text: (bar: (typeof bars)[number]) => (tickLines[bar.index] ?? []).join('\n'),
            lineAnchor: 'top',
            fill: INK,
            fontSize: 11,
          }),
          Plot.text([xTitleLines.join('\n')], {
            x: columns.length / 2,
            y: ticksBottom + 10,
            lineAnchor: 'top',
            fill: INK_SECONDARY,
            fontSize: 12,
          }),
          Plot.tip(
            grid,
            Plot.pointer({
              x: (cell: GridCell) => cell.i + 0.5,
              y: (cell: GridCell) => rowTop(cell.j) + cellHeight / 2,
              title: (cell: GridCell) => cell.tip,
              ...TIP_OPTIONS,
            }),
          ),
          Plot.tip(
            bars,
            Plot.pointer({
              x: (bar: (typeof bars)[number]) => bar.index + 0.5,
              y: (bar: (typeof bars)[number]) => barEnd(bar.share),
              title: (bar: (typeof bars)[number]) => bar.tip,
              ...TIP_OPTIONS,
            }),
          ),
        ],
      })
    },
    [columns, rows, cells, xTitle, yTitle, barCaption],
  )
  return <div ref={container} />
}
