// One render test per chart against synthetic fixtures: the marks exist,
// labels come from meta, suppression renders in place, colors are token
// vars (never hex) so both themes recolor the same SVG.

import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { Histogram } from '../charts/Histogram'
import { RankedBar, rankEntries } from '../charts/RankedBar'
import { SmallMultiples, facetOrder } from '../charts/SmallMultiples'
import {
  attendVariable,
  happyVariable,
  testMeta,
  testResponseMeta,
  testRow,
} from '../test-utils/fixtures'

const rows = [
  testRow({ group: { country_code: 22 }, estimate: 7.4, ci_lo: 7.3, ci_hi: 7.5 }),
  testRow({
    group: { country_code: 1 },
    estimate: 6.9,
    ci_lo: 6.8,
    ci_hi: 7.0,
    flagged: true,
    n: 73,
  }),
  testRow({
    group: { country_code: 24 },
    suppressed: true,
    estimate: null,
    ci_lo: null,
    ci_hi: null,
    n: 31,
  }),
]

const metaWithHK = {
  ...testMeta,
  countries: [...testMeta.countries, { code: 24, name: 'Hong Kong', iso3: 'HKG' }],
}

describe('rankEntries', () => {
  test('ranks by estimate with suppressed last, or by name', () => {
    const ranked = rankEntries(rows, metaWithHK, 'estimate')
    expect(ranked.map((entry) => entry.label)).toEqual(['United States', 'Testland', 'Hong Kong'])
    const byName = rankEntries(rows, metaWithHK, 'name')
    expect(byName.map((entry) => entry.label)).toEqual(['Hong Kong', 'Testland', 'United States'])
  })
})

describe('RankedBar', () => {
  test('0–10 means render as dot + CI on a fitted window, every row labelled', () => {
    const { container } = render(
      <RankedBar
        rows={rows}
        meta={metaWithHK}
        responseMeta={testResponseMeta()}
        variable={happyVariable}
        color="var(--sfi-happiness)"
        sort="estimate"
      />,
    )
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    const text = svg?.textContent ?? ''
    expect(text).toContain('United States')
    expect(text).toContain('Hong Kong')
    expect(text).toContain('withheld (n = 31)')
    expect(text).toContain('†') // the flagged marker rides the value label
    // Direct value label on every row (F16), not just the leader.
    expect(text).toContain('7.40')
    expect(text).toContain('6.90')
    expect(text).toContain('higher is better') // direction on the axis
    // The mark is a dot, not a zero-based bar (F1)…
    expect(svg?.querySelectorAll('circle')).toHaveLength(2)
    // …on a window fitted to the data (CIs 6.8–7.5), whose first and
    // last ticks are the window's edges: the axis says where the chart
    // starts and ends, and never reaches back to zero.
    const ticks = [...(svg?.querySelectorAll('[aria-label="x-axis tick label"] text') ?? [])].map(
      (node) => node.textContent,
    )
    expect(ticks[0]).toBe('6.6')
    expect(ticks[ticks.length - 1]).toBe('7.6')
    expect(ticks).not.toContain('0')
    // Marks wear tokens, not hex; the SVG stays out of the a11y tree
    // (the figure + table carry it).
    expect(svg?.innerHTML).toContain('var(--sfi-happiness)')
    expect(svg?.innerHTML).not.toMatch(/#[0-9a-f]{6}/i)
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
  })

  test('shares keep zero-based bars, with every row labelled', () => {
    const shareRows = [
      testRow({
        group: { country_code: 22 },
        stat: 'proportion',
        estimate: 0.61,
        ci_lo: 0.59,
        ci_hi: 0.63,
      }),
      testRow({
        group: { country_code: 1 },
        stat: 'proportion',
        estimate: 0.22,
        ci_lo: 0.2,
        ci_hi: 0.24,
      }),
    ]
    const { container } = render(
      <RankedBar
        rows={shareRows}
        meta={testMeta}
        responseMeta={testResponseMeta({ stat: 'proportion' })}
        variable={attendVariable}
        color="var(--series-1)"
        sort="estimate"
        levelLabel="More than once a week"
      />,
    )
    const svg = container.querySelector('svg')
    const text = svg?.textContent ?? ''
    expect(svg?.querySelectorAll('rect').length).toBeGreaterThan(0) // bars stay bars
    expect(text).toContain('0%') // and keep their zero baseline
    expect(text).toContain('61.0%')
    expect(text).toContain('22.0%')
    expect(svg?.querySelector('#suppressed-hatch')).not.toBeNull()
  })

  test('quantile rows render without whiskers (no CIs yet, per METHODS)', () => {
    const medianRows = [
      testRow({ stat: 'quantile', p: 0.5, ci_lo: null, ci_hi: null, se: null, estimate: 7 }),
    ]
    const { container } = render(
      <RankedBar
        rows={medianRows}
        meta={testMeta}
        responseMeta={testResponseMeta({ stat: 'quantile' })}
        variable={happyVariable}
        color="var(--series-1)"
        sort="estimate"
      />,
    )
    expect(container.querySelector('svg')?.textContent).toContain('Median')
  })
})

describe('Histogram', () => {
  test('renders every bin including suppressed ones, on a y-domain fitted to the tallest bin', () => {
    const bins = Array.from({ length: 11 }, (_, level) =>
      testRow({
        group: { country_code: 1 },
        stat: 'distribution',
        level,
        estimate: level === 4 ? null : 0.005 + level * 0.002,
        ci_lo: level === 4 ? null : 0.003 + level * 0.002,
        ci_hi: level === 4 ? null : 0.008 + level * 0.002,
        suppressed: level === 4,
        n: level === 4 ? 12 : 220,
      }),
    )
    const { container } = render(
      <Histogram
        rows={bins}
        meta={testMeta}
        responseMeta={testResponseMeta({ stat: 'distribution' })}
        variable={happyVariable}
        color="var(--series-1)"
      />,
    )
    const svg = container.querySelector('svg')
    expect(svg?.textContent).toContain('Weighted share (%)')
    expect(svg?.textContent).toContain('Answer (0–10)')
    // 10 value bars + 1 hatched stub for the suppressed bin.
    expect(svg?.innerHTML).toContain('url(#suppressed-hatch)')
    expect(svg?.innerHTML).toContain('var(--series-1)')
    // The y-domain fits the tallest bin (max CI 2.8%), keeps its zero
    // baseline, and labels both edges — no 10% floor (F1).
    const ticks = [...(svg?.querySelectorAll('[aria-label="y-axis tick label"] text') ?? [])].map(
      (node) => node.textContent,
    )
    expect(ticks).toContain('0%')
    expect(ticks).not.toContain('10%')
    // The hatch is named, with the served rule (F10).
    expect(container.textContent).toContain('hatched = withheld, n < 50')
  })

  test('the hatch legend appears only when something is withheld', () => {
    const bins = [0, 1].map((level) =>
      testRow({ group: { country_code: 1 }, stat: 'distribution', level, estimate: 0.02 }),
    )
    const { container } = render(
      <Histogram
        rows={bins}
        meta={testMeta}
        responseMeta={testResponseMeta({ stat: 'distribution' })}
        variable={happyVariable}
        color="var(--series-1)"
      />,
    )
    expect(container.textContent).not.toContain('hatched')
  })
})

describe('SmallMultiples', () => {
  const cellRows = [1, 22].flatMap((code) =>
    [1, 2].map((gender) =>
      testRow({
        group: { country_code: code, gender },
        estimate: code === 22 ? 7 + gender * 0.2 : 6 + gender * 0.1,
        ci_lo: 5.9,
        ci_hi: 7.5,
        suppressed: code === 1 && gender === 2,
        n: code === 1 && gender === 2 ? 22 : 400,
      }),
    ),
  )

  test('facet order follows the sort rule', () => {
    expect(facetOrder(cellRows, testMeta, 'country_code', 'estimate')).toEqual([
      'United States',
      'Testland',
    ])
    expect(facetOrder(cellRows, testMeta, 'country_code', 'name')).toEqual([
      'Testland',
      'United States',
    ])
  })

  test('renders one panel per country with served level labels', () => {
    const { container } = render(
      <SmallMultiples
        rows={cellRows}
        meta={testMeta}
        responseMeta={testResponseMeta({ by: ['country_code', 'gender'] })}
        variable={happyVariable}
        color="var(--series-1)"
        levelColumn="gender"
        levelDomain={['Male', 'Female']}
        sort="estimate"
      />,
    )
    const svg = container.querySelector('svg')
    const text = svg?.textContent ?? ''
    expect(text).toContain('United States')
    expect(text).toContain('Male')
    expect(text).toContain('Female')
    expect(text).toContain('withheld (n = 22)')
  })

  test('one shared, data-fitted window; its ticks repeat inside every panel', () => {
    const { container } = render(
      <SmallMultiples
        rows={cellRows}
        meta={testMeta}
        responseMeta={testResponseMeta({ by: ['country_code', 'gender'] })}
        variable={happyVariable}
        color="var(--series-1)"
        levelColumn="gender"
        levelDomain={['Male', 'Female']}
        sort="estimate"
      />,
    )
    const svg = container.querySelector('svg')
    // The shared axis states the window's edges (data spans 5.9–7.5)…
    const axisTicks = [
      ...(svg?.querySelectorAll('[aria-label="x-axis tick label"] text') ?? []),
    ].map((node) => node.textContent)
    expect(axisTicks[0]).toBe('5.5')
    expect(axisTicks[axisTicks.length - 1]).toBe('8.0')
    expect(axisTicks).not.toContain('0.0')
    // …and each of the two panels carries its own copy of the ticks, so
    // no panel is read against an axis a page away.
    const inPanelTicks = [...(svg?.querySelectorAll('text') ?? [])].filter(
      (node) => node.textContent === '6.0',
    )
    expect(inPanelTicks.length).toBeGreaterThanOrEqual(2)
  })
})

test('screen has no leaked chart between tests', () => {
  expect(screen.queryByText('United States')).toBeNull()
})
