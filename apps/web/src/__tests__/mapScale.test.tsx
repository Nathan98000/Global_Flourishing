// The choropleth scale and legend shared by the US States map: quantized
// token colors anchored to the observed range, and a legend that labels
// both ends and shows a bordered no-data swatch.

import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { MapLegend, mapDomain, quantizeColor } from '../charts/mapScale'
import { testResponseMeta, testRow } from '../test-utils/fixtures'

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
  test('labels both ends and shows a bordered no-data swatch (§6: no title — the figure names the measure)', () => {
    const { container } = render(<MapLegend domain={[5.89, 8.1]} isShare={false} />)
    const text = container.textContent ?? ''
    // Both ends at one precision.
    expect(text).toContain('5.89')
    expect(text).toContain('8.10')
    expect(text).toContain('no estimate')
    // The empty swatch wears the neutral's own outline, the token the
    // map outlines "no estimate" areas with.
    expect(container.innerHTML).toContain('var(--map-empty-outline)')
    const shares = render(<MapLegend domain={[12.345, 40]} isShare />).container.textContent ?? ''
    expect(shares).toContain('12.3%')
    expect(shares).toContain('40.0%')
  })
})
