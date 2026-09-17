// The map against the real shipped topology (world-atlas countries-50m):
// all 23 countries resolve to features — Hong Kong included (the reason
// 50m was chosen, ADR-0010) — small territories get markers, and the
// choropleth renders with quantized token colors.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { Meta } from '../api/types'
import {
  Choropleth,
  MapLegend,
  joinCountries,
  mapDomain,
  quantizeColor,
} from '../charts/Choropleth'
import {
  ISO3_TO_NUMERIC,
  SMALL_TERRITORY_SQ_DEG,
  bboxAreaSqDeg,
  featuresFromTopology,
} from '../charts/worldTopology'
import { testMeta, testResponseMeta, testRow } from '../test-utils/fixtures'

const topology = JSON.parse(
  readFileSync(join(process.cwd(), 'node_modules', 'world-atlas', 'countries-50m.json'), 'utf8'),
) as unknown

const features = featuresFromTopology(topology)

// The release's 23 countries (codes as in the real catalog).
const REAL_COUNTRIES: [number, string, string][] = [
  [1, 'Argentina', 'ARG'],
  [2, 'Australia', 'AUS'],
  [3, 'Brazil', 'BRA'],
  [4, 'Egypt', 'EGY'],
  [5, 'Germany', 'DEU'],
  [6, 'India', 'IND'],
  [7, 'Indonesia', 'IDN'],
  [8, 'Israel', 'ISR'],
  [9, 'Japan', 'JPN'],
  [10, 'Kenya', 'KEN'],
  [11, 'Mexico', 'MEX'],
  [12, 'Nigeria', 'NGA'],
  [13, 'Philippines', 'PHL'],
  [14, 'Poland', 'POL'],
  [16, 'South Africa', 'ZAF'],
  [17, 'Spain', 'ESP'],
  [18, 'Tanzania', 'TZA'],
  [19, 'Türkiye', 'TUR'],
  [20, 'United Kingdom', 'GBR'],
  [22, 'United States', 'USA'],
  [23, 'Sweden', 'SWE'],
  [24, 'Hong Kong', 'HKG'],
  [25, 'China', 'CHN'],
]

const worldMeta: Meta = {
  ...testMeta,
  countries: REAL_COUNTRIES.map(([code, name, iso3]) => ({ code, name, iso3 })),
}

describe('the topology join', () => {
  test('no country silently disappears from a map of 23', () => {
    const rows = REAL_COUNTRIES.map(([code]) =>
      testRow({ group: { country_code: code }, estimate: 5 + (code % 5) }),
    )
    const { entries, missing } = joinCountries(rows, worldMeta, features)
    expect(missing).toEqual([])
    expect(entries).toHaveLength(23)
    // Hong Kong is the only sub-pixel territory among the 23.
    expect(entries.filter((entry) => entry.small).map((entry) => entry.label)).toEqual([
      'Hong Kong',
    ])
  })

  test('duplicate NE ids resolve to the principal feature (Australia, not Ashmore)', () => {
    const rows = [testRow({ group: { country_code: 2 }, estimate: 7 })]
    const { entries } = joinCountries(rows, worldMeta, features)
    const australia = entries.find((entry) => entry.label === 'Australia')
    expect(australia).toBeDefined()
    expect(bboxAreaSqDeg(australia?.feature.geometry ?? null)).toBeGreaterThan(1000)
  })

  test('Hong Kong exists in countries-50m and is a small territory', () => {
    const hk = features.find((feature) => String(feature.id) === ISO3_TO_NUMERIC['HKG'])
    expect(hk).toBeDefined()
    expect(bboxAreaSqDeg(hk?.geometry ?? null)).toBeLessThan(SMALL_TERRITORY_SQ_DEG)
    // …while a mid-sized country is not.
    const israel = features.find((feature) => String(feature.id) === ISO3_TO_NUMERIC['ISR'])
    expect(bboxAreaSqDeg(israel?.geometry ?? null)).toBeGreaterThan(SMALL_TERRITORY_SQ_DEG)
  })

  test('every join id points at a real feature', () => {
    const ids = new Set(features.map((feature) => String(feature.id)))
    for (const [iso3, numeric] of Object.entries(ISO3_TO_NUMERIC)) {
      expect(ids.has(numeric), iso3).toBe(true)
    }
  })
})

describe('quantized token colors', () => {
  test('the ramp is the seven tokens, lightest to darkest, clamped', () => {
    const color = quantizeColor([0, 10])
    expect(color(-1)).toBe('var(--seq-100)')
    expect(color(0)).toBe('var(--seq-100)')
    expect(color(9.99)).toBe('var(--seq-700)')
    expect(color(10)).toBe('var(--seq-700)')
    expect(color(5)).toBe('var(--seq-400)')
  })

  test('the ramp anchors to the observed range, not the item scale (F1)', () => {
    const rows = [
      testRow({ group: { country_code: 1 }, estimate: 5.89, ci_lo: null, ci_hi: null }),
      testRow({ group: { country_code: 22 }, estimate: 8.1, ci_lo: null, ci_hi: null }),
      testRow({ group: { country_code: 24 }, suppressed: true, estimate: null }),
    ]
    expect(mapDomain(rows, testResponseMeta())).toEqual([5.89, 8.1])
    const shares = [
      testRow({ stat: 'proportion', estimate: 0.22 }),
      testRow({ group: { country_code: 22 }, stat: 'proportion', estimate: 0.61 }),
    ]
    expect(mapDomain(shares, testResponseMeta({ stat: 'proportion' }))).toEqual([22, 61])
  })

  test('a single observed value still yields a non-degenerate window', () => {
    const rows = [testRow({ estimate: 7 })]
    const [lo, hi] = mapDomain(rows, testResponseMeta())
    expect(hi).toBeGreaterThan(lo)
  })
})

describe('MapLegend', () => {
  test('names the measure, labels both ends, and shows the no-data swatch', () => {
    const { container } = render(
      <MapLegend domain={[5.89, 8.1]} isShare={false} title="Secure Flourishing Index" />,
    )
    const text = container.textContent ?? ''
    expect(text).toContain('Secure Flourishing Index')
    expect(text).toContain('5.89')
    expect(text).toContain('8.1')
    expect(text).toContain('no estimate')
  })
})

describe('Choropleth', () => {
  test('renders fills from tokens, an HK marker, and honest empties', () => {
    const rows = [
      ...REAL_COUNTRIES.slice(0, 20).map(([code]) =>
        testRow({ group: { country_code: code }, estimate: 4 + (code % 6) }),
      ),
      testRow({
        group: { country_code: 24 },
        estimate: 6,
        ci_lo: 5.9,
        ci_hi: 6.1,
      }),
      testRow({ group: { country_code: 25 }, suppressed: true, estimate: null, n: 30 }),
    ]
    const { container } = render(
      <Choropleth
        rows={rows}
        meta={worldMeta}
        responseMeta={testResponseMeta()}
        features={features}
        selected={[22]}
      />,
    )
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.innerHTML).toContain('var(--seq-')
    expect(svg?.innerHTML).toContain('var(--map-empty)')
    expect(svg?.textContent).toContain('Hong Kong') // the centroid marker label
  })
})
