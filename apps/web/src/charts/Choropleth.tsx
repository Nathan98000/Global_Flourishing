// World choropleth: equal-earth projection, sequential scale *quantized*
// onto the seven discrete ramp tokens (no color interpolation — the SVG
// stays var()-themed) and anchored to the item's [min, max]. Countries
// with withheld or missing values wear the empty fill and say so in the
// tip; sub-pixel territories (Hong Kong) get a labelled centroid marker
// so no country silently disappears from a map of 23 (ADR-0010).

import * as Plot from '@observablehq/plot'
import type { EstimateRow, Meta, ResponseMeta, VariableSummary } from '../api/types'
import {
  FONT_FAMILY,
  INK_SECONDARY,
  MAP_EMPTY,
  SEQUENTIAL_RAMP,
  SURFACE,
  plotValue,
  tipText,
} from './theme'
import { usePlot } from './usePlot'
import {
  ISO3_TO_NUMERIC,
  SMALL_TERRITORY_SQ_DEG,
  bboxAreaSqDeg,
  type WorldFeature,
} from './worldTopology'

export interface MapEntry {
  feature: WorldFeature
  row: EstimateRow | null
  label: string
  value: number | null
  small: boolean
}

/** Join estimate rows to topology features through meta's ISO3 codes.
 *
 * Natural Earth reuses an id across a country and its outlying
 * territories (countries-50m: "036" is Australia *and* Ashmore and
 * Cartier Is.), so per id the principal — largest-extent — feature wins.
 */
export function joinCountries(
  rows: EstimateRow[],
  meta: Meta,
  features: WorldFeature[],
): { entries: MapEntry[]; missing: string[] } {
  const byNumericId = new Map<string, WorldFeature>()
  for (const item of features) {
    const id = String(item.id)
    const existing = byNumericId.get(id)
    if (!existing || bboxAreaSqDeg(item.geometry) > bboxAreaSqDeg(existing.geometry)) {
      byNumericId.set(id, item)
    }
  }
  const rowByCode = new Map(rows.map((row) => [Number(row.group['country_code']), row]))
  const entries: MapEntry[] = []
  const missing: string[] = []
  for (const country of meta.countries) {
    const numeric = ISO3_TO_NUMERIC[country.iso3]
    const feature = numeric ? byNumericId.get(numeric) : undefined
    if (!feature) {
      missing.push(country.iso3)
      continue
    }
    const row = rowByCode.get(country.code) ?? null
    entries.push({
      feature,
      row,
      label: country.name,
      value: row && !row.suppressed ? plotValue(row) : null,
      small: bboxAreaSqDeg(feature.geometry) < SMALL_TERRITORY_SQ_DEG,
    })
  }
  return { entries, missing }
}

export function quantizeColor(domain: [number, number]): (value: number) => string {
  const [lo, hi] = domain
  const steps = SEQUENTIAL_RAMP.length
  return (value: number) => {
    if (hi <= lo) return SEQUENTIAL_RAMP[0]
    const t = Math.min(1, Math.max(0, (value - lo) / (hi - lo)))
    const index = Math.min(steps - 1, Math.floor(t * steps))
    return SEQUENTIAL_RAMP[index] as string
  }
}

export function Choropleth({
  rows,
  meta,
  responseMeta,
  variable,
  features,
  selected,
  levelLabel,
}: {
  rows: EstimateRow[]
  meta: Meta
  responseMeta: ResponseMeta
  variable: VariableSummary
  features: WorldFeature[]
  selected?: readonly number[]
  levelLabel?: string
}) {
  const container = usePlot(() => {
    const { entries } = joinCountries(rows, meta, features)
    const domain = mapDomain(rows, responseMeta, variable)
    const color = quantizeColor(domain)
    const threshold = responseMeta.suppression.threshold
    const fillOf = (entry: MapEntry): string =>
      entry.value === null ? MAP_EMPTY : color(entry.value)
    const tipOf = (entry: MapEntry): string =>
      entry.row
        ? tipText(entry.row, entry.label, threshold)
        : `${entry.label}\nno estimate at this wave`
    const small = entries.filter((entry) => entry.small)
    const selectedSet = new Set(selected ?? [])
    const highlighted = entries.filter((entry) =>
      selectedSet.has(Number(entry.row?.group['country_code'])),
    )

    return Plot.plot({
      width: 720,
      height: 400,
      style: {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        background: 'transparent',
        color: INK_SECONDARY,
      },
      projection: 'equal-earth',
      marks: [
        Plot.sphere({ stroke: 'var(--grid)' }),
        Plot.geo(features, { fill: MAP_EMPTY, stroke: SURFACE, strokeWidth: 0.4 }),
        Plot.geo(entries, {
          geometry: (entry: MapEntry) => entry.feature,
          fill: fillOf,
          stroke: SURFACE,
          strokeWidth: 0.4,
          tip: true,
          title: tipOf,
        }),
        Plot.geo(highlighted, {
          geometry: (entry: MapEntry) => entry.feature,
          fill: 'none',
          stroke: 'var(--ink)',
          strokeWidth: 1.2,
        }),
        Plot.dot(small, {
          x: (entry: MapEntry) => featureCentroid(entry.feature)[0],
          y: (entry: MapEntry) => featureCentroid(entry.feature)[1],
          r: 5,
          fill: fillOf,
          stroke: SURFACE,
          strokeWidth: 2,
          tip: true,
          title: tipOf,
        }),
        Plot.text(small, {
          x: (entry: MapEntry) => featureCentroid(entry.feature)[0],
          y: (entry: MapEntry) => featureCentroid(entry.feature)[1],
          text: (entry: MapEntry) => entry.label,
          dx: 10,
          textAnchor: 'start',
          fill: 'var(--ink)',
          stroke: SURFACE,
          strokeWidth: 3,
          paintOrder: 'stroke',
          fontSize: 11,
        }),
      ],
    })
  }, [rows, meta, responseMeta, variable, features, selected, levelLabel])

  return <div ref={container} />
}

/** Discrete legend for the quantized ramp: seven swatches, labelled ends. */
export function MapLegend({ domain, isShare }: { domain: [number, number]; isShare: boolean }) {
  const render = (value: number) => (isShare ? `${Math.round(value)}%` : String(value))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }} aria-hidden="true">
      <span>{render(domain[0])}</span>
      <span style={{ display: 'flex' }}>
        {SEQUENTIAL_RAMP.map((token) => (
          <span
            key={token}
            style={{ width: 22, height: 10, background: token, display: 'inline-block' }}
          />
        ))}
      </span>
      <span>{render(domain[1])}</span>
    </div>
  )
}

export function mapDomain(
  rows: EstimateRow[],
  responseMeta: ResponseMeta,
  variable: VariableSummary,
): [number, number] {
  const isShare = responseMeta.stat === 'proportion' || responseMeta.stat === 'distribution'
  const values = rows
    .map((row) => (row.suppressed ? null : plotValue(row)))
    .filter((v): v is number => v !== null)
  if (isShare) return [0, Math.max(10, ...values)]
  return [variable.min ?? Math.min(...values), variable.max ?? Math.max(...values)]
}

const centroidCache = new WeakMap<object, [number, number]>()

/** Rough lon/lat centroid (bbox middle) — good enough to anchor markers
 * and pointer targets; the fill itself is the geometry. */
export function featureCentroid(feature: WorldFeature): [number, number] {
  const cached = centroidCache.get(feature)
  if (cached) return cached
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const visit = (node: unknown): void => {
    if (!Array.isArray(node)) return
    if (node.length >= 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
      const [x, y] = node as [number, number]
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      return
    }
    for (const child of node) visit(child)
  }
  visit(feature.geometry?.coordinates)
  const centroid: [number, number] = minX > maxX ? [0, 0] : [(minX + maxX) / 2, (minY + maxY) / 2]
  centroidCache.set(feature, centroid)
  return centroid
}
