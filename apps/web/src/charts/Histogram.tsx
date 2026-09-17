// The distribution stat: weighted share per answer (0–10), with per-bin
// CIs. Empty bins ship because the API passes the catalog's [min, max]
// grid; suppressed bins render as hatched stubs with their n in the tip,
// and the hatch is named in a legend that states the rule. The y-domain
// fits the tallest bin across the countries being compared (F1), with
// the fitted top always a labelled tick. Multiple selected countries
// facet into columns with shared scales.

import * as Plot from '@observablehq/plot'
import type { CSSProperties } from 'react'
import type { EstimateRow, Meta, ResponseMeta, VariableSummary } from '../api/types'
import { formatCount } from '../format'
import { groupValueLabel } from '../labels'
import { fittedScale } from './domain'
import {
  BAR_RADIUS,
  FONT_FAMILY,
  INK_SECONDARY,
  SUPPRESSED_HATCH_FILL,
  WHISKER,
  plotCI,
  plotValue,
  tipText,
} from './theme'
import { usePlot } from './usePlot'

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
      value: row.suppressed ? null : plotValue(row),
      ci: row.suppressed ? null : plotCI(row),
    }))
}

const HATCH_SWATCH: CSSProperties = {
  display: 'inline-block',
  width: 18,
  height: 12,
  verticalAlign: '-2px',
  border: '1px solid var(--suppressed-hatch)',
  background:
    'repeating-linear-gradient(45deg, var(--suppressed-fill), var(--suppressed-fill) 3px, var(--suppressed-hatch) 3px, var(--suppressed-hatch) 4px)',
}

export function Histogram({
  rows,
  meta,
  responseMeta,
  variable,
  color,
}: {
  rows: EstimateRow[]
  meta: Meta
  responseMeta: ResponseMeta
  variable: VariableSummary
  color: string
}) {
  const threshold = responseMeta.suppression.threshold
  const hasSuppressed = rows.some((row) => row.suppressed)

  const container = usePlot(() => {
    const entries = binEntries(rows, meta)
    const facets = [...new Set(entries.map((entry) => entry.facet))]
    const faceted = facets.length > 1
    const facetChannel: Record<string, string> = faceted ? { fx: 'facet' } : {}
    const valid = entries.filter((entry) => entry.value !== null)
    const suppressed = entries.filter((entry) => entry.row.suppressed)
    const levels =
      variable.min !== null && variable.max !== null
        ? Array.from({ length: variable.max - variable.min + 1 }, (_, i) => (variable.min ?? 0) + i)
        : [...new Set(entries.map((entry) => entry.level))].sort((a, b) => a - b)
    // Fit the y-domain to the tallest bin (CI included) across the
    // countries in view; bars keep their zero baseline.
    const scale = fittedScale(
      valid.map((entry) => entry.ci?.[1] ?? entry.value ?? 0),
      { targetTicks: 5, zeroBaseline: true },
    )
    const maxY = scale.domain[1]

    return Plot.plot({
      height: 300,
      width: Math.max(420, Math.min(900, facets.length * 260)),
      marginBottom: 44,
      style: {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        background: 'transparent',
        color: INK_SECONDARY,
      },
      x: {
        domain: levels,
        label: `Answer (${variable.min ?? '·'}–${variable.max ?? '·'})`,
        labelAnchor: 'center',
        tickSize: 0,
      },
      y: {
        domain: scale.domain,
        ticks: scale.ticks,
        label: 'Weighted share (%)',
        grid: true,
        tickFormat: (d: number) => `${scale.format(d)}%`,
      },
      ...(faceted ? { fx: { domain: facets, label: null } } : {}),
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
        Plot.ruleX(
          valid.filter((entry) => entry.ci !== null),
          {
            ...facetChannel,
            x: 'level',
            y1: (entry: BinEntry) => entry.ci?.[0],
            y2: (entry: BinEntry) => entry.ci?.[1],
            stroke: WHISKER,
            strokeWidth: 1.5,
          },
        ),
        Plot.barY(suppressed, {
          ...facetChannel,
          x: 'level',
          y: maxY * 0.06,
          fill: SUPPRESSED_HATCH_FILL,
          stroke: 'var(--suppressed-hatch)',
          strokeWidth: 0.5,
          insetLeft: 3,
          insetRight: 3,
        }),
        Plot.tip(
          entries,
          Plot.pointerX({
            ...facetChannel,
            x: 'level',
            y: (entry: BinEntry) => entry.value ?? 0,
            title: (entry: BinEntry) =>
              tipText(entry.row, `${entry.facet} · answer ${entry.level}`, threshold),
            fontFamily: FONT_FAMILY,
          }),
        ),
      ],
    })
  }, [rows, meta, responseMeta, variable, color])

  return (
    <div>
      <div ref={container} />
      {hasSuppressed && (
        <p
          style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)', margin: '4px 0 0' }}
          aria-hidden="true"
        >
          <span style={HATCH_SWATCH} /> hatched = withheld, n &lt; {formatCount(threshold)}
        </p>
      )}
    </div>
  )
}
