// Every answer to a categorical question, country by country (ADR-0025):
// one 100% bar per country, a segment per answer in the codebook's
// order, its share printed on it where it fits. The shades come from the
// sequential ramp, deeper for more of what the question names (its
// served polarity), so the bars read as a gradient of the answers; the
// key above names each one. Each segment's hover card gives the share,
// its CI and how many in the sample gave that answer. Rows arrive in
// the order to draw (countries, then answers); the chart never re-sorts.
// Never fetches.

import * as Plot from '@observablehq/plot'
import type { EstimateRow, Meta } from '../api/types'
import { groupValueLabel } from '../labels'
import { textMeasurer } from './RankedBar'
import styles from './StackedShares.module.css'
import {
  FONT_FAMILY,
  INK,
  INK_SECONDARY,
  MIN_ROWS,
  ROW_HEIGHT,
  SHARE_RAMP,
  SURFACE,
  TIP_OPTIONS,
  isThin,
  plotValue,
  tipText,
} from './theme'
import { tintInk } from './HeatTable'
import { chartWidth, usePlot } from './usePlot'

/** The most answers the bars can tell apart: one ramp step each. */
export const MAX_ANSWERS = SHARE_RAMP.length

export interface Answer {
  value: number
  label: string
}

/** Each answer's shade: evenly spread over the ramp, the deep end at the
 * answer that is most of what the question names — the last for an
 * ascending item, the first for a descending one (ADR-0015). */
export function answerShades(
  answers: readonly Answer[],
  polarity: string | undefined,
): Map<number, string> {
  const steps = SHARE_RAMP.length - 1
  const last = Math.max(1, answers.length - 1)
  return new Map(
    answers.map((answer, index) => {
      const at = polarity === 'descending' ? last - index : index
      const step = answers.length === 1 ? steps : Math.round((at * steps) / last)
      return [answer.value, SHARE_RAMP[step] as string]
    }),
  )
}

interface Segment {
  row: EstimateRow
  country: string
  level: number
  label: string
  value: number
}

/** The key: each answer's shade and words, in the codebook's order; the
 * answer the rows are sorted by, when they are, set in ink. */
function AnswerKey({
  answers,
  shades,
  sortedBy,
}: {
  answers: readonly Answer[]
  shades: Map<number, string>
  sortedBy?: number
}) {
  return (
    <ul className={styles.key} aria-label="Answers">
      {answers.map((answer) => (
        <li key={answer.value} data-sorted={answer.value === sortedBy || undefined}>
          <span className={styles.swatch} style={{ background: shades.get(answer.value) }} />
          {answer.label}
        </li>
      ))}
    </ul>
  )
}

export function StackedShares({
  rows,
  meta,
  answers,
  polarity,
  countryOrder,
  sortedBy,
}: {
  /** Every answer's share for every country, countries in drawing order. */
  rows: EstimateRow[]
  meta: Meta
  /** The question's answers in the codebook's order, with their words. */
  answers: readonly Answer[]
  /** The question's served polarity: which end is "more". */
  polarity?: string
  /** Country names, top to bottom. */
  countryOrder: string[]
  /** The answer the rows are ordered by, when they are. */
  sortedBy?: number
}) {
  const shades = answerShades(answers, polarity)
  const container = usePlot(
    (available) => {
      const labelOf = new Map(answers.map((answer) => [answer.value, answer.label]))
      const segments: Segment[] = rows
        .filter((row) => row.level !== null && row.level !== undefined && labelOf.has(row.level))
        .map((row) => ({
          row,
          country: groupValueLabel('country_code', row.group['country_code'] ?? null, meta),
          level: row.level as number,
          label: labelOf.get(row.level as number) ?? String(row.level),
          value: plotValue(row) ?? 0,
        }))
      const thinCountries = new Set(
        segments.filter((segment) => isThin(segment.row)).map((segment) => segment.country),
      )
      const width = chartWidth(720, available)
      // The label column fits the longest country name (13.5px ink), up
      // to a third of a phone's width.
      const measure = textMeasurer(13.5, available !== null)
      const longest = Math.max(0, ...countryOrder.map(measure))
      const marginLeft = Math.ceil(Math.min(width < 480 ? 140 : 180, longest + 12))
      const marginRight = 24
      // A share is printed on its segment where "100%" fits inside it.
      const pxPerPoint = (width - marginLeft - marginRight) / 100
      const printed = (segment: Segment) =>
        segment.value * pxPerPoint >= 30 ? `${Math.round(segment.value)}%` : ''
      const shadeOf = (segment: Segment) => shades.get(segment.level) ?? SHARE_RAMP[0]
      const stack = { y: 'country', x: 'value', z: 'level' } as const
      return Plot.plot({
        height: 40 + Math.max(countryOrder.length, MIN_ROWS) * ROW_HEIGHT,
        width,
        marginLeft,
        marginRight,
        marginTop: 28,
        style: {
          fontFamily: FONT_FAMILY,
          fontSize: '11px',
          background: 'transparent',
          color: INK_SECONDARY,
        },
        x: {
          axis: 'top',
          domain: [0, 100],
          ticks: [0, 25, 50, 75, 100],
          tickFormat: (d: number) => `${d}%`,
          label: null,
        },
        y: { domain: countryOrder, label: null, padding: 0.2 },
        marks: [
          // A country few people answered in keeps its answers' shades —
          // they are the chart's key — and wears the asterisk on its name
          // (ADR-0031); every segment's card says so.
          Plot.axisY({
            tickSize: 0,
            label: null,
            fontSize: 13.5,
            fill: INK,
            tickFormat: (country: string) => (thinCountries.has(country) ? `${country}*` : country),
          }),
          Plot.barX(
            segments,
            Plot.stackX({
              ...stack,
              fill: shadeOf,
              stroke: SURFACE,
              strokeWidth: 1,
              title: (segment: Segment) =>
                tipText(segment.row, segment.country, { answer: segment.label }),
              tip: TIP_OPTIONS,
            }),
          ),
          Plot.text(
            segments,
            Plot.stackX({
              ...stack,
              text: printed,
              fill: (segment: Segment) => tintInk(shadeOf(segment)) ?? INK,
              fontSize: 11,
            }),
          ),
        ],
      })
    },
    [rows, meta, answers, polarity, countryOrder],
  )

  return (
    <div>
      <AnswerKey answers={answers} shades={shades} sortedBy={sortedBy} />
      <div ref={container} />
    </div>
  )
}
