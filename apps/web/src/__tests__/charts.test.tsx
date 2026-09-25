// One render test per chart against synthetic fixtures: the marks exist,
// labels come from meta, suppression renders in place, colors are token
// vars (never hex) so both themes recolor the same SVG.

import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { capitalize } from '../charts/ChartFigure'
import { CompareDomains } from '../charts/CompareDomains'
import { Histogram, thinnedTicks } from '../charts/Histogram'
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

/** A text's y in the SVG: the translate() of it and of its ancestors —
 * Plot positions axis labels through nested transforms. */
function absoluteY(node: Element): number {
  let y = 0
  for (let el: Element | null = node; el && el.tagName !== 'svg'; el = el.parentElement) {
    const match = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(el.getAttribute('transform') ?? '')
    if (match) y += Number(match[2])
  }
  return y
}

/** Every column (fx) label sits at least one text line above the
 * highest top-axis tick label — the two shared a baseline before. */
function expectColumnLabelsAboveTicks(svg: SVGSVGElement | null) {
  const columnLabels = [...(svg?.querySelectorAll('[aria-label="fx-axis tick label"] text') ?? [])]
  const tickLabels = [...(svg?.querySelectorAll('[aria-label="x-axis tick label"] text') ?? [])]
  expect(columnLabels.length).toBeGreaterThan(0)
  expect(tickLabels.length).toBeGreaterThan(0)
  const highestTick = Math.min(...tickLabels.map(absoluteY))
  for (const label of columnLabels) {
    expect(absoluteY(label), `${label.textContent} above the ticks`).toBeLessThanOrEqual(
      highestTick - 12,
    )
  }
}

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
    // Each interval: one ink rule at 1.25px with 6px end caps — no
    // surface halo under it (it read as a scratch through the bar).
    // (Clipped marks nest their styled group inside the clip group.)
    const styled = (label: string) =>
      [...(svg?.querySelectorAll(`[aria-label="${label}"] g[stroke]`) ?? [])].map((group) => [
        group.getAttribute('stroke'),
        group.getAttribute('stroke-width'),
        group.getAttribute('fill'),
        group.children.length,
      ])
    expect(styled('rule')).toEqual([['var(--ink)', '1.25', null, 2]])
    expect(styled('dot')).toEqual([
      ['var(--ink)', '1.25', 'none', 2],
      ['var(--ink)', '1.25', 'none', 2],
    ])
    expect(svg?.querySelector('[aria-label="dot"] path')?.getAttribute('d')).toBe('M0,-3L0,3')
    expect(svg?.innerHTML).not.toContain('var(--surface)')
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

  test('bin labels thin out when a facet is too narrow for all of them, so none touch', () => {
    // Three countries at the design width leave ~200 px per facet for
    // ten bins: "8–9" and "9–10" ran together. Every bar stays.
    const bins = [7, 22, 9].flatMap((code) =>
      Array.from({ length: 10 }, (_, level) =>
        testRow({
          group: { country_code: code },
          stat: 'distribution',
          level,
          estimate: 0.1,
          ci_lo: 0.08,
          ci_hi: 0.12,
          n: 100,
        }),
      ),
    )
    const meta = {
      ...testMeta,
      countries: [
        ...testMeta.countries,
        { code: 7, name: 'Indonesia', iso3: 'IDN' },
        { code: 9, name: 'Japan', iso3: 'JPN' },
      ],
    }
    const label = (level: number) => `${level}–${level + 1}`
    const { container } = render(
      <Histogram
        rows={bins}
        meta={meta}
        responseMeta={testResponseMeta({ stat: 'distribution', outcome: 'sfi' })}
        variable={sfiVariable}
        color="var(--series-1)"
        levels={Array.from({ length: 10 }, (_, level) => level)}
        levelLabel={label}
      />,
    )
    const svg = container.querySelector('svg')
    expect(svg?.querySelectorAll('[aria-label="bar"] :is(rect, path)').length).toBe(30)
    const ticks = [...(svg?.querySelectorAll('[aria-label="x-axis tick label"] text') ?? [])].map(
      (node) => node.textContent,
    )
    // Every other bin is labelled, in each of the three facets.
    expect(ticks).toEqual([...Array(3)].flatMap(() => ['0–1', '2–3', '4–5', '6–7', '8–9']))
    // The rule itself: every bin when the widest label fits its bin; the
    // signed change buckets keep zero labelled whatever the stride.
    const levels = Array.from({ length: 10 }, (_, level) => level)
    expect(thinnedTicks(levels, label, 360)).toEqual(levels)
    expect(thinnedTicks(levels, label, 200)).toEqual([0, 2, 4, 6, 8])
    expect(thinnedTicks(levels, label, 100)).toEqual([0, 4, 8])
    const signed = Array.from({ length: 21 }, (_, index) => index - 10)
    const thinned = thinnedTicks(signed, (level) => (level > 0 ? `+${level}` : String(level)), 360)
    expect(thinned).toContain(0)
    expect(thinned).toEqual(signed.filter((level) => level % 2 === 0))
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

describe('column labels and the top axis', () => {
  const ageBands = testMeta.breakdown_labels['age_band']?.levels ?? []
  const gridRows = [1, 22].flatMap((code) =>
    ageBands.flatMap((band) =>
      [1, 2].map((gender) =>
        testRow({
          group: { country_code: code, age_band: band.value, gender },
          estimate: 6 + gender * 0.2 + Number(band.value) * 0.1,
          ci_lo: 5.9,
          ci_hi: 7.5,
        }),
      ),
    ),
  )

  test('a second breakdown puts its column labels a line above the top ticks', () => {
    const { container } = render(
      <SmallMultiples
        rows={gridRows}
        meta={testMeta}
        responseMeta={testResponseMeta({ by: ['country_code', 'age_band', 'gender'] })}
        variable={happyVariable}
        color="var(--series-1)"
        levelColumn="age_band"
        levelDomain={ageBands.map((band) => band.label)}
        seriesColumn="gender"
        seriesDomain={['Male', 'Female']}
        sort="estimate"
      />,
    )
    const svg = container.querySelector('svg')
    expect(svg?.textContent).toContain('Female')
    expectColumnLabelsAboveTicks(svg)
  })

  test('a Compare split puts its country labels a line above the top ticks; the row header is haloed', () => {
    const rows = [1, 22].flatMap((code) =>
      [1, 2].map((gender) =>
        testRow({
          group: { country_code: code, gender, outcome: 'sfi_happiness' },
          estimate: 6 + gender * 0.2,
          ci_lo: 5.9,
          ci_hi: 7.5,
        }),
      ),
    )
    const { container } = render(
      <CompareDomains
        rows={rows}
        meta={testMeta}
        outcomes={['sfi_happiness']}
        outcomeLabel={() => 'SFI: happiness & life satisfaction'}
        units={['Testland', 'United States']}
        split="gender"
        splitDomain={['Male', 'Female']}
      />,
    )
    const svg = container.querySelector('svg')
    expectColumnLabelsAboveTicks(svg)
    // The row header reads across the row, with a surface halo so the
    // next column's frame line never cuts through it.
    const header = [...(svg?.querySelectorAll('text') ?? [])].find((node) =>
      node.textContent?.startsWith('SFI: happiness'),
    )
    expect(header).toBeDefined()
    // Plot puts a mark's styles on its per-facet group.
    const group = header?.parentElement
    expect(group?.getAttribute('stroke')).toBe('var(--surface)')
    expect(group?.getAttribute('paint-order')).toBe('stroke')
  })
})

test('screen has no leaked chart between tests', () => {
  expect(screen.queryByText('United States')).toBeNull()
})
