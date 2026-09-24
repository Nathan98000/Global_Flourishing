// One render test per chart against synthetic fixtures: the marks exist,
// labels come from meta, suppression renders in place, colors are token
// vars (never hex) so both themes recolor the same SVG.

import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { capitalize } from '../charts/ChartFigure'
import { Histogram } from '../charts/Histogram'
import { TIP_OPTIONS } from '../charts/theme'
import { RankedBar, rankEntries } from '../charts/RankedBar'
import { SmallMultiples, facetOrder } from '../charts/SmallMultiples'
import {
  attendVariable,
  happyVariable,
  sfiVariable,
  testMeta,
  testResponseMeta,
  testRow,
} from '../test-utils/fixtures'

const rows = [
  testRow({ group: { country_code: 22 }, estimate: 7.4, ci_lo: 7.3, ci_hi: 7.5 }),
  testRow({ group: { country_code: 1 }, estimate: 6.9, ci_lo: 6.8, ci_hi: 7.0, n: 73 }),
  // A 3-person cell: shown like any other (ADR-0011), but a lone PSU
  // yields no computable interval — the dot draws without a whisker.
  testRow({
    group: { country_code: 24 },
    estimate: 6.2,
    se: null,
    ci_lo: null,
    ci_hi: null,
    n: 3,
  }),
]

const metaWithHK = {
  ...testMeta,
  countries: [...testMeta.countries, { code: 24, name: 'Hong Kong', iso3: 'HKG' }],
}

describe('rankEntries', () => {
  test('keeps the input order — sorting is sortRows.ts, shared with the table', () => {
    const entries = rankEntries(rows, metaWithHK)
    expect(entries.map((entry) => entry.label)).toEqual(['United States', 'Testland', 'Hong Kong'])
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
      />,
    )
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    const text = svg?.textContent ?? ''
    expect(text).toContain('United States')
    expect(text).toContain('Hong Kong')
    // Every cell appears, small ones included, with no flag or
    // withheld state (ADR-0011); every row carries its value (F16).
    expect(text).toContain('7.40')
    expect(text).toContain('6.90')
    expect(text).toContain('6.20')
    expect(text).not.toMatch(/withheld|†/)
    // The mark is a dot, not a zero-based bar (F1) — all three rows,
    // the interval-less one included…
    expect(svg?.querySelectorAll('circle')).toHaveLength(3)
    // …but only the two computable intervals draw whiskers.
    expect(
      [...(svg?.querySelectorAll('[aria-label="rule"] line') ?? [])].length,
    ).toBeLessThanOrEqual(2)
    // …on a window fitted to the data (CIs 6.8–7.5), whose first and
    // last ticks are the window's edges: the axis says where the chart
    // starts and ends, and never reaches back to zero.
    const ticks = [...(svg?.querySelectorAll('[aria-label="x-axis tick label"] text') ?? [])].map(
      (node) => node.textContent,
    )
    expect(ticks[0]).toBe('6.00')
    expect(ticks[ticks.length - 1]).toBe('7.75')
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
        levelLabel="More than once a week"
      />,
    )
    const svg = container.querySelector('svg')
    const text = svg?.textContent ?? ''
    // Rounded bars render as paths in the "bar" mark group.
    expect(svg?.querySelectorAll('[aria-label="bar"] > *').length).toBe(2) // bars stay bars
    expect(text).toContain('0%') // and keep their zero baseline
    expect(text).toContain('61.0%')
    expect(text).toContain('22.0%')
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
      />,
    )
    const svg = container.querySelector('svg')
    expect(svg?.querySelectorAll('circle')).toHaveLength(1)
    expect(svg?.textContent).toContain('7.00')
  })
})

describe('Histogram', () => {
  test('renders every bin, small ones included, on a y-domain fitted to the tallest bin', () => {
    const bins = Array.from({ length: 11 }, (_, level) =>
      testRow({
        group: { country_code: 1 },
        stat: 'distribution',
        level,
        estimate: 0.005 + level * 0.002,
        ci_lo: 0.003 + level * 0.002,
        ci_hi: 0.008 + level * 0.002,
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
    // Eleven bars, the 12-person bin drawn like any other (ADR-0011).
    expect(svg?.querySelectorAll('[aria-label="bar"] > *').length).toBe(11)
    expect(svg?.innerHTML).toContain('var(--series-1)')
    expect(container.textContent).not.toMatch(/withheld|hatched/)
    // The y-domain fits the tallest bin (max CI 2.8%), keeps its zero
    // baseline, and labels both edges — no 10% floor (F1).
    const ticks = [...(svg?.querySelectorAll('[aria-label="y-axis tick label"] text') ?? [])].map(
      (node) => node.textContent,
    )
    expect(ticks).toContain('0%')
    expect(ticks).not.toContain('10%')
  })

  test('a derived score is binned by the server: ten bins, labelled from its value labels', () => {
    const bins = Array.from({ length: 10 }, (_, level) =>
      testRow({
        group: { country_code: 1 },
        stat: 'distribution',
        level,
        estimate: 0.1,
        ci_lo: 0.08,
        ci_hi: 0.12,
        n: 100,
      }),
    )
    const labels = Array.from({ length: 10 }, (_, level) => `${level}–${level + 1}`)
    const { container } = render(
      <Histogram
        rows={bins}
        meta={testMeta}
        responseMeta={testResponseMeta({ stat: 'distribution', outcome: 'sfi' })}
        variable={sfiVariable}
        color="var(--series-1)"
        levels={bins.map((row) => row.level as number)}
        levelLabel={(level) => labels[level] ?? String(level)}
        xLabel="Score (0–10), 1-point bins"
      />,
    )
    const svg = container.querySelector('svg')
    expect(svg?.querySelectorAll('[aria-label="bar"] > *').length).toBe(10)
    expect(svg?.textContent).toContain('Score (0–10), 1-point bins')
    expect(svg?.textContent).toContain('0–1')
    expect(svg?.textContent).toContain('9–10')
  })
})

describe('figure copy', () => {
  test('a subtitle starts with a capital letter, whatever clause leads', () => {
    expect(capitalize('share answering “Weekly” · Wave 1, 2023')).toBe(
      'Share answering “Weekly” · Wave 1, 2023',
    )
    expect(capitalize('Average score')).toBe('Average score')
    expect(capitalize('')).toBe('')
  })
})

describe('tooltips', () => {
  test('every tip uses the 12px token size and the rule token as its stroke', () => {
    expect(TIP_OPTIONS.fontSize).toBe(12)
    expect(TIP_OPTIONS.stroke).toBe('var(--grid)')
    expect(TIP_OPTIONS.fontFamily).toContain('system-ui')
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
    // The 22-person cell renders a dot like every other (ADR-0011).
    expect(svg?.querySelectorAll('circle')).toHaveLength(4)
    expect(text).not.toContain('withheld')
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
