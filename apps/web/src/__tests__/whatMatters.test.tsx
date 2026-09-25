// What Matters (Phase 5): the midyear family from the catalog — the
// ranking set as one countries × items matrix, the rest chartable — the
// split within one country, the anchor links, and no jargon.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { resetNegativePathCache } from '../api/estimates'
import type { ApiHealth, VariableSummary } from '../api/types'
import { tintInk } from '../charts/TransitionTable'
import { createAppRouter } from '../router'
import { happyVariable, sfiVariable, testMeta, testResponse, testRow } from '../test-utils/fixtures'
import { IMPORTANCE_ITEMS, splitMidyear } from '../topics'
import {
  matrixCountryOrder,
  matrixRange,
  orderMatrixRows,
  rankingRows,
} from '../views/whatMattersRows'

const okHealth: ApiHealth = {
  status: 'ok',
  service: 'flourish-atlas-api',
  version: '0.2.0',
  git_sha: 'abc1234def',
  data: 'ok',
  data_version: 'test.1.0.0',
}

const JARGON = /retention|attrition|longitudinal|cohort|wave pair|coverage/i

const midyear = (
  name: string,
  display: string,
  extra: Partial<VariableSummary> = {},
): VariableSummary => ({
  ...happyVariable,
  name,
  display_name: display,
  wording: `How important is ${display.toLowerCase()}?`,
  family: 'midyear',
  waves_available: ['MY'],
  ...extra,
})

const money = midyear('MONEY', 'Importance: money')
const relation = midyear('GOOD_RELATION', 'Importance: good relationships')
const timeMedia = midyear('TIME_MEDIA', 'Daily social media time', {
  scale_type: 'ordinal',
  direction: 'none',
  polarity: 'ascending',
  min: 1,
  max: 3,
  default_stat: 'proportion',
})
const foodInsecure = midyear('FOOD_INSECURE', 'Household ran out of food', {
  scale_type: 'ordinal',
  min: 1,
  max: 3,
  default_stat: 'proportion',
})
const mentalHealth: VariableSummary = {
  ...happyVariable,
  name: 'MENTAL_HEALTH',
  display_name: 'Mental health',
}
const financial: VariableSummary = {
  ...sfiVariable,
  name: 'sfi_financial',
  display_name: 'SFI: financial & material stability',
}

const byCountry = (outcome: string, offset: number) =>
  testResponse(
    [
      testRow({ group: { country_code: 1 }, estimate: 6 + offset, weight: 'w_l1m' }),
      testRow({ group: { country_code: 22 }, estimate: 7 + offset, weight: 'w_l1m' }),
    ],
    { outcome, waves: ['MY'], weight_key: 'my', weight: 'w_l1m' },
  )

const byAge = (outcome: string) =>
  testResponse(
    [1, 22].flatMap((code) =>
      ['18-24', '25-29'].map((band, index) =>
        testRow({
          group: { country_code: code, age_band: band },
          estimate: 5 + index + code / 100,
        }),
      ),
    ),
    { outcome, waves: ['MY'], by: ['country_code', 'age_band'] },
  )

type Routes = Record<string, unknown | Response>

function mockFetch(routes: Routes) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      for (const [needle, value] of Object.entries(routes)) {
        if (!url.includes(needle)) continue
        if (value instanceof Response) return value.clone()
        return new Response(JSON.stringify(value), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('not found', { status: 404 })
    }),
  )
  return calls
}

const tier: Routes = {
  '/data/meta.json': testMeta,
  '/data/variables.json': {
    variables: [
      sfiVariable,
      happyVariable,
      money,
      relation,
      timeMedia,
      foodInsecure,
      mentalHealth,
      financial,
    ],
  },
  '/data/v1/MONEY/MY/mean_by-country_code.json': byCountry('MONEY', 0),
  '/data/v1/GOOD_RELATION/MY/mean_by-country_code.json': byCountry('GOOD_RELATION', 1),
  '/data/v1/MONEY/MY/mean_by-country_code-age_band.json': byAge('MONEY'),
  '/data/v1/GOOD_RELATION/MY/mean_by-country_code-age_band.json': byAge('GOOD_RELATION'),
  '/data/v1/TIME_MEDIA/variable.json': {
    ...timeMedia,
    value_labels: [
      { code: 1, label: 'None', wave: null, country_code: null, is_nonresponse: false },
      { code: 2, label: 'Up to an hour', wave: null, country_code: null, is_nonresponse: false },
      {
        code: 3,
        label: 'More than an hour',
        wave: null,
        country_code: null,
        is_nonresponse: false,
      },
    ],
    missingness: [],
    scoring: null,
    components: [],
  },
  '/data/v1/TIME_MEDIA/MY/proportion_by-country_code.json': testResponse(
    [1, 22].flatMap((code) =>
      [1, 2, 3].map((level) =>
        testRow({ group: { country_code: code }, stat: 'proportion', level, estimate: level / 6 }),
      ),
    ),
    { outcome: 'TIME_MEDIA', stat: 'proportion', waves: ['MY'] },
  ),
  '/health': okHealth,
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetNegativePathCache()
})

async function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }))
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  await router.load()
  return router
}

function visibleText(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement
  for (const node of clone.querySelectorAll('style, script')) node.remove()
  return clone.textContent ?? ''
}

describe('the midyear family from the catalog', () => {
  test('splits into the ranking set (catalog order) and the chartable rest (A–Z)', () => {
    const { ranking, chartable } = splitMidyear([
      relation,
      timeMedia,
      money,
      foodInsecure,
      happyVariable,
    ])
    expect(ranking.map((item) => item.name)).toEqual(['GOOD_RELATION', 'MONEY'])
    expect(chartable.map((item) => item.name)).toEqual(['TIME_MEDIA', 'FOOD_INSECURE'])
    expect(IMPORTANCE_ITEMS).toHaveLength(7)
    expect(splitMidyear([]).ranking).toEqual([])
  })

  test('the matrix orders countries A–Z or by one item, nulls last; its tints span the range', () => {
    const rows = rankingRows(
      [byCountry('MONEY', 0), byCountry('GOOD_RELATION', 1)],
      [money, relation],
    )
    expect(matrixCountryOrder(rows, testMeta, 'name', 'asc')).toEqual([1, 22])
    expect(matrixCountryOrder(rows, testMeta, 'name', 'desc')).toEqual([22, 1])
    expect(matrixCountryOrder(rows, testMeta, 'MONEY', 'desc')).toEqual([22, 1])
    expect(matrixCountryOrder(rows, testMeta, 'MONEY', 'asc')).toEqual([1, 22])
    const withNull = rows.map((row) =>
      row.group['country_code'] === 22 && row.group['outcome'] === 'MONEY'
        ? { ...row, estimate: null }
        : row,
    )
    expect(matrixCountryOrder(withNull, testMeta, 'MONEY', 'desc')).toEqual([1, 22])
    expect(matrixRange(rows)).toEqual([6, 8])
    expect(matrixRange([])).toEqual([0, 1])
    expect(
      orderMatrixRows(rows, [22, 1], [money, relation]).map((row) => [
        row.group['country_code'],
        row.group['outcome'],
      ]),
    ).toEqual([
      [22, 'MONEY'],
      [22, 'GOOD_RELATION'],
      [1, 'MONEY'],
      [1, 'GOOD_RELATION'],
    ])
  })

  test('a ramp tint names its ink; the accent tints and "no cell" keep the page ink', () => {
    expect(tintInk('var(--seq-700)')).toBe('var(--seq-700-ink)')
    expect(tintInk('var(--div-n5)')).toBe('var(--div-n5-ink)')
    expect(tintInk('var(--div-0)')).toBe('var(--div-0-ink)')
    expect(tintInk('color-mix(in srgb, var(--accent) 20%, transparent)')).toBeUndefined()
    expect(tintInk('transparent')).toBeUndefined()
  })

  test('rankingRows stamps each item and can keep one country', () => {
    const rows = rankingRows(
      [byCountry('MONEY', 0), byCountry('GOOD_RELATION', 1)],
      [money, relation],
      [22],
    )
    expect(rows.map((row) => [row.group['outcome'], row.group['country_code']])).toEqual([
      ['MONEY', 22],
      ['GOOD_RELATION', 22],
    ])
  })
})

describe('What Matters view', () => {
  test('the ranking by country as one matrix, the anchors, the first chartable item — no jargon', async () => {
    const calls = mockFetch(tier)
    await renderAt('/what-matters')
    const ranking = await screen.findByRole('img', {
      name: /How important people rate 2 things in each of 2 countries, as a matrix/,
    })
    // One matrix: a row per country, a column per item (catalog order),
    // every cell a mean with the interval and n in its tooltip.
    const matrix = within(ranking).getByRole('table')
    expect(
      within(matrix)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Country ↓ · what matters →', 'Importance: money', 'Importance: good relationships'])
    expect(
      within(matrix)
        .getAllByRole('rowheader')
        .map((th) => th.textContent),
    ).toEqual(['Testland', 'United States'])
    const cells = within(matrix).getAllByRole('cell')
    expect(cells.map((cell) => cell.textContent)).toEqual(['6.00', '7.00', '7.00', '8.00'])
    // The interval in brackets; the n lives in the data table (ADR-0016).
    expect(cells[0]?.getAttribute('title')).toContain('95% CI [')
    expect(cells[0]?.getAttribute('title')).not.toContain('n =')
    expect(cells[0]?.getAttribute('style')).toContain('var(--seq-')
    expect(cells[3]?.getAttribute('style')).toContain('var(--seq-700)')
    // The number wears the ink its tint step names (light ink on the
    // deep teal), never the page ink at 1.9:1.
    expect(cells[3]?.getAttribute('style')).toContain('color: var(--seq-700-ink)')
    expect(cells[0]?.getAttribute('style')).toContain('color: var(--seq-100-ink)')
    // The caption names the tint rule and the range, not the subtitle again.
    expect(
      within(ranking).getByText('Deeper tint, higher importance (6.00–8.00)'),
    ).toBeInTheDocument()
    expect(within(ranking).queryByText(/— deeper tint/)).toBeNull()
    // The sort control: A–Z or by one of the items.
    const sort = screen.getByLabelText(/^Sort countries/) as HTMLSelectElement
    expect([...sort.options].map((option) => option.textContent)).toEqual([
      'A–Z',
      'By Importance: money',
      'By Importance: good relationships',
    ])
    // Three anchors under the lede, one per section.
    const anchors = screen.getByRole('navigation', { name: 'On this page' })
    expect(
      within(anchors)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['#by-country', '#within-country', '#other-questions'])
    expect(document.getElementById('within-country')).not.toBeNull()
    // Static requests only for the midyear cross-sections.
    expect(calls.filter((url) => url.includes('/MY/mean_by-country_code.json')).length).toBe(2)
    // The crossings section is gone.
    expect(screen.queryByText(/Two things that travel together/)).toBeNull()
    // The first chartable item, with its answer levels from the codebook.
    expect(
      await screen.findByRole('img', { name: /Daily social media time \(share answering “None”/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Answer level' })).toBeInTheDocument()
    expect(
      screen.getByText(/Choose a country to see how the ranking shifts by age band/),
    ).toBeInTheDocument()
    expect(visibleText(screen.getByRole('main'))).not.toMatch(JARGON)
  })

  test('sorting by an item reorders the rows, high to low', async () => {
    mockFetch(tier)
    await renderAt('/what-matters?sort=MONEY')
    const ranking = await screen.findByRole('img', { name: /as a matrix/ })
    expect(
      within(within(ranking).getByRole('table'))
        .getAllByRole('rowheader')
        .map((th) => th.textContent),
    ).toEqual(['United States', 'Testland'])
  })

  test('a chosen country adds the split by age band; the level control re-renders the item', async () => {
    mockFetch(tier)
    await renderAt('/what-matters?country=22&level=3')
    const split = await screen.findByRole('img', {
      name: /United States: how important people rate 2 things, one panel per age band/,
    })
    const text = split.querySelector('svg')?.textContent ?? ''
    expect(text).toContain('18–24')
    expect(text).toContain('25–29')
    expect(text).toContain('Importance: money')
    expect(
      await screen.findByRole('img', { name: /share answering “More than an hour”/ }),
    ).toBeInTheDocument()
    const country = screen.getByLabelText(/^Country/) as HTMLSelectElement
    expect(country.value).toBe('22')
  })
})
