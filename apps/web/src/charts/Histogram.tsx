// The distribution stat: weighted share per answer (0–10), with per-bin
// CIs. Empty bins ship because the API passes the catalog's [min, max]
// grid; every bin is shown (ADR-0011), with its n in the tip. The
// y-domain fits the tallest bin across the countries being compared
// (F1), with the fitted top always a labelled tick. Multiple selected
// countries facet into columns with shared scales.

import * as Plot from '@observablehq/plot'
import type { EstimateRow, Meta, ResponseMeta, VariableSummary } from '../api/types'
import { groupValueLabel } from '../labels'
import { fittedScale } from './domain'
import {
  BAR_RADIUS,
  FACET_PADDING,
  FONT_FAMILY,
  INK,
  INK_SECONDARY,
  SURFACE,
  TIP_OPTIONS,
  plotCI,
  plotValue,
  tipText,
} from './theme'
import { chartWidth, usePlot } from './usePlot'

interface BinEntry {
  row: EstimateRow
  level: number
  facet: string
  value: number | null
  ci: [number, number] | null
}

export function binEntries(rows: EstimateRow[], meta: Meta): BinEntry[] {
  return rows
    .filter((row) => row.level !== null && row.level !== undefined)
    .map((row) => ({
      row,
      level: row.level as number,
      facet: groupValueLabel('country_code', row.group['country_code'] ?? null, meta),
      value: plotValue(row),
      ci: plotCI(row),
    }))
}

/** The bins that get a tick label: every one when the widest label fits
 * its bin, else every second (third, …) bin so no two labels touch — at
 * 1280 px with three countries "8–9" and "9–10" ran together. The
 * signed change buckets keep zero labelled. Widths are in px for the
 * 11 px plot text (about 0.6 em a glyph, plus a gap). */
export function thinnedTicks(
  levels: readonly number[],
  label: (level: number) => string,
  facetWidth: number,
): number[] {
  if (levels.length === 0) return []
  const binWidth = facetWidth / levels.length
  const widest = Math.max(...levels.map((level) => label(level).length))
  const stride = Math.max(1, Math.ceil((widest * 6.6 + 6) / binWidth))
  const anchor = Math.max(0, levels.indexOf(0))
  return levels.filter((_, index) => (index - anchor) % stride === 0)
}

export function Histogram({
  rows,
  meta,
  responseMeta,
  variable,
  color,
  levels: levelsProp,
  xLabel,
  levelLabel,
}: {
  rows: EstimateRow[]
  meta: Meta
  responseMeta: ResponseMeta
  variable: VariableSummary
  color: string
  /** The bin grid; defaults to the variable's [min, max]. The change
   * histogram passes the signed −span…+span buckets instead. */
  levels?: number[]
  /** Axis title; defaults to "Answer (min–max)". */
  xLabel?: string
  /** Tick and tip rendering of a bin (signed for change buckets). */
  levelLabel?: (level: number) => string
}) {
  const container = usePlot(
    (available) => {
      const entries = binEntries(rows, meta)
      const facets = [...new Set(entries.map((entry) => entry.facet))]
      const faceted = facets.length > 1
      const facetChannel: Record<string, string> = faceted ? { fx: 'facet' } : {}
      const valid = entries.filter((entry) => entry.value !== null)
      const levels =
        levelsProp ??
        (variable.min !== null && variable.max !== null
          ? Array.from(
              { length: variable.max - variable.min + 1 },
              (_, i) => (variable.min ?? 0) + i,
            )
          : [...new Set(entries.map((entry) => entry.level))].sort((a, b) => a - b))
      const label = levelLabel ?? ((level: number) => String(level))
      // Fit the y-domain to the tallest bin (CI included) across the
      // countries in view; bars keep their zero baseline.
      const scale = fittedScale(
        valid.map((entry) => entry.ci?.[1] ?? entry.value ?? 0),
        { targetTicks: 5, zeroBaseline: true, bounds: [0, 100] },
      )
      const width = chartWidth(Math.max(420, Math.min(900, facets.length * 260)), available)
      // Plot's default side margins (40 + 20) and the facet padding leave
      // each facet this wide for its bins.
      const facetWidth = ((width - 60) / facets.length) * (faceted ? 1 - FACET_PADDING : 1)
      return Plot.plot({
        height: 300,
        width,
        marginBottom: 44,
        style: {
          fontFamily: FONT_FAMILY,
          fontSize: '11px',
          background: 'transparent',
          color: INK_SECONDARY,
        },
        x: {
          domain: levels,
          label: xLabel ?? `Answer (${variable.min ?? '·'}–${variable.max ?? '·'})`,
          labelAnchor: 'center',
          tickSize: 0,
          tickFormat: label,
          // Every bar stays; labels thin out when a facet is too narrow
          // for all of them (21 signed buckets on a phone, ten bins in
          // three facets) so none touch.
          ticks: thinnedTicks(levels, label, facetWidth),
        },
        y: {
          domain: scale.domain,
          ticks: scale.ticks,
          label: 'Weighted share (%)',
          grid: true,
          tickFormat: (d: number) => `${scale.format(d)}%`,
        },
        ...(faceted
          ? { fx: { domain: facets, label: null, axis: 'top', paddingInner: FACET_PADDING } }
          : {}),
        marks: [
          Plot.barY(valid, {
            ...facetChannel,
            x: 'level',
            y: 'value',
            fill: color,
            ry2: BAR_RADIUS,
            insetLeft: 1,
            insetRight: 1,
          }),
          // The whisker over a bar: a surface halo, then ink.
          Plot.ruleX(
            valid.filter((entry) => entry.ci !== null),
            {
              ...facetChannel,
              x: 'level',
              y1: (entry: BinEntry) => entry.ci?.[0],
              y2: (entry: BinEntry) => entry.ci?.[1],
              stroke: SURFACE,
              strokeWidth: 4,
              clip: true,
            },
          ),
          Plot.ruleX(
            valid.filter((entry) => entry.ci !== null),
            {
              ...facetChannel,
              x: 'level',
              y1: (entry: BinEntry) => entry.ci?.[0],
              y2: (entry: BinEntry) => entry.ci?.[1],
              stroke: INK,
              strokeWidth: 1.5,
              clip: true,
            },
          ),
          Plot.tip(
            entries,
            Plot.pointerX({
              ...facetChannel,
              x: 'level',
              y: (entry: BinEntry) => entry.value ?? 0,
              title: (entry: BinEntry) =>
                tipText(
                  entry.row,
                  `${entry.facet} · ${levelsProp ? 'change' : 'answer'} ${label(entry.level)}`,
                ),
              ...TIP_OPTIONS,
            }),
          ),
        ],
      })
    },
    [rows, meta, responseMeta, variable, color, levelsProp, xLabel, levelLabel],
  )

  return <div ref={container} />
}
