// World choropleth: equal-earth projection, sequential scale *quantized*
// onto the seven discrete ramp tokens (no color interpolation — the SVG
// stays var()-themed), anchored to the observed range. Countries with no
// value wear the empty fill and say so in the tip; sub-pixel territories
// (Hong Kong) get a labelled centroid marker so no country silently
// disappears from a map of 23 (ADR-0010).

import * as Plot from '@observablehq/plot'
import type { EstimateRow, Meta, ResponseMeta } from '../api/types'
import { ciLabel, formatEstimate } from '../format'
import {
  FONT_FAMILY,
  INK_SECONDARY,
  MAP_EMPTY,
  SEQUENTIAL_RAMP,
  SURFACE,
  plotValue,
  quantizeSequential,
} from './theme'
import { chartWidth, usePlot } from './usePlot'
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
      value: row ? plotValue(row) : null,
      small: bboxAreaSqDeg(feature.geometry) < SMALL_TERRITORY_SQ_DEG,
    })
  }
  return { entries, missing }
}

/** The map's quantized sequential scale (shared with the What Matters matrix). */
export const quantizeColor = quantizeSequential

export function Choropleth({
  rows,
  meta,
  responseMeta,
  features,
  selected,
  levelLabel,
}: {
  rows: EstimateRow[]
  meta: Meta
  responseMeta: ResponseMeta
  features: WorldFeature[]
  selected?: readonly number[]
  levelLabel?: string
}) {
  const container = usePlot(
    (available) => {
      const { entries } = joinCountries(rows, meta, features)
      const domain = mapDomain(rows, responseMeta)
      const width = chartWidth(720, available)
      const color = quantizeColor(domain)
      const fillOf = (entry: MapEntry): string =>
        entry.value === null ? MAP_EMPTY : color(entry.value)
      // The map tip carries country, value and interval — nothing else
      // (round-2 item 9); n lives in the data table.
      const tipOf = (entry: MapEntry): string => {
        if (!entry.row) return `${entry.label}\nno estimate at this wave`
        const row = entry.row
        const lines = [`${formatEstimate(row.estimate, row.stat)}  ${entry.label}`]
        if (row.ci_lo !== null && row.ci_hi !== null) {
          lines.push(
            `${ciLabel(row.ci_level)} ${formatEstimate(row.ci_lo, row.stat)} to ${formatEstimate(row.ci_hi, row.stat)}`,
          )
        }
        return lines.join('\n')
      }
      const small = entries.filter((entry) => entry.small)
      const selectedSet = new Set(selected ?? [])
      const highlighted = entries.filter((entry) =>
        selectedSet.has(Number(entry.row?.group['country_code'])),
      )

      return Plot.plot({
        width,
        height: Math.round((width * 400) / 720),
        style: {
          fontFamily: FONT_FAMILY,
          fontSize: '11px',
          background: 'transparent',
          color: INK_SECONDARY,
        },
        projection: 'equal-earth',
        marks: [
          // No sphere outline (§6): land floats on the page surface.
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
    },
    [rows, meta, responseMeta, features, selected, levelLabel],
  )

  return <div ref={container} />
}

const legendValue = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

/** Discrete legend for the quantized ramp (§6): a 140px ramp under the
 * subtitle with min and max values only — the title and subtitle above
 * already name the measure — plus an explicit swatch for countries with
 * no estimate, bordered so it reads apart from non-study land. */
export function MapLegend({
  domain,
  isShare,
  pooled = false,
}: {
  domain: [number, number]
  isShare: boolean
  /** The US map: an entry for the outlined pooled small-state groups. */
  pooled?: boolean
}) {
  const render = (value: number) => `${legendValue.format(value)}${isShare ? '%' : ''}`
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, flexWrap: 'wrap' }}
      aria-hidden="true"
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>{render(domain[0])}</span>
        <span style={{ display: 'flex' }}>
          {SEQUENTIAL_RAMP.map((token) => (
            <span
              key={token}
              style={{ width: 20, height: 10, background: token, display: 'inline-block' }}
            />
          ))}
        </span>
        <span>{render(domain[1])}</span>
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            width: 20,
            height: 10,
            background: MAP_EMPTY,
            border: '1px solid var(--axis)',
            display: 'inline-block',
          }}
        />
        <span>no estimate</span>
      </span>
      {pooled && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 20,
              height: 10,
              border: '1.5px dashed var(--ink)',
              display: 'inline-block',
            }}
          />
          <span>pooled small states (one estimate for the group)</span>
        </span>
      )}
    </div>
  )
}

/** The ramp anchors to the observed range (F1): the map's job is to
 * separate the 23 countries, and the legend's labelled ends say exactly
 * what the window is. Countries without a value wear the empty fill. */
export function mapDomain(rows: EstimateRow[], responseMeta: ResponseMeta): [number, number] {
  const isShare = responseMeta.stat === 'proportion' || responseMeta.stat === 'distribution'
  const values = rows.map((row) => plotValue(row)).filter((v): v is number => v !== null)
  if (values.length === 0) return [0, 1]
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  if (hi - lo < 1e-9) {
    const pad = isShare ? 1 : 0.5
    lo = isShare ? Math.max(0, lo - pad) : lo - pad
    hi += pad
  }
  return [lo, hi]
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
