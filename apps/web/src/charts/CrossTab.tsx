// Compare two's heat grid (ADR-0019): a column-percent cross-tab of two
// questions in one Observable Plot SVG, so the PNG export carries all of
// it. Columns are the first question's answers, least to most; rows are
// the second's, the most at the top. Each cell is the share of its
// column's people who gave the row's answer ("57%", "<1%"; the "%" left
// to the key in a column under 44px), tinted on the grid's nine-step ramp
// (the sequential ramp and two deeper steps, this grid's alone) in nine
// fixed bins that reach 90% — the same shade is the same share in every
// pair — its ink the ramp step's own. A cell few people are behind
// wears an asterisk and a dashed inner outline. Above the grid, one bar
// per column, aligned to it, shows the share of respondents who gave that
// answer. At every width the bars' caption runs on its own lines above
// the bars and the rows' title on its own lines above the grid, both from
// the chart's left edge (ADR-0020): the gutter beside the grid holds only
// the row labels, fitted to them, and no text is cut or capped at a line
// count. Under 520px each row's label moves onto its own lines above the
// row, so the grid takes the full width. The layout is in pixels on a
// linear scale (not Plot's band axes) so the bars, the grid and every
// label share one x; `crossTabLayout` computes it, pure, so a test can
// hold every line to its box. Tooltips are Plot's own tips. Never fetches.

import * as Plot from '@observablehq/plot'
import { textMeasurer, wrapLabel } from './RankedBar'
import { FONT_FAMILY, GRID, INK, INK_MUTED, INK_SECONDARY, SHARE_RAMP, TIP_OPTIONS } from './theme'
import { tintInk } from './TransitionTable'
import { chartWidth, usePlot } from './usePlot'

/** The tint bins' lower edges, in percent: 0, 5, 10, 20, 30, 45, 60, 75,
 * 90+ — reaching the top, so a yes/no answer most people give still
 * shows its differences (84% and 93% are two steps). */
export const SHARE_BINS = [0, 5, 10, 20, 30, 45, 60, 75, 90] as const

/** A column narrower than this writes its shares without "%" (the key
 * says it); the asterisk stays. */
export const PERCENT_BELOW = 44

/** A column share onto the grid's nine ramp tokens, in fixed bins (never
 * fitted to the pair). No share: no tint. */
export function shareTint(share: number | null): string {
  if (share === null) return 'transparent'
  const percent = share * 100
  let step = 0
  SHARE_BINS.forEach((edge, index) => {
    if (percent >= edge) step = index
  })
  return SHARE_RAMP[step] ?? SHARE_RAMP[0]
}

/** A share as the grid writes it: "57%"; "<1%" for a sliver, so nothing
 * above zero reads 0%; without the sign in a narrow column ("57", "<1"). */
export function shareLabel(share: number, sign = true): string {
  const percent = share * 100
  const unit = sign ? '%' : ''
  if (percent > 0 && percent < 1) return `<1${unit}`
  return `${Math.round(percent)}${unit}`
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

/** Under this width, row labels sit on their own lines above each row. */
export const STACK_BELOW = 520
/** A line of 12–12.5px text; the column labels (11px) take TICK_LINE. */
export const LINE = 14
const TICK_LINE = 13
/** The chart's side padding: text starts this far in from either edge. */
const EDGE = 4
/** Between a row label and the grid (a desktop's gutter). */
const LABEL_GAP = 8
/** Room above the tallest bar for its value label (11px, 4px above it). */
export const BAR_LABEL_ROOM = 22
/** A phone's row label, over its row: more room above it (from the row
 * before) than below it (to its own row), so it reads with its row
 * (review M9). */
export const STACKED_LABEL_ABOVE = 10
export const STACKED_LABEL_BELOW = 2
const BAR_HEIGHT = 72
const BAR_HEIGHT_NARROW = 60
const TITLE_SIZE = 12.5
const TITLE_WEIGHT = 600

/** One block of text, in the SVG's pixels: its lines, the box they are
 * wrapped to, and how it hangs there (`left` is the box's left edge;
 * a centred or right-anchored block is drawn at the box's centre or
 * right edge). */
export interface TextBlock {
  left: number
  top: number
  width: number
  lines: string[]
  fontSize: number
  lineHeight: number
  anchor: 'start' | 'middle' | 'end'
}

export interface CrossTabLayout {
  width: number
  height: number
  stacked: boolean
  marginLeft: number
  marginRight: number
  plotWidth: number
  columnWidth: number
  /** Whether the shares carry "%": a column of PERCENT_BELOW or wider. */
  percent: boolean
  /** The cells' share labels and the bars' labels: the largest size at
   * which the widest of them fits its column (a cell's inside its
   * flagged outline, whose inset tightens in a narrow column). */
  cellFontSize: number
  barFontSize: number
  flagInset: number
  /** Above the bars: what they show. */
  caption: TextBlock
  /** Above the grid: the second question. */
  title: TextBlock
  /** One per row: beside its row on a desktop, over it on a phone. */
  rowLabels: TextBlock[]
  /** One per column, under the grid. */
  ticks: TextBlock[]
  /** Under the ticks: the first question. */
  xTitle: TextBlock
  /** The tallest bar reaches barTop; every bar stands on barBase. */
  barTop: number
  barBase: number
  /** Each row's top edge; every cell is cellHeight tall. */
  rowTops: number[]
  cellHeight: number
}

/** A measurer for text of one size and weight. */
export type Measurer = (fontSize: number, weight?: number) => (text: string) => number

/** The largest of `sizes` (largest first) at which every text fits
 * `room`; the smallest when none does. */
function fittedSize(
  texts: readonly string[],
  room: number,
  sizes: readonly number[],
  measurer: Measurer,
): number {
  for (const size of sizes) {
    const measure = measurer(size)
    if (texts.every((text) => measure(text) <= room)) return size
  }
  return sizes[sizes.length - 1] ?? 9
}

const CELL_SIZES = [12, 11.5, 11, 10.5, 10, 9.5, 9] as const
const BAR_SIZES = [11, 10.5, 10, 9.5, 9] as const

function block(
  text: string,
  measure: (text: string) => number,
  box: Omit<TextBlock, 'lines'>,
): TextBlock {
  return { ...box, lines: wrapLabel(text, box.width, measure, Infinity) }
}

/** Where everything in the grid goes, top to bottom, in pixels. Every
 * text block is wrapped to its box with no cap on its lines (a lone word
 * wider than its box is the only thing that can overrun it); the boxes
 * never overlap, and the caption ends above the tallest bar's label. */
export function crossTabLayout({
  width,
  columns,
  rows,
  xTitle,
  yTitle,
  barCaption,
  cellTexts = [],
  barTexts = [],
  measurer,
}: {
  width: number
  columns: readonly Pick<CrossTabColumn, 'label'>[]
  rows: readonly Pick<CrossTabRow, 'label'>[]
  xTitle: string
  yTitle: string
  barCaption: string
  /** The cells' and the bars' labels as drawn ("57%", "<1%*"). */
  cellTexts?: readonly string[]
  barTexts?: readonly string[]
  measurer: Measurer
}): CrossTabLayout {
  const stacked = width < STACK_BELOW
  const labelSize = stacked ? 12 : 12.5
  const measureLabel = measurer(labelSize)
  const measureTitle = measurer(TITLE_SIZE, TITLE_WEIGHT)
  const full = width - 2 * EDGE
  const marginRight = EDGE

  // The gutter (a desktop only) holds nothing but the row labels: fitted
  // to the widest line of them, each wrapped to a third of the chart.
  let marginLeft = EDGE
  let rowLines: string[][] = []
  if (!stacked) {
    const cap = Math.min(220, Math.round(width * 0.34)) - LABEL_GAP - EDGE
    rowLines = rows.map((row) => wrapLabel(row.label, cap, measureLabel, Infinity))
    const widest = Math.max(0, ...rowLines.flat().map((line) => measureLabel(line)))
    marginLeft = Math.ceil(Math.max(28, widest + LABEL_GAP + EDGE))
  }
  const plotWidth = width - marginLeft - marginRight
  const columnWidth = plotWidth / Math.max(1, columns.length)
  const flagInset = columnWidth < 40 ? 2 : 4
  // A narrow column leaves "%" to the key: the labels are fitted without it.
  const percent = columnWidth >= PERCENT_BELOW
  const drawn = (texts: readonly string[]) =>
    percent ? texts : texts.map((text) => text.replace('%', ''))
  const cellFontSize = fittedSize(
    drawn(cellTexts),
    columnWidth - 2 * flagInset - 4,
    CELL_SIZES,
    measurer,
  )
  const barFontSize = fittedSize(drawn(barTexts), columnWidth - 4, BAR_SIZES, measurer)
  if (stacked) rowLines = rows.map((row) => wrapLabel(row.label, plotWidth, measureLabel, Infinity))

  const caption = block(barCaption, measurer(12), {
    left: EDGE,
    top: 4,
    width: full,
    fontSize: 12,
    lineHeight: LINE,
    anchor: 'start',
  })
  const barTop = caption.top + caption.lines.length * LINE + BAR_LABEL_ROOM
  const barBase = barTop + (stacked ? BAR_HEIGHT_NARROW : BAR_HEIGHT)
  const title = block(yTitle, measureTitle, {
    left: EDGE,
    top: barBase + 12,
    width: full,
    fontSize: TITLE_SIZE,
    lineHeight: LINE,
    anchor: 'start',
  })
  const gridTop = title.top + title.lines.length * LINE + 8

  // Rows: a desktop's cells are as tall as the tallest label beside them;
  // a phone's labels take their own lines over each row.
  const tallest = Math.max(1, ...rowLines.map((lines) => lines.length))
  const cellHeight = stacked ? 30 : Math.max(32, tallest * LINE + 6)
  const rowTops: number[] = []
  const rowLabels: TextBlock[] = []
  let y = gridTop
  rows.forEach((_, index) => {
    const lines = rowLines[index] ?? []
    if (stacked) {
      if (index > 0) y += STACKED_LABEL_ABOVE
      rowLabels.push({
        left: marginLeft,
        top: y,
        width: plotWidth,
        lines,
        fontSize: labelSize,
        lineHeight: LINE,
        anchor: 'start',
      })
      y += lines.length * LINE + STACKED_LABEL_BELOW
      rowTops.push(y)
    } else {
      rowTops.push(y)
      rowLabels.push({
        left: EDGE,
        top: y + (cellHeight - lines.length * LINE) / 2,
        width: marginLeft - LABEL_GAP - EDGE,
        lines,
        fontSize: labelSize,
        lineHeight: LINE,
        anchor: 'end',
      })
    }
    y += cellHeight
  })
  const ticksTop = y + 6
  const measureTick = measurer(11)
  const tickWidth = Math.max(20, columnWidth - 6)
  const ticks = columns.map((column, index) =>
    block(column.label, measureTick, {
      left: marginLeft + (index + 0.5) * columnWidth - tickWidth / 2,
      top: ticksTop,
      width: tickWidth,
      fontSize: 11,
      lineHeight: TICK_LINE,
      anchor: 'middle',
    }),
  )
  const ticksBottom = ticksTop + Math.max(1, ...ticks.map((tick) => tick.lines.length)) * TICK_LINE
  const xTitleBlock = block(xTitle, measureTitle, {
    left: marginLeft + 4,
    top: ticksBottom + 10,
    width: plotWidth - 8,
    fontSize: TITLE_SIZE,
    lineHeight: LINE,
    anchor: 'middle',
  })
  const height = xTitleBlock.top + xTitleBlock.lines.length * LINE + 6
  return {
    width,
    height,
    stacked,
    marginLeft,
    marginRight,
    plotWidth,
    columnWidth,
    percent,
    cellFontSize,
    barFontSize,
    flagInset,
    caption,
    title,
    rowLabels,
    ticks,
    xTitle: xTitleBlock,
    barTop,
    barBase,
    rowTops,
    cellHeight,
  }
}

/** A text block as a Plot text mark: x in the plot's column units (the
 * layout's pixels, offset from the plot's left edge), the block's top as
 * its y, one line per `lineHeight`. */
function textBlock(
  layout: CrossTabLayout,
  text: TextBlock,
  style: { fill: string; fontWeight?: number },
): Plot.Markish {
  const at =
    text.anchor === 'start'
      ? text.left
      : text.anchor === 'end'
        ? text.left + text.width
        : text.left + text.width / 2
  return Plot.text([text.lines.join('\n')], {
    x: 0,
    dx: at - layout.marginLeft,
    y: text.top,
    textAnchor: text.anchor,
    lineAnchor: 'top',
    lineHeight: text.lineHeight / text.fontSize,
    fontSize: text.fontSize,
    ...style,
  })
}

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
  /** Over the grid: the second question. */
  yTitle: string
  /** Over the bars: what they show. */
  barCaption: string
}) {
  const container = usePlot(
    (available) => {
      const laidOut = available !== null
      const star = (text: string, flagged: boolean) => (flagged ? `${text}*` : text)
      const labels = (sign: boolean) => ({
        cell: (cell: CrossTabCell) =>
          cell.share === null ? '' : star(shareLabel(cell.share, sign), cell.flagged),
        bar: (bar: CrossTabColumn) => star(shareLabel(bar.share, sign), bar.flagged),
      })
      const measured = labels(true)
      const layout = crossTabLayout({
        width: chartWidth(660, available),
        columns,
        rows,
        xTitle,
        yTitle,
        barCaption,
        cellTexts: cells.map(measured.cell),
        barTexts: columns.map(measured.bar),
        measurer: (size, weight) => textMeasurer(size, laidOut, weight),
      })
      const { cell: cellText, bar: barText } = labels(layout.percent)
      const { width, height, marginLeft, marginRight, barTop, barBase, rowTops, cellHeight } =
        layout
      const barHeight = barBase - barTop

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
      const rowTop = (index: number) => rowTops[index] ?? 0
      const barEnd = (share: number) => barBase - (share / maxShare) * barHeight

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
          // The bars: who gave each of the first question's answers, with
          // what they show above them.
          textBlock(layout, layout.caption, { fill: INK_SECONDARY }),
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
            text: barText,
            lineAnchor: 'bottom',
            fill: INK_SECONDARY,
            fontSize: layout.barFontSize,
          }),
          // The rows' title, over the grid.
          textBlock(layout, layout.title, { fill: INK, fontWeight: TITLE_WEIGHT }),
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
              inset: layout.flagInset,
              fill: 'none',
              stroke: (cell: GridCell) => tintInk(shareTint(cell.share)) ?? INK_SECONDARY,
              strokeOpacity: 0.7,
              strokeDasharray: '3,2',
            },
          ),
          Plot.text(grid, {
            x: (cell: GridCell) => cell.i + 0.5,
            y: (cell: GridCell) => rowTop(cell.j) + cellHeight / 2,
            text: cellText,
            fill: (cell: GridCell) => tintInk(shareTint(cell.share)) ?? INK,
            fontSize: layout.cellFontSize,
          }),
          // The rows' labels: beside the grid, or over each row.
          ...layout.rowLabels.map((label) => textBlock(layout, label, { fill: INK })),
          // The columns' labels, then the first question's title.
          ...layout.ticks.map((tick) => textBlock(layout, tick, { fill: INK })),
          textBlock(layout, layout.xTitle, { fill: INK, fontWeight: TITLE_WEIGHT }),
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
