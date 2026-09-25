// What Matters (Phase 5): the midyear family from the catalog — the
// ranking set as one countries × items matrix, the rest chartable — the
// split within one country, one view on screen at a time, and no jargon.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { resetNegativePathCache } from '../api/estimates'
import type { ApiHealth, VariableSummary } from '../api/types'
import { SEQUENTIAL_RAMP } from '../charts/theme'
import { tintInk } from '../charts/TransitionTable'
import { createAppRouter } from '../router'
import { happyVariable, sfiVariable, testMeta, testResponse, testRow } from '../test-utils/fixtures'
import { IMPORTANCE_ITEMS, splitMidyear } from '../topics'
import {
  columnRanges,
  defaultSplitCountry,
  itemLabel,
  matrixCountryOrder,
  narrowestWrap,
  orderMatrixRows,
  rankingRows,
  splitGroupOrder,
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

// By gender: the United States has a group with a row but no estimate
// (kept — ADR-0011); Testland has no Female rows at all (omitted), and
// its row with no gender is no group.
const byGender = (outcome: string) =>
  testResponse(
    [
      testRow({ group: { country_code: 22, gender: 1 }, estimate: 7 }),
      testRow({
        group: { country_code: 22, gender: 2 },
        estimate: null,
        ci_lo: null,
        ci_hi: null,
        n: 3,
      }),
      testRow({ group: { country_code: 1, gender: 1 }, estimate: 6 }),
      testRow({ group: { country_code: 1, gender: null }, estimate: null, n: 0 }),
    ],
    { outcome, waves: ['MY'], by: ['country_code', 'gender'] },
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
  '/data/v1/MONEY/MY/mean_by-country_code-gender.json': byGender('MONEY'),
  '/data/v1/GOOD_RELATION/MY/mean_by-country_code-gender.json': byGender('GOOD_RELATION'),
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
        testRow({
          group: { country_code: code },
          stat: 'proportion',
          level,
          estimate: level / 6 + (code === 22 ? 0.05 : 0),
        }),
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

  test('the matrix orders countries A–Z or by one item, nulls last', () => {
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

  test('within a country: its groups in the served order, only those with rows; the US by default', () => {
    const rows = [
      testRow({ group: { outcome: 'MONEY', gender: 2 }, estimate: null }),
      testRow({ group: { outcome: 'MONEY', gender: null }, estimate: null }),
      testRow({ group: { outcome: 'GOOD_RELATION', gender: 2 }, estimate: 7 }),
    ]
    // Female has rows (one with no estimate): a group. No Male rows: no
    // group. A row with no gender is none.
    expect(splitGroupOrder(rows, 'gender', testMeta)).toEqual([2])
    expect(
      splitGroupOrder(
        [...rows, testRow({ group: { outcome: 'MONEY', gender: 1 } })],
        'gender',
        testMeta,
      ),
    ).toEqual([1, 2])
    expect(splitGroupOrder(rows, 'no_such_column', testMeta)).toEqual([])
    // The data table follows the matrix: group, then item; the rest last.
    expect(
      orderMatrixRows(rows, [2], [money, relation], 'gender').map((row) => [
        row.group['gender'],
        row.group['outcome'],
      ]),
    ).toEqual([
      [2, 'MONEY'],
      [2, 'GOOD_RELATION'],
      [null, 'MONEY'],
    ])
    expect(defaultSplitCountry(testMeta)).toBe(22)
    expect(
      defaultSplitCountry({
        countries: [
          { code: 3, name: 'Zedland', iso3: 'ZED' },
          { code: 5, name: 'Alphaland', iso3: 'ALP' },
        ],
      }),
    ).toBe(5)
    expect(defaultSplitCountry({ countries: [] })).toBeUndefined()
  })

  test('each column is tinted on its own range, never narrower than a point', () => {
    const at = (outcome: string, code: number, estimate: number | null) => ({
      ...testRow({ group: { outcome, country_code: code }, estimate }),
    })
    const ranges = columnRanges([
      at('GOOD_RELATION', 1, 6),
      at('GOOD_RELATION', 2, 9),
      at('GOOD_RELATION', 3, null),
      // A near-flat column (US money by age runs 7.46–7.66) widens to one
      // point about its midpoint instead of spanning the whole ramp.
      at('MONEY', 1, 7.46),
      at('MONEY', 2, 7.66),
      at('MEANINGFUL', 1, 5),
      at('REL_LIFE', 1, null),
    ])
    expect(ranges.get('GOOD_RELATION')).toEqual([6, 9])
    const [lo, hi] = ranges.get('MONEY') ?? [0, 0]
    expect(lo).toBeCloseTo(7.06)
    expect(hi).toBeCloseTo(8.06)
    expect(ranges.get('MEANINGFUL')).toEqual([4.5, 5.5])
    // A column with no estimate has no range (its cells are untinted).
    expect(ranges.has('REL_LIFE')).toBe(false)
    // Exactly a point wide is wide enough; a wider minimum can be asked for.
    expect(columnRanges([at('MONEY', 1, 6), at('MONEY', 2, 7)]).get('MONEY')).toEqual([6, 7])
    expect(columnRanges([at('MONEY', 1, 6), at('MONEY', 2, 7)], 2).get('MONEY')).toEqual([5.5, 7.5])
  })

  test('a ramp tint names its ink; the accent tints and "no cell" keep the page ink', () => {
    expect(tintInk('var(--seq-700)')).toBe('var(--seq-700-ink)')
    expect(tintInk('var(--div-n5)')).toBe('var(--div-n5-ink)')
    expect(tintInk('var(--div-0)')).toBe('var(--div-0-ink)')
    expect(tintInk('color-mix(in srgb, var(--accent) 20%, transparent)')).toBeUndefined()
    expect(tintInk('transparent')).toBeUndefined()
  })

  test('a column is labelled by its short label, else its name without "Importance:"', () => {
    expect(itemLabel(money)).toBe('Money')
    expect(itemLabel(relation)).toBe('Good relationships')
    expect(itemLabel(midyear('GOOD_PERSON', 'Importance: being a good person'))).toBe(
      'Being a good person',
    )
    // Only a leading "Importance:" goes; any other name is kept, capitalized.
    expect(itemLabel(midyear('NATURE', 'connected to nature'))).toBe('Connected to nature')
    expect(itemLabel(midyear('X', 'Importance of money'))).toBe('Importance of money')
    // A catalog short label wins when it is set.
    expect(itemLabel({ ...money, short_label: 'Wealth' })).toBe('Wealth')
    expect(itemLabel({ ...money, short_label: ' ' })).toBe('Money')
  })

  test('the narrowest column: every label in at most N lines, never narrower than a word', () => {
    // One unit per character, spaces included.
    const measure = (text: string) => text.length
    expect(narrowestWrap(['aaaa bb cc', 'dddddd'], measure, 3)).toBe(6)
    expect(narrowestWrap(['aaaa bb cc', 'dddddd'], measure, 2)).toBe(6)
    expect(narrowestWrap(['aaaa bb cc', 'dddddd'], measure, 1)).toBe(10)
    // Three lines bind before the longest word does.
    expect(narrowestWrap(['a b c d e f'], measure, 3)).toBe(3)
    expect(narrowestWrap(['Religious or spiritual life', 'Money'], measure, 3)).toBe(12)
    expect(narrowestWrap([], measure, 3)).toBe(0)
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
  test('the ranking by country as one matrix, alone on screen under the view switcher — no jargon', async () => {
    const calls = mockFetch(tier)
    await renderAt('/what-matters')
    const ranking = await screen.findByRole('img', {
      name: /How important people rate 2 items in each of 2 countries, as a matrix: a row per country, a column per item, Midyear/,
    })
    // One matrix: a row per country, a column per item (catalog order),
    // every cell a mean with the interval and n in its tooltip.
    const matrix = within(ranking).getByRole('table')
    expect(
      within(matrix)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Country ↓ · what matters →', 'Money', 'Good relationships'])
    // One width for every column, the labels wrapping over it; the scale
    // is said once, in the subtitle.
    expect(matrix).toHaveAttribute('data-fixed')
    expect(matrix.getAttribute('style')).toContain('--heat-column: 98px')
    expect(
      screen.getByText('How important, 0–10 · Midyear survey, Nov 2023–Dec 2024'),
    ).toBeInTheDocument()
    expect(
      within(matrix)
        .getAllByRole('rowheader')
        .map((th) => th.textContent),
    ).toEqual(['Testland', 'United States'])
    const cells = within(matrix).getAllByRole('cell')
    expect(cells.map((cell) => cell.textContent)).toEqual(['6.00', '7.00', '7.00', '8.00'])
    // The interval rides in a styled tooltip, at once on hover — never a
    // native title; the n lives in the data table (ADR-0016).
    const first = cells[0] as HTMLElement
    expect(first).not.toHaveAttribute('title')
    expect(first).not.toHaveAttribute('tabindex')
    fireEvent.pointerEnter(first)
    const tip = within(ranking).getByRole('tooltip')
    expect(tip.textContent).toMatch(/^6\.00 {2}Testland · Money\n95% CI \[/)
    expect(tip.textContent).not.toContain('n =')
    fireEvent.pointerLeave(first)
    expect(within(ranking).queryByRole('tooltip')).toBeNull()
    // Each column is shaded on its own range: the same 7.00 is the low
    // end of Good relationships (7–8) and the high end of Money (6–7).
    expect(cells[0]?.getAttribute('style')).toContain('var(--seq-100)')
    expect(cells[1]?.getAttribute('style')).toContain('var(--seq-100)')
    expect(cells[2]?.getAttribute('style')).toContain('var(--seq-700)')
    expect(cells[3]?.getAttribute('style')).toContain('var(--seq-700)')
    // The number wears the ink its tint step names (light ink on the
    // deep teal), never the page ink at 1.9:1.
    expect(cells[3]?.getAttribute('style')).toContain('color: var(--seq-700-ink)')
    expect(cells[0]?.getAttribute('style')).toContain('color: var(--seq-100-ink)')
    // A legend replaces the caption: the seven ramp tokens, lower to
    // higher (so it reads true in either theme), and the column rule.
    const legend = within(ranking).getByText(/· each column shaded on its own range/)
    expect(legend.textContent?.replace(/\s+/g, ' ')).toBe(
      'Lower Higher · each column shaded on its own range',
    )
    expect(
      [...legend.querySelectorAll('span[style]')].map((swatch) => swatch.getAttribute('style')),
    ).toEqual(SEQUENTIAL_RAMP.map((token) => `background: ${token};`))
    expect(within(ranking).queryByText(/deeper tint/i)).toBeNull()
    expect(ranking.getAttribute('aria-label')).not.toMatch(/deeper tint|thing/)
    // The sort control, always in view: country name or one of the items.
    const sort = screen.getByLabelText(/^Sort countries by/) as HTMLSelectElement
    expect([...sort.options].map((option) => option.textContent)).toEqual([
      'Country name',
      'Money',
      'Good relationships',
    ])
    expect(screen.queryByText(/Options — sort/)).toBeNull()
    // Sorted by name, no item column is marked.
    expect(within(matrix).queryByText(/[▼▲]/)).toBeNull()
    // One switcher under the lede picks the view; the section headings
    // and the "On this page" anchors are gone.
    const views = screen.getByRole('group', { name: 'View' })
    expect(
      within(views)
        .getAllByRole('radio')
        .map((radio) => radio.closest('label')?.textContent),
    ).toEqual(['By country', 'Within a country', 'Other questions'])
    expect(within(views).getByRole('radio', { name: 'By country' })).toBeChecked()
    expect(screen.queryByRole('navigation', { name: 'On this page' })).toBeNull()
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull()
    // One figure on screen; the other views mount nothing and fetch
    // nothing — static requests only for the midyear cross-sections.
    expect(document.querySelectorAll('figure')).toHaveLength(1)
    expect(calls.filter((url) => url.includes('/MY/mean_by-country_code.json')).length).toBe(2)
    expect(calls.filter((url) => url.includes('age_band') || url.includes('TIME_MEDIA'))).toEqual(
      [],
    )
    // The crossings section is gone.
    expect(screen.queryByText(/Two things that travel together/)).toBeNull()
    expect(visibleText(screen.getByRole('main'))).not.toMatch(JARGON)
  })

  test('Other questions: the first chartable item alone, with its answer levels from the codebook', async () => {
    const calls = mockFetch(tier)
    await renderAt('/what-matters?view=questions')
    expect(
      await screen.findByRole('img', { name: /Daily social media time \(share answering “None”/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Answer level' })).toBeInTheDocument()
    expect(document.querySelectorAll('figure')).toHaveLength(1)
    expect(screen.queryByRole('img', { name: /as a matrix/ })).toBeNull()
    expect(calls.filter((url) => url.includes('MONEY') || url.includes('GOOD_RELATION'))).toEqual(
      [],
    )
    expect(visibleText(screen.getByRole('main'))).not.toMatch(JARGON)
  })

  test('an old anchor link opens its view and drops the hash', async () => {
    mockFetch(tier)
    const router = await renderAt('/what-matters#other-questions')
    expect(await screen.findByRole('img', { name: /Daily social media time/ })).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.hash).toBe(''))
    expect(router.state.location.search).toMatchObject({ view: 'questions' })
    expect(router.state.location.href).toBe('/what-matters?view=questions')
  })

  test('switching views keeps each view’s own settings', async () => {
    mockFetch(tier)
    const router = await renderAt('/what-matters?view=questions&item=TIME_MEDIA&level=3&sort=MONEY')
    await screen.findByRole('img', { name: /share answering “More than an hour”/ })
    fireEvent.click(screen.getByRole('radio', { name: 'By country' }))
    const ranking = await screen.findByRole('img', { name: /as a matrix/ })
    expect(
      within(within(ranking).getByRole('table'))
        .getAllByRole('rowheader')
        .map((th) => th.textContent),
    ).toEqual(['United States', 'Testland'])
    expect(router.state.location.href).toBe('/what-matters?item=TIME_MEDIA&level=3&sort=MONEY')
    fireEvent.click(screen.getByRole('radio', { name: 'Other questions' }))
    expect(
      await screen.findByRole('img', { name: /share answering “More than an hour”/ }),
    ).toBeInTheDocument()
    expect(router.state.location.href).toBe(
      '/what-matters?view=questions&item=TIME_MEDIA&level=3&sort=MONEY',
    )
  })

  test('sorting by an item reorders the rows, high to low, and marks its column', async () => {
    mockFetch(tier)
    await renderAt('/what-matters?sort=MONEY')
    const ranking = await screen.findByRole('img', { name: /as a matrix/ })
    const matrix = within(ranking).getByRole('table')
    expect(
      within(matrix)
        .getAllByRole('rowheader')
        .map((th) => th.textContent),
    ).toEqual(['United States', 'Testland'])
    const [, moneyHeader, relationHeader] = within(matrix).getAllByRole('columnheader')
    expect(moneyHeader?.textContent).toBe('Money\u00a0▼')
    expect(moneyHeader).toHaveAttribute('aria-sort', 'descending')
    expect(relationHeader).not.toHaveAttribute('aria-sort')
    expect(relationHeader?.textContent).toBe('Good relationships')
  })

  test('a tap opens a cell’s tooltip and keeps it; a tap elsewhere closes it', async () => {
    // jsdom has no PointerEvent: a MouseEvent that carries pointerType.
    vi.stubGlobal(
      'PointerEvent',
      class extends MouseEvent {
        readonly pointerType: string
        constructor(type: string, init: PointerEventInit = {}) {
          super(type, init)
          this.pointerType = init.pointerType ?? ''
        }
      },
    )
    mockFetch(tier)
    await renderAt('/what-matters')
    const ranking = await screen.findByRole('img', { name: /as a matrix/ })
    const cells = within(within(ranking).getByRole('table')).getAllByRole('cell')
    const [, second, third] = cells as HTMLElement[]
    const touch = { pointerType: 'touch' }
    fireEvent.pointerUp(second as HTMLElement, touch)
    expect(within(ranking).getByRole('tooltip').textContent).toContain(
      'Testland · Good relationships',
    )
    // The finger lifting off is no reason to close it.
    fireEvent.pointerLeave(second as HTMLElement, touch)
    expect(within(ranking).getByRole('tooltip')).toBeInTheDocument()
    // A tap on another cell moves it; the same cell again closes it.
    fireEvent.pointerUp(third as HTMLElement, touch)
    expect(within(ranking).getByRole('tooltip').textContent).toContain('United States · Money')
    fireEvent.pointerUp(third as HTMLElement, touch)
    expect(within(ranking).queryByRole('tooltip')).toBeNull()
    // A tap anywhere but a cell closes an open one.
    fireEvent.pointerUp(second as HTMLElement, touch)
    fireEvent.pointerDown(document.body, touch)
    expect(within(ranking).queryByRole('tooltip')).toBeNull()
  })

  test('low to high flips the marker', async () => {
    mockFetch(tier)
    await renderAt('/what-matters?sort=MONEY&dir=asc')
    const ranking = await screen.findByRole('img', { name: /as a matrix/ })
    const matrix = within(ranking).getByRole('table')
    expect(
      within(matrix)
        .getAllByRole('rowheader')
        .map((th) => th.textContent),
    ).toEqual(['Testland', 'United States'])
    const money = within(matrix).getByRole('columnheader', { name: /Money/ })
    expect(money.textContent).toBe('Money\u00a0▲')
    expect(money).toHaveAttribute('aria-sort', 'ascending')
  })

  test('the other questions sort on their own: the matrix order never reaches them', async () => {
    mockFetch(tier)
    const order = async (path: string) => {
      await renderAt(path)
      const chart = await screen.findByRole('img', { name: /Daily social media time/ })
      const rows = chart.closest('figure')?.querySelectorAll('details tbody tr') ?? []
      const countries = [...rows].map((row) => row.querySelector('td')?.textContent)
      cleanup()
      return countries
    }
    // By value, high first (Atlas's default) — whatever the matrix's sort.
    expect(await order('/what-matters?view=questions&sort=name&dir=desc')).toEqual([
      'United States',
      'Testland',
    ])
    expect(await order('/what-matters?view=questions&sort=MONEY&dir=asc')).toEqual([
      'United States',
      'Testland',
    ])
    expect(await order('/what-matters?view=questions&qdir=asc')).toEqual([
      'Testland',
      'United States',
    ])
    expect(await order('/what-matters?view=questions&qsort=name')).toEqual([
      'Testland',
      'United States',
    ])
  })

  test('the other questions’ Sort and Order controls write qsort and qdir', async () => {
    mockFetch(tier)
    const router = await renderAt('/what-matters?view=questions&sort=MONEY')
    await screen.findByRole('img', { name: /Daily social media time/ })
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Sort' })).getByRole('radio', { name: 'A–Z' }),
    )
    await waitFor(() =>
      expect(router.state.location.href).toBe('/what-matters?view=questions&sort=MONEY&qsort=name'),
    )
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Order' })).getByRole('radio', { name: 'Z to A' }),
    )
    await waitFor(() =>
      expect(router.state.location.href).toBe(
        '/what-matters?view=questions&sort=MONEY&qsort=name&qdir=desc',
      ),
    )
  })

  test('Within a country: the United States by default, its age bands as the matrix’s rows', async () => {
    mockFetch(tier)
    const router = await renderAt('/what-matters?view=within')
    const split = await screen.findByRole('img', {
      name: /United States: how important people rate 2 items, as a matrix: a row per age band, a column per item/,
    })
    expect(screen.getByText('United States by age band')).toBeInTheDocument()
    const matrix = within(split).getByRole('table')
    expect(
      within(matrix)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Age band ↓ · what matters →', 'Money', 'Good relationships'])
    expect(
      within(matrix)
        .getAllByRole('rowheader')
        .map((th) => th.textContent),
    ).toEqual(['18–24', '25–29'])
    const cells = within(matrix).getAllByRole('cell')
    expect(cells.map((cell) => cell.textContent)).toEqual(['5.22', '5.22', '6.22', '6.22'])
    // Shaded per column across the groups.
    expect(cells[0]?.getAttribute('style')).toContain('var(--seq-100)')
    expect(cells[2]?.getAttribute('style')).toContain('var(--seq-700)')
    within(split).getByText(/each column shaded on its own range/)
    // The country select starts on the United States: no "Choose a
    // country…" option, no hint; one figure on screen.
    const country = screen.getByLabelText(/^Country/) as HTMLSelectElement
    expect(country.value).toBe('22')
    expect([...country.options].map((option) => option.textContent)).toEqual([
      'Testland',
      'United States',
    ])
    expect(screen.queryByText(/Choose a country/)).toBeNull()
    expect(document.querySelectorAll('figure')).toHaveLength(1)
    // Another country joins the URL; the default leaves it.
    fireEvent.change(country, { target: { value: '1' } })
    await waitFor(() =>
      expect(router.state.location.href).toBe('/what-matters?view=within&country=1'),
    )
    expect(await screen.findByText('Testland by age band')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/^Country/), { target: { value: '22' } })
    await waitFor(() => expect(router.state.location.href).toBe('/what-matters?view=within'))
  })

  test('Within a country: a group with no rows is omitted; one with no estimate stays', async () => {
    mockFetch(tier)
    await renderAt('/what-matters?view=within&by=gender')
    const us = await screen.findByRole('img', { name: /United States: .* a row per gender/ })
    expect(
      within(us)
        .getAllByRole('rowheader')
        .map((th) => th.textContent),
    ).toEqual(['Male', 'Female'])
    expect(
      within(us)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['7.00', '7.00', '—', '—'])
    cleanup()
    await renderAt('/what-matters?view=within&by=gender&country=1')
    const testland = await screen.findByRole('img', { name: /Testland: .* a row per gender/ })
    expect(
      within(testland)
        .getAllByRole('rowheader')
        .map((th) => th.textContent),
    ).toEqual(['Male'])
  })

  test('the level control re-renders the item', async () => {
    mockFetch(tier)
    await renderAt('/what-matters?view=questions&level=3')
    expect(
      await screen.findByRole('img', { name: /share answering “More than an hour”/ }),
    ).toBeInTheDocument()
  })
})
