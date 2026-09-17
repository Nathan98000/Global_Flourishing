// The fitted-window rule (F1 / ADR-0010 revised): dot, ramp and bin
// scales fit the data, and the window's edges are always themselves
// ticks — a fitted window that does not say where it starts is the one
// way the change could mislead.

import { describe, expect, test } from 'vitest'
import { ciExtents, fittedScale } from '../charts/domain'

describe('fittedScale', () => {
  test('the domain covers the data with padding, edges are ticks', () => {
    const { domain, ticks } = fittedScale([6.8, 7.0, 7.3, 7.5])
    expect(domain[0]).toBeLessThan(6.8)
    expect(domain[1]).toBeGreaterThan(7.5)
    // The edges are the first and last tick — the window states itself.
    expect(ticks[0]).toBe(domain[0])
    expect(ticks[ticks.length - 1]).toBe(domain[1])
    // Fitted means fitted: nowhere near the item's full 0–10 range.
    expect(domain[0]).toBeGreaterThan(5)
    expect(domain[1]).toBeLessThan(9)
  })

  test('ticks land on the nice step and format with matching decimals', () => {
    const scale = fittedScale([5.89, 8.1], { targetTicks: 7 })
    const steps = scale.ticks
      .slice(1)
      .map((tick, i) => Number((tick - (scale.ticks[i] ?? 0)).toFixed(6)))
    expect(new Set(steps).size).toBe(1)
    for (const tick of scale.ticks) {
      expect(Number(scale.format(tick))).toBe(tick)
    }
  })

  test('zeroBaseline keeps zero and fits only the top', () => {
    const { domain, ticks } = fittedScale([1.2, 2.4, 2.9], { zeroBaseline: true, targetTicks: 5 })
    expect(domain[0]).toBe(0)
    expect(ticks[0]).toBe(0)
    expect(domain[1]).toBeGreaterThanOrEqual(2.9)
    expect(domain[1]).toBeLessThan(5) // not the old 10% floor
  })

  test('identical values yield a non-degenerate window', () => {
    const { domain } = fittedScale([7, 7, 7])
    expect(domain[1]).toBeGreaterThan(domain[0])
    expect(domain[0]).toBeLessThanOrEqual(7)
    expect(domain[1]).toBeGreaterThanOrEqual(7)
  })

  test('no finite values fall back to a unit window', () => {
    expect(fittedScale([]).domain).toEqual([0, 1])
    expect(fittedScale([Number.NaN]).domain).toEqual([0, 1])
  })
})

describe('ciExtents', () => {
  test('uses the CI when present, the value otherwise, skips withheld', () => {
    expect(
      ciExtents([
        { value: 7, ci: [6.9, 7.1] },
        { value: 5, ci: null },
        { value: null, ci: null },
      ]),
    ).toEqual([6.9, 7.1, 5])
  })
})
