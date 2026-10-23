// Ranked countries, one series, one hue (no legend — the title names
// it), a hover card naming the row, its value, its CI and its n
// (theme.ts tipText, ADR-0022), and a direct value label
// on every row (F16). Two marks by scale (F1 / ADR-0010 revised): shares
// keep zero-based bars; 0–10 location stats (means, medians) render as
// dot + CI on a data-fitted window whose edges are always labelled
// ticks, with the axis on top so the window is stated before the rows.
// Every cell is shown (ADR-0011); a row with no computable interval
// draws its dot without a whisker, and a missing value reads "—".
// A keyboard reads the rows one by one (G18, ADR-0032): one tab stop on
// the chart, ↑ ↓ Home End between rows, the row's card shown on focus;
// the pointer keeps Plot's own tip. Never fetches.
//
// The Correlates list (ADR-0018) opts into more: a fixed window (−1 to
// 1, never fitted, so "far right" means the same number for every
// measure), words under the axis's two ends, a label gutter fitted to its
// longest label (capped, longer labels wrapping to two lines, nothing
// clipped), on a phone each label on its own line over a full-width dot
// track, and rows that are real buttons — the whole row, label or dot,
// with a tooltip on hover and on keyboard focus alike.

import * as Plot from '@observablehq/plot'
import { useRef } from 'react'
import type { EstimateRow, Meta, ResponseMeta, VariableSummary } from '../api/types'
import { formatEstimate } from '../format'
import { groupValueLabel } from '../labels'
import { ciExtents, fittedScale, measureBounds, phoneMinStep } from './domain'
import styles from './RankedBar.module.css'
import {
  PINNED_TIP,
  plotRow,
  readableRowName,
  rowFocus as newRowFocus,
  rowLayer,
  withReadableRows,
  type RowFocus,
} from './readableRows'
import {
  BAR_RADIUS,
  FONT_FAMILY,
  GRID,
  INK,
  INK_SECONDARY,
  MIN_ROWS,
  ROW_HEIGHT,
  SURFACE,
  TIP_OPTIONS,
  WHISKER,
  isThin,
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
 * CSV takes); the chart never re-sorts. Rows are countries
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

/** A reference estimate drawn as a dashed rule with its label at the
 * rule's top, above the chart, in ink (the US overall figure behind the
 * states; the All countries average across the countries) — never at its
 * foot, where a share chart's axis labels sit. */
export interface Reference {
  value: number
  label: string
}

/** Room above the top axis for the reference label, and where it sits:
 * its baseline clears the axis's tick labels (a share chart's too, G16). */
const REFERENCE_TOP_ROOM = 18
const REFERENCE_TOP_DY = -26

/** A window that is not fitted to the data: its edges, its ticks, and
 * fewer ticks on a phone. */
export interface FixedScale {
  domain: [number, number]
  ticks: number[]
  narrowTicks?: number[]
}

/** The widest a fitted label gutter grows; longer labels wrap. */
export const LABEL_CAP = 300
/** Room between a row label and the plot. */
const LABEL_PAD = 12
/** Under jsdom nothing is laid out: a label's width is estimated. */
const CHAR_EM = 0.55

/** A bold face runs this much wider than the regular one (the estimate's
 * allowance, before layout). */
const BOLD_EM = 1.08

/** The chart's text measurer: canvas in the chart's own face (and
 * weight) once the page is laid out; an estimate before (and under
 * jsdom, which has no canvas). */
export function textMeasurer(
  fontSize: number,
  laidOut: boolean,
  weight = 400,
): (text: string) => number {
  if (laidOut && typeof document !== 'undefined') {
    const context = document.createElement('canvas').getContext('2d')
    if (context) {
      context.font = `${weight} ${fontSize}px ${FONT_FAMILY}`
      return (text) => context.measureText(text).width
    }
  }
  const em = CHAR_EM * (weight >= 600 ? BOLD_EM : 1)
  return (text) => text.length * fontSize * em
}

/** A label broken at word boundaries into lines no wider than `width`,
 * two at most — the second keeps whatever is left, so nothing is cut. */
export function wrapLabel(
  text: string,
  width: number,
  measure: (text: string) => number,
  maxLines = 2,
): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (line && measure(next) > width && lines.length < maxLines - 1) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

/** A tick on a signed window: −1, −0.5, 0, 0.5, 1 (a true minus). */
function signedTick(value: number): string {
  return value === 0 ? '0' : String(value).replace('-', '−')
}

/** A vertical tick through a row's track (the zero mark on a phone). */
const TRACK_TICK = {
  draw(
    context: { moveTo(x: number, y: number): void; lineTo(x: number, y: number): void },
    size: number,
  ) {
    const half = Math.sqrt(size / Math.PI)
    context.moveTo(0, -half)
    context.lineTo(0, half)
  },
}

/** The picked row's band: the selected control's tint. */
const HIGHLIGHT = 'var(--control-selected)'

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
  fixedScale,
  axisEnds,
  fitLabels = false,
  stackOnNarrow = false,
  tipOf,
  flagOf,
  highlightOf,
  pinnedOf,
  onSelectRow,
  rowName,
  tagOf,
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
  /** A fixed window instead of a fitted one (correlations: −1 to 1). */
  fixedScale?: FixedScale
  /** Words under the axis's low and high ends. */
  axisEnds?: [string, string]
  /** Fit the label gutter to the longest label (≤ LABEL_CAP), wrapping
   * a longer one to two lines. */
  fitLabels?: boolean
  /** On a phone: each label on its own line, its value at the right, the
   * dot track under it at full width. */
  stackOnNarrow?: boolean
  /** The hover card, in words (default: theme.ts tipText — the row,
   * its value as what it is, its CI and n). */
  tipOf?: (row: EstimateRow, label: string) => string
  /** A row few people are behind: its mark is hollow and its value wears
   * an asterisk (default: the server's flag, theme.ts isThin). */
  flagOf?: (row: EstimateRow) => boolean
  /** The row to pick out (the chosen country): a band behind it, label
   * and all, and its dot in ink. */
  highlightOf?: (row: EstimateRow) => boolean
  /** A row whose hover card stays open (US States' Find a state). */
  pinnedOf?: (row: EstimateRow) => boolean
  /** Rows are choices: each row, label or dot, is a button. */
  onSelectRow?: (row: EstimateRow) => void
  /** A row button's accessible name. */
  rowName?: (row: EstimateRow, label: string) => string
  /** A small muted tag after a row's label ("Midyear", ADR-0020). */
  tagOf?: (row: EstimateRow) => string | undefined
}) {
  const rowFocus = useRef<RowFocus>(newRowFocus())
  const container = usePlot(
    (available) => {
      const entries = rankEntries(rows, meta, labelColumn, labelOf)
      // A row's label as drawn: with its tag, when it has one (the entry's
      // label stays the row's key and its tooltip's name).
      const drawnLabel = (entry: Entry) => {
        const tag = tagOf?.(entry.row)
        return tag ? `${entry.label} ${tag}` : entry.label
      }
      const tags = new Set(entries.flatMap((entry) => tagOf?.(entry.row) ?? []))
      const picked = (entry: Entry) => highlightOf?.(entry.row) === true
      const hueOf = (entry: Entry) => (picked(entry) ? INK : colorOf ? colorOf(entry.row) : color)
      // A thin row's mark is hollow: the paper inside a ring in its hue.
      const thinOf = (entry: Entry) => (flagOf ? flagOf(entry.row) : isThin(entry.row))
      const fillOf = (entry: Entry) => (thinOf(entry) ? SURFACE : hueOf(entry))
      const ringOf = (entry: Entry) => (thinOf(entry) ? hueOf(entry) : SURFACE)
      const dotRadius = (entry: Entry) => (thinOf(entry) ? 3.75 : 4.5)
      const ringWidth = (entry: Entry) => (thinOf(entry) ? 1.5 : 2)
      const tip = (entry: Entry) =>
        tipOf
          ? tipOf(entry.row, entry.label)
          : tipText(entry.row, entry.label, { answer: levelLabel, range: variable })
      // The label anchors toward the middle near either end of the
      // window, so it never runs off the chart.
      const topAnchor = (domain: [number, number]) => {
        if (!reference) return 'middle'
        const t = (reference.value - domain[0]) / (domain[1] - domain[0])
        return t > 0.75 ? 'end' : t < 0.25 ? 'start' : 'middle'
      }
      const referenceMarks = (domain: [number, number], dy = REFERENCE_TOP_DY) =>
        reference
          ? [
              Plot.ruleX([reference.value], { stroke: INK, strokeDasharray: '3 3' }),
              Plot.text([reference.value], {
                x: (value: number) => value,
                text: () => reference.label,
                frameAnchor: 'top',
                dy,
                lineAnchor: 'bottom',
                textAnchor: topAnchor(domain),
                fill: INK,
                fontSize: 12,
                fontWeight: 600,
              }),
            ]
          : []
      const topRoom = reference ? REFERENCE_TOP_ROOM : 0
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
      const marginRight = narrow ? 56 : 72
      const valueFontSize = narrow ? 12 : 14
      const valueOf = (entry: Entry) => {
        const text = formatEstimate(entry.row.estimate, entry.row.stat)
        return thinOf(entry) ? `${text}*` : text
      }
      // A readable row says its printed value (H3, ADR-0032 revised).
      const nameOf = (entry: Entry) =>
        readableRowName(
          entry.label,
          entry.row.estimate === null ? null : formatEstimate(entry.row.estimate, entry.row.stat),
          thinOf(entry),
        )
      // Nothing is measured before layout (or under jsdom): estimate.
      const measure = textMeasurer(labelFontSize, available !== null)
      const interactive = onSelectRow !== undefined

      // The phone list: a label line, then its dot track, per row.
      if (!isShare && fixedScale && stackOnNarrow && narrow) {
        const [lo, hi] = fixedScale.domain
        const labelRoom = width - 8 - 44
        const lines = new Map(
          entries.map((entry) => [entry.label, wrapLabel(drawnLabel(entry), labelRoom, measure)]),
        )
        const wrapped = [...lines.values()].some((text) => text.length > 1)
        const rowHeight = wrapped ? 62 : 46
        const ends = axisEndMarks(axisEnds, fixedScale.domain, width - 16, available !== null)
        const plot = Plot.plot({
          width,
          height: 42 + topRoom + ends.room + Math.max(entries.length, MIN_ROWS) * rowHeight,
          marginLeft: 6,
          marginRight: 10,
          marginTop: 34 + topRoom,
          marginBottom: axisEnds ? ends.room : 8,
          style,
          x: {
            domain: fixedScale.domain,
            ticks: fixedScale.narrowTicks ?? fixedScale.ticks,
            tickFormat: signedTick,
            axis: 'top',
            label: null,
          },
          y: { domain, axis: null, paddingInner: 0, paddingOuter: 0 },
          marks: [
            Plot.barX(entries.filter(picked), {
              y: 'label',
              x1: lo,
              x2: hi,
              fill: HIGHLIGHT,
              insetLeft: -4,
              insetRight: -4,
            }),
            // The track: a hairline across the full width, zero ticked.
            Plot.ruleY(entries, { y: 'label', x1: lo, x2: hi, dy: 11, stroke: GRID }),
            Plot.dot(entries, {
              y: 'label',
              x: 0,
              dy: 11,
              symbol: TRACK_TICK,
              r: 5,
              stroke: INK,
              fill: 'none',
            }),
            Plot.dot(valid, {
              y: 'label',
              x: 'value',
              dy: 11,
              fill: fillOf,
              r: dotRadius,
              stroke: ringOf,
              strokeWidth: ringWidth,
            }),
            // The label on its own line; its value right-aligned.
            Plot.text(entries, {
              y: 'label',
              x: lo,
              dy: -4,
              text: (entry: Entry) => (lines.get(entry.label) ?? [entry.label]).join('\n'),
              textAnchor: 'start',
              lineAnchor: 'bottom',
              fill: INK,
              fontSize: labelFontSize,
            }),
            Plot.text(entries, {
              y: 'label',
              x: hi,
              dy: -4,
              text: valueOf,
              textAnchor: 'end',
              lineAnchor: 'bottom',
              fill: INK,
              fontSize: valueFontSize,
              fontWeight: 500,
            }),
            ...ends.marks,
            ...(interactive ? [] : [pointerTip(entries, tip, lo)]),
            ...referenceMarks(fixedScale.domain),
          ],
        })
        emphasizeTurns(plot)
        muteTags(plot, tags)
        return interactive
          ? withRowButtons(plot, entries, tip, onSelectRow, rowFocus.current, rowName)
          : readRows(plot, entries, tip, lo, rowFocus.current, nameOf, pinnedOf)
      }

      // The label gutter: fitted to the longest label (capped, wrapping
      // longer ones to two lines), or the caller's width.
      const lines = new Map<string, string[]>()
      // 'New Hampshire' and 'United Kingdom' at 13.5px need 112 on a phone.
      let marginLeft = labelWidth ?? (narrow ? 112 : 128)
      if (fitLabels) {
        let widest = 0
        for (const entry of entries) {
          const text = wrapLabel(drawnLabel(entry), LABEL_CAP - LABEL_PAD, measure)
          lines.set(entry.label, text)
          for (const line of text) widest = Math.max(widest, measure(line))
        }
        marginLeft = Math.ceil(Math.max(64, widest + LABEL_PAD))
      }
      const wrapped = [...lines.values()].some((text) => text.length > 1)
      // Never shorter than four rows: the top ticks clear the first row
      // and a zero rule is never a stub. Two-line labels need taller rows.
      const rowHeight = wrapped ? 38 : ROW_HEIGHT
      const height = 44 + Math.max(entries.length, MIN_ROWS) * rowHeight
      const yAxis = Plot.axisY({
        tickSize: 0,
        label: null,
        fontSize: labelFontSize,
        fill: INK,
        ...(fitLabels
          ? { tickFormat: (label: string) => (lines.get(label) ?? [label]).join('\n') }
          : tags.size > 0
            ? {
                tickFormat: (label: string) => {
                  const entry = entries.find((candidate) => candidate.label === label)
                  return entry ? drawnLabel(entry) : label
                },
              }
            : {}),
      })

      if (!isShare) {
        // Location stats on a bounded scale: dot + CI on a fitted window
        // (or the caller's fixed one).
        const scale = fixedScale
          ? {
              domain: fixedScale.domain,
              ticks: narrow && fixedScale.narrowTicks ? fixedScale.narrowTicks : fixedScale.ticks,
              format: signedTick,
            }
          : fittedScale(
              [
                ...ciExtents(valid),
                ...(reference ? [reference.value] : []),
                ...(zeroRule ? [0] : []),
              ],
              {
                targetTicks: narrow ? 5 : 7,
                bounds: measureBounds(responseMeta.stat, variable),
                minStep: narrow ? phoneMinStep(responseMeta.stat, variable) : 0,
              },
            )
        const [lo, hi] = scale.domain
        const ends = axisEndMarks(
          axisEnds,
          scale.domain,
          width - marginLeft - marginRight,
          available !== null,
        )
        // The top axis gets 34 px, or 60 with a title over its ticks, so it
        // sits close under the chart's header (F19); a fixed window keeps
        // its room under the last row.
        const axisRoom = axisTitle ? 60 : 34
        const plot = Plot.plot({
          height:
            height + (fixedScale ? 16 : axisRoom - 44) + topRoom + (axisEnds ? ends.room - 8 : 0),
          width,
          marginLeft,
          marginRight,
          marginTop: axisRoom + topRoom,
          ...(axisEnds ? { marginBottom: ends.room } : {}),
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
            Plot.barX(entries.filter(picked), {
              y: 'label',
              x1: lo,
              x2: hi,
              fill: HIGHLIGHT,
              insetLeft: -(marginLeft - 2),
              insetRight: -(marginRight - 2),
            }),
            // Country labels at 13.5 in ink (§6); the value axis stays 11px.
            yAxis,
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
              r: dotRadius,
              stroke: ringOf,
              strokeWidth: ringWidth,
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
            ...ends.marks,
            ...(interactive ? [] : [pointerTip(entries, tip, lo)]),
            ...pinnedTip(
              entries,
              tip,
              pinnedOf,
              scale.domain,
              { width, marginLeft, marginRight },
              narrow,
            ),
            ...referenceMarks(scale.domain),
          ],
        })
        emphasizeTurns(plot)
        muteTags(plot, tags)
        return interactive
          ? withRowButtons(plot, entries, tip, onSelectRow, rowFocus.current, rowName)
          : readRows(plot, entries, tip, lo, rowFocus.current, nameOf, pinnedOf)
      }

      // Shares: zero-based bars (a length encoding needs its baseline).
      const xMax = Math.max(
        10,
        ...valid.map((entry) => (entry.ci?.[1] ?? entry.value ?? 0) * 1.05),
        (reference?.value ?? 0) * 1.05,
      )
      // The axis on top, as the dot plots carry it (G16): read with the
      // first rows, not under the last of twenty-three.
      const plot = Plot.plot({
        height: height - 44 + 34 + 8 + topRoom,
        marginTop: 34 + topRoom,
        marginBottom: 8,
        width,
        marginLeft,
        marginRight,
        style,
        x: {
          domain: [0, xMax],
          axis: 'top',
          label: null,
          grid: true,
          tickFormat: (d: number) => `${d}%`,
        },
        y: { domain },
        marks: [
          yAxis,
          Plot.barX(valid, {
            y: 'label',
            x: 'value',
            fill: (entry: Entry) => (thinOf(entry) ? SURFACE : color),
            stroke: (entry: Entry) => (thinOf(entry) ? color : 'none'),
            strokeWidth: 1.5,
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
          pointerTip(entries, tip, 0),
          ...pinnedTip(
            entries,
            tip,
            pinnedOf,
            [0, xMax],
            { width, marginLeft, marginRight },
            narrow,
          ),
          ...referenceMarks([0, xMax]),
        ],
      })
      return readRows(plot, entries, tip, 0, rowFocus.current, nameOf, pinnedOf)
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
      fixedScale,
      axisEnds,
      fitLabels,
      stackOnNarrow,
      tipOf,
      flagOf,
      highlightOf,
      pinnedOf,
      onSelectRow,
      rowName,
      tagOf,
    ],
  )

  return <div ref={container} />
}

/** A hover card that stays open on its row (no pointer needed), until
 * the row is no longer pinned. */
function pinnedTip(
  entries: Entry[],
  tip: (entry: Entry) => string,
  pinnedOf: ((row: EstimateRow) => boolean) | undefined,
  domain: [number, number],
  frame: { width: number; marginLeft: number; marginRight: number },
  narrow: boolean,
) {
  if (!pinnedOf) return []
  const pinned = entries.filter((entry) => pinnedOf(entry.row))
  if (pinned.length === 0) return []
  const [lo, hi] = domain
  const inner = frame.width - frame.marginLeft - frame.marginRight
  // The card opens toward the side with room for it, so it stays inside
  // the chart (G5): beside its mark on a wide chart, under it on a phone,
  // centred when neither side has room. Its width is estimated from its
  // longest line at the card's 13px.
  const anchor = (entry: Entry) => {
    const lines = tip(entry).split('\n')
    const card = Math.max(...lines.map((line) => line.length)) * 7.2 + 28
    const x = frame.marginLeft + (((entry.value ?? lo) - lo) / (hi - lo || 1)) * inner
    const [toRight, toLeft, centred] = narrow
      ? (['top-left', 'top-right', 'top'] as const)
      : (['left', 'right', 'top'] as const)
    if (frame.width - x >= card) return toRight
    if (x >= card) return toLeft
    return centred
  }
  return pinned.map((entry) =>
    Plot.tip([entry], {
      y: 'label',
      x: (row: Entry) => row.value ?? lo,
      title: tip,
      ...TIP_OPTIONS,
      anchor: anchor(entry),
      ariaDescription: PINNED_TIP,
    }),
  )
}

/** Plot's own pointer tip, for charts whose rows are not buttons. */
function pointerTip(entries: Entry[], tip: (entry: Entry) => string, fallback: number) {
  return Plot.tip(
    entries,
    Plot.pointerY({
      y: 'label',
      x: (entry: Entry) => entry.value ?? fallback,
      title: tip,
      ...TIP_OPTIONS,
    }),
  )
}

/** The words a signed reading turns on: set apart wherever the page
 * says them (ADR-0020). */
const TURN_WORDS = /\b(higher|lower)\b/

/** The description of the marks the axis ends' words are drawn in (how
 * they are found again once the plot is built, to set their turning
 * words apart). */
const AXIS_END = 'axis end'

/** The words under the axis's two ends, each held to half the plot's
 * width (wrapping to a second line rather than meeting in the middle —
 * "higher" and "lower" measured in their own bold italic), and the room
 * they take below the plot. */
function axisEndMarks(
  ends: [string, string] | undefined,
  [lo, hi]: [number, number],
  plotWidth: number,
  laidOut: boolean,
): { marks: Plot.Markish[]; room: number } {
  if (!ends) return { marks: [], room: 0 }
  const regular = textMeasurer(11, laidOut)
  const bold = textMeasurer(11, laidOut, 600)
  const measure = (text: string) =>
    text
      .split(TURN_WORDS)
      .reduce((width, part, index) => width + (index % 2 === 1 ? bold(part) : regular(part)), 0)
  const half = Math.max(80, plotWidth / 2 - 8)
  // No cap on the lines: a capped wrap keeps the leftovers on its last
  // line, which then runs into the other end's words.
  const [low, high] = ends.map((text) => wrapLabel(text, half, measure, Infinity))
  const lines = Math.max(low?.length ?? 1, high?.length ?? 1)
  const end = {
    frameAnchor: 'bottom',
    dy: 16,
    lineAnchor: 'top',
    fill: INK_SECONDARY,
    fontSize: 11,
    ariaDescription: AXIS_END,
  } as const
  return {
    marks: [
      Plot.text([lo], {
        x: (value: number) => value,
        text: () => (low ?? []).join('\n'),
        textAnchor: 'start',
        ...end,
      }),
      Plot.text([hi], {
        x: (value: number) => value,
        text: () => (high ?? []).join('\n'),
        textAnchor: 'end',
        ...end,
      }),
    ],
    // 16px down to the first line, 13px a line, a little air under the last.
    room: 16 + lines * 13 + 6,
  }
}

/** A row label's tag ("Midyear"): its last word, set smaller in
 * secondary ink by a styled tspan, so the PNG export carries it. */
function muteTags(plot: Element, tags: ReadonlySet<string>): void {
  if (tags.size === 0) return
  const svgNs = 'http://www.w3.org/2000/svg'
  for (const text of plot.querySelectorAll(
    'g[aria-label="y-axis tick label"] text, g[aria-label="text"] text',
  )) {
    const lines = [...text.querySelectorAll(':scope > tspan')]
    const holder = lines.length > 0 ? lines[lines.length - 1] : text
    if (!holder) continue
    const content = holder.textContent ?? ''
    const tag = [...tags].find(
      (candidate) => content === candidate || content.endsWith(` ${candidate}`),
    )
    if (!tag) continue
    holder.textContent = content.slice(0, content.length - tag.length)
    const word = document.createElementNS(svgNs, 'tspan')
    word.setAttribute('fill', INK_SECONDARY)
    word.setAttribute('font-size', '11')
    word.setAttribute('font-weight', '400')
    word.textContent = tag
    holder.append(word)
  }
}

/** "higher" and "lower" in the axis ends' words: italic, 600, in ink —
 * styled tspans inside each line, so the PNG export carries them; the
 * rest of each line keeps its own style. */
function emphasizeTurns(plot: Element): void {
  const svgNs = 'http://www.w3.org/2000/svg'
  for (const text of plot.querySelectorAll(`g[aria-description="${AXIS_END}"] text`)) {
    const lines = [...text.querySelectorAll('tspan')]
    for (const holder of lines.length > 0 ? lines : [text]) {
      const content = holder.textContent ?? ''
      if (!TURN_WORDS.test(content)) continue
      holder.textContent = ''
      content.split(TURN_WORDS).forEach((part, index) => {
        if (index % 2 === 0) {
          if (part) holder.append(document.createTextNode(part))
          return
        }
        const word = document.createElementNS(svgNs, 'tspan')
        word.setAttribute('font-style', 'italic')
        word.setAttribute('font-weight', '600')
        word.setAttribute('fill', INK)
        word.textContent = part
        holder.append(word)
      })
    }
  }
}

/** The rows as real buttons over the plot, in row order; the card
 * follows hover and focus. One tab stop for them all — the row the
 * reader last left, else the first — ↑ ↓ Home End to move it, Enter or
 * Space to choose (H18, ADR-0032's pattern). */
function withRowButtons(
  plot: (SVGSVGElement | HTMLElement) & Plot.Plot,
  entries: Entry[],
  tip: (entry: Entry) => string,
  onSelect: (row: EstimateRow) => void,
  focus: RowFocus,
  nameOf?: (row: EstimateRow, label: string) => string,
): HTMLElement {
  const rows = rowLayer(plot)
  const start = Math.max(
    0,
    entries.findIndex((entry) => entry.label === focus.active),
  )
  const buttons = entries.map((entry, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = styles.row ?? ''
    button.tabIndex = index === start ? 0 : -1
    const geometry = plotRow(plot, entry.label, entry.value ?? 0)
    rows.place(button, geometry)
    button.setAttribute('aria-label', nameOf ? nameOf(entry.row, entry.label) : entry.label)
    const show = () => rows.show(button, geometry, tip(entry))
    const hide = () => rows.hide(button)
    button.addEventListener('pointerenter', show)
    button.addEventListener('pointerleave', hide)
    button.addEventListener('focus', () => {
      focus.active = entry.label
      for (const other of buttons) other.tabIndex = other === button ? 0 : -1
      show()
    })
    button.addEventListener('blur', hide)
    button.addEventListener('click', () => onSelect(entry.row))
    rows.layer.append(button)
    return button
  })
  rows.layer.addEventListener('keydown', (event) => {
    const at = buttons.indexOf(event.target as HTMLButtonElement)
    if (at < 0) return
    const last = buttons.length - 1
    const to =
      event.key === 'ArrowDown'
        ? Math.min(at + 1, last)
        : event.key === 'ArrowUp'
          ? Math.max(at - 1, 0)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : undefined
    if (to === undefined) return
    event.preventDefault()
    buttons[to]?.focus()
  })
  return rows.wrap
}

/** The rows as a list a keyboard reads one by one (readableRows.ts):
 * each named with its value, its card the hover card's words; a row
 * with no value places its card at `fallback`. */
function readRows(
  plot: (SVGSVGElement | HTMLElement) & Plot.Plot,
  entries: Entry[],
  tip: (entry: Entry) => string,
  fallback: number,
  focus: RowFocus,
  nameOf: (entry: Entry) => string,
  pinnedOf?: (row: EstimateRow) => boolean,
): HTMLElement {
  return withReadableRows(
    plot,
    entries.map((entry) => ({
      key: entry.label,
      name: nameOf(entry),
      tip: tip(entry),
      geometry: plotRow(plot, entry.label, entry.value ?? fallback),
    })),
    focus,
    entries.find((entry) => pinnedOf?.(entry.row))?.label ?? null,
  )
}
