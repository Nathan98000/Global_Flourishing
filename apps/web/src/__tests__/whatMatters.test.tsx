// What Matters (Phase 5): the midyear family from the catalog — the
// ranking set in the brief's order, the rest chartable — the split
// within one country, the crossings made only when both sides share a
// wave (and explained in plain words when they do not), and no jargon.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { resetNegativePathCache } from '../api/estimates'
import type { ApiHealth, VariableSummary } from '../api/types'
import { createAppRouter } from '../router'
import { happyVariable, sfiVariable, testMeta, testResponse, testRow } from '../test-utils/fixtures'
import { IMPORTANCE_ITEMS, WHAT_MATTERS_CROSSINGS, crossingWave, splitMidyear } from '../topics'
import { crossingUnavailableCopy, rankingRows } from '../views/whatMattersRows'

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
  test('splits into the ranking set (brief order) and the chartable rest (A–Z)', () => {
    const { ranking, chartable } = splitMidyear([
      relation,
      timeMedia,
      money,
      foodInsecure,
      happyVariable,
    ])
    expect(ranking.map((item) => item.name)).toEqual(['MONEY', 'GOOD_RELATION'])
    expect(chartable.map((item) => item.name)).toEqual(['TIME_MEDIA', 'FOOD_INSECURE'])
    expect(IMPORTANCE_ITEMS).toHaveLength(7)
    expect(splitMidyear([]).ranking).toEqual([])
  })

  test('a crossing is made only when both sides share a wave, and explains itself otherwise', () => {
    const byName = {
      MENTAL_HEALTH: mentalHealth,
      TIME_MEDIA: timeMedia,
      FOOD_INSECURE: foodInsecure,
      sfi_financial: financial,
    }
    for (const crossing of WHAT_MATTERS_CROSSINGS)
      expect(crossingWave(crossing, byName)).toBeUndefined()
    const shared = { ...byName, MENTAL_HEALTH: { ...mentalHealth, waves_available: ['Y1', 'MY'] } }
    expect(
      crossingWave(WHAT_MATTERS_CROSSINGS[0] as (typeof WHAT_MATTERS_CROSSINGS)[number], shared),
    ).toBe('MY')
    const copy = crossingUnavailableCopy(
      WHAT_MATTERS_CROSSINGS[0] as (typeof WHAT_MATTERS_CROSSINGS)[number],
      byName,
    )
    expect(copy).toContain('Daily social media time was asked in the Midyear survey')
    expect(copy).toContain('Mental health was asked in the Wave 1, 2023 and the Wave 2, 2024')
    expect(copy).toContain('never in the same interview')
    expect(copy).not.toMatch(JARGON)
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
  test('the ranking by country, the crossings explained, the first chartable item — no jargon', async () => {
    const calls = mockFetch(tier)
    await renderAt('/what-matters')
    const ranking = await screen.findByRole('img', {
      name: /How important people rate 2 things, one panel per country/,
    })
    const text = ranking.querySelector('svg')?.textContent ?? ''
    expect(text).toContain('Importance: money')
    expect(text).toContain('Importance: good relationships')
    expect(text).toContain('Testland')
    // Static requests only for the midyear cross-sections.
    expect(calls.filter((url) => url.includes('/MY/mean_by-country_code.json')).length).toBe(2)
    // Both crossings say why they cannot be made from this release.
    expect(
      screen.getByText(/Time on social media and mental health: not possible/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Running out of food and financial stability: not possible/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Associated with, not caused by/)).toBeInTheDocument()
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

  test('a crossing the catalog allows is charted through the API with the split variable’s labels', async () => {
    const calls = mockFetch({
      ...tier,
      '/data/variables.json': {
        variables: [
          sfiVariable,
          happyVariable,
          money,
          relation,
          timeMedia,
          foodInsecure,
          { ...mentalHealth, waves_available: ['Y1', 'MY'] },
          financial,
        ],
      },
      '/v1/aggregate?outcome=MENTAL_HEALTH': testResponse(
        [1, 22].flatMap((code) =>
          [1, 2, 3].map((level) =>
            testRow({ group: { country_code: code, TIME_MEDIA: level }, estimate: 8 - level }),
          ),
        ),
        { outcome: 'MENTAL_HEALTH', waves: ['MY'], by: ['country_code', 'TIME_MEDIA'] },
      ),
    })
    await renderAt('/what-matters')
    const figure = await screen.findByRole('img', {
      name: /Time on social media and mental health: Mental health for each answer/,
    })
    const text = figure.querySelector('svg')?.textContent ?? ''
    expect(text).toContain('Up to an hour')
    expect(text).toContain('More than an hour')
    expect(
      calls.some(
        (url) =>
          url.includes('/v1/aggregate?outcome=MENTAL_HEALTH&wave=MY') &&
          url.includes('by=TIME_MEDIA'),
      ),
    ).toBe(true)
    fireEvent.click(within(figure.closest('figure') as HTMLElement).getByText('Data table'))
    expect(
      within(figure.closest('figure') as HTMLElement).getAllByText('Up to an hour').length,
    ).toBeGreaterThan(0)
  })
})
