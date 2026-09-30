// The choropleth's scale and legend: a sequential scale *quantized* onto
// the seven discrete ramp tokens (no color interpolation — the SVG stays
// var()-themed), anchored to the observed range, and the discrete legend
// that names the window's ends. Shared by the US States map and the What
// Matters matrix; the world map that first used it was dropped in the
// September 2026 design pass (ADR-0016: too few countries for a map).

import type { EstimateRow, ResponseMeta } from '../api/types'
import {
  MAP_EMPTY,
  MAP_EMPTY_OUTLINE,
  SEQUENTIAL_RAMP,
  plotValue,
  quantizeSequential,
} from './theme'

/** The map's quantized sequential scale (shared with the What Matters matrix). */
export const quantizeColor = quantizeSequential

// Both ends of the legend at one precision: two decimals for a score,
// one for a share.
const legendScore = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const legendShare = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

/** Discrete legend for the quantized ramp (§6): a 140px ramp under the
 * subtitle with min and max values only — the title and subtitle above
 * already name the measure — plus an explicit swatch for areas with no
 * estimate, bordered so it reads apart from non-study land. */
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
  const render = (value: number) =>
    isShare ? `${legendShare.format(value)}%` : legendScore.format(value)
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
            border: `1px solid ${MAP_EMPTY_OUTLINE}`,
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
 * separate the areas it shows, and the legend's labelled ends say exactly
 * what the window is. Areas without a value wear the empty fill. */
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
