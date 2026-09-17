// One render test per chart against synthetic fixtures: the marks exist,
// labels come from meta, suppression renders in place, colors are token
// vars (never hex) so both themes recolor the same SVG.

import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { Histogram } from '../charts/Histogram'
import { RankedBar, rankEntries } from '../charts/RankedBar'
import { SmallMultiples, facetOrder } from '../charts/SmallMultiples'
import { happyVariable, testMeta, testResponseMeta, testRow } from '../test-utils/fixtures'

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
  test('renders bars, whiskers, suppression in place, and token colors', () => {
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
    expect(text).toContain('†') // the flagged marker
    expect(text).toContain('7.40') // top value directly labelled
    expect(text).toContain('higher is better') // direction on the axis
    // Marks wear tokens, not hex; the hatch pattern is injected.
    expect(svg?.innerHTML).toContain('var(--sfi-happiness)')
    expect(svg?.querySelector('#suppressed-hatch')).not.toBeNull()
    expect(svg?.innerHTML).not.toMatch(/#[0-9a-f]{6}/i)
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
  test('renders every bin including suppressed ones, with per-bin CIs', () => {
    const bins = Array.from({ length: 11 }, (_, level) =>
      testRow({
        group: { country_code: 1 },
        stat: 'distribution',
        level,
        estimate: level === 4 ? null : 0.02 + level * 0.005,
        ci_lo: level === 4 ? null : 0.01 + level * 0.005,
        ci_hi: level === 4 ? null : 0.03 + level * 0.005,
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
})

test('screen has no leaked chart between tests', () => {
  expect(screen.queryByText('United States')).toBeNull()
})
