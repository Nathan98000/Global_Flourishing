// Two questions side by side (Compare two, ADR-0018): a binned scatter.
// One dot per group of the compared question X — its answers in order,
// or bins of a long scale — at the weighted mean of the measure Y in
// that group, with its CI whisker; the dots' area is proportional to the
// group's share of the people who answered both, and a thin line joins
// them. Single hue; a group resting on too few people is drawn hollow.
// Y spans its full scale (0–10, 0–100%, the item's own range) — never a
// fitted window — and runs so that up is always more of what Y's label
// names (a descending item's axis is reversed; its means stay as coded).
// Respondent-level points are never drawn: they would publish microdata,
// and 38k answers on a 0–10 × 0–10 grid only overplot. Never fetches.

import * as Plot from '@observablehq/plot'
import type { EstimateRow } from '../api/types'
import { isShareStat } from '../format'
import {
  FONT_FAMILY,
  INK,
  INK_SECONDARY,
  POSITIVE_MARK,
  SURFACE,
  TIP_OPTIONS,
  plotCI,
  plotValue,
} from './theme'
import { chartWidth, usePlot } from './usePlot'

export interface BinnedPoint {
  /** Unique per group (its position). */
  key: string
  /** The answer's short label, or the bin's range. */
  label: string
  /** Y's weighted mean (or share) in the group, with its CI and n. */
  row: EstimateRow
  /** The group's weighted share of the people who answered both. */
  share: number
  /** Too few people: drawn hollow (the footnote names it). */
  hollow: boolean
}

interface Entry extends BinnedPoint {
  value: number | null
  ci: [number, number] | null
}

/** Font size of the X answer labels. */
const TICK_FONT = 11
/** Plot's `lineWidth` is in ems; a character is about 0.55em. */
const CHAR_EM = 0.55

/** The lines a label wraps to within `width` px at the tick font. */
export function wrappedLines(label: string, width: number): number {
  const perLine = Math.max(1, Math.floor(width / (TICK_FONT * CHAR_EM)))
  const words = label.split(/\s+/)
  let lines = 1
  let used = 0
  for (const word of words) {
    const next = used === 0 ? word.length : used + 1 + word.length
    if (next > perLine && used > 0) {
      lines += 1
      used = word.length
    } else {
      used = next
    }
  }
  return lines
}

export function BinnedScatter({
  points,
  yDomain,
  reverse = false,
  yLabel,
  tipOf,
}: {
  points: readonly BinnedPoint[]
  /** Y's full scale, plot-scaled (0–100 for a share). */
  yDomain: [number, number]
  /** A descending Y: up is its lowest code, the most of what it names. */
  reverse?: boolean
  /** Above the axis: which way is more (arrow included). */
  yLabel: string
  /** The tooltip, in words, for one group. */
  tipOf: (point: BinnedPoint) => string
}) {
  const container = usePlot(
    (available) => {
      const width = chartWidth(660, available)
      const narrow = width < 480
      const entries: Entry[] = points.map((point) => ({
        ...point,
        value: plotValue(point.row),
        ci: plotCI(point.row),
      }))
      const marginLeft = 40
      const marginRight = 16
      // Each answer gets an equal slot; its label wraps inside it.
      const slot = (width - marginLeft - marginRight) / Math.max(1, entries.length)
      const lines = Math.max(1, ...entries.map((entry) => wrappedLines(entry.label, slot - 4)))
      const labelOf = new Map(entries.map((entry) => [entry.key, entry.label]))
      const maxShare = Math.max(0.01, ...entries.map((entry) => entry.share))
      // A dot never outgrows its slot: area ∝ share up to this radius.
      const maxRadius = Math.max(4, Math.min(narrow ? 11 : 15, slot / 2 - 2))
      const share = isShareStat(points[0]?.row.stat ?? 'mean')
      return Plot.plot({
        width,
        height: (narrow ? 300 : 360) + lines * 13,
        marginLeft,
        marginRight,
        marginTop: 34,
        marginBottom: 14 + lines * 13,
        style: {
          fontFamily: FONT_FAMILY,
          fontSize: '11px',
          background: 'transparent',
          color: INK_SECONDARY,
        },
        x: {
          type: 'point',
          domain: entries.map((entry) => entry.key),
          padding: 0.5,
          label: null,
        },
        y: {
          domain: yDomain,
          reverse,
          grid: true,
          nice: false,
          label: yLabel,
          labelArrow: 'none',
          labelAnchor: 'top',
          tickFormat: share ? (d: number) => `${d}%` : undefined,
        },
        r: { type: 'sqrt', domain: [0, maxShare], range: [0, maxRadius] },
        marks: [
          Plot.axisX({
            label: null,
            tickSize: 0,
            tickPadding: 8,
            fontSize: TICK_FONT,
            fill: INK,
            lineWidth: Math.max(2, (slot - 4) / TICK_FONT),
            tickFormat: (key: string) => labelOf.get(key) ?? key,
          }),
          Plot.ruleX(
            entries.filter((entry) => entry.ci !== null),
            {
              x: 'key',
              y1: (entry: Entry) => entry.ci?.[0],
              y2: (entry: Entry) => entry.ci?.[1],
              stroke: POSITIVE_MARK,
              strokeWidth: 1.5,
            },
          ),
          Plot.line(entries, {
            x: 'key',
            y: (entry: Entry) => entry.value ?? undefined,
            stroke: POSITIVE_MARK,
            strokeWidth: 1.25,
            strokeOpacity: 0.55,
          }),
          Plot.dot(
            entries.filter((entry) => entry.value !== null),
            {
              x: 'key',
              y: 'value',
              r: 'share',
              fill: (entry: Entry) => (entry.hollow ? SURFACE : POSITIVE_MARK),
              stroke: POSITIVE_MARK,
              strokeWidth: 1.5,
            },
          ),
          Plot.tip(
            entries,
            Plot.pointerX({
              x: 'key',
              y: (entry: Entry) => entry.value ?? yDomain[0],
              title: (entry: Entry) => tipOf(entry),
              ...TIP_OPTIONS,
            }),
          ),
        ],
      })
    },
    [points, yDomain, reverse, yLabel, tipOf],
  )
  return <div ref={container} />
}
