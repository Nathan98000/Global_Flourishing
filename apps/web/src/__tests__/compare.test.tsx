// The Compare view (Phase 5): two to five countries across the six SFI
// domains through the static-first estimates path — one panel per
// domain, no radar — the cap in plain words, a split by demographic,
// and an added measure as a second figure.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { resetNegativePathCache } from '../api/estimates'
import type { ApiHealth, VariableDetail, VariableSummary } from '../api/types'
import { SFI_DOMAINS } from '../charts/theme'
import { CountryFilter } from '../components/controls/CountryFilter'
import { createAppRouter } from '../router'
import {
  attendVariable,
  happyVariable,
  sfiVariable,
  testMeta,
  testResponse,
  testRow,
} from '../test-utils/fixtures'
import { combineRows, compareUnits, defaultCompareCountries } from '../views/compareRows'

const okHealth: ApiHealth = {
  status: 'ok',
  service: 'flourish-atlas-api',
  version: '0.2.0',
  git_sha: 'abc1234def',
  data: 'ok',
  data_version: 'test.1.0.0',
}

const DOMAIN_NAMES: Record<string, string> = {
  sfi_happiness: 'SFI: happiness & life satisfaction',
  sfi_health: 'SFI: mental & physical health',
  sfi_meaning: 'SFI: meaning & purpose',
  sfi_character: 'SFI: character & virtue',
  sfi_relationships: 'SFI: close social relationships',
  sfi_financial: 'SFI: financial & material stability',
}

const domainVariables: VariableSummary[] = SFI_DOMAINS.map((domain) => ({
  ...sfiVariable,
  name: domain,
  display_name: DOMAIN_NAMES[domain] ?? domain,
}))

const attendDetail: VariableDetail = {
  ...attendVariable,
  value_labels: [
    { code: 1, label: 'Weekly', wave: null, country_code: null, is_nonresponse: false },
    { code: 2, label: 'Sometimes', wave: null, country_code: null, is_nonresponse: false },
    { code: 3, label: 'Never', wave: null, country_code: null, is_nonresponse: false },
  ],
  missingness: [],
  scoring: null,
  components: [],
}

/** A categorical item's shares by country: one row per answer level. */
const attendByCountry = testResponse(
  [1, 22].flatMap((code) =>
    [1, 2, 3].map((level) =>
      testRow({
        group: { country_code: code },
        stat: 'proportion',
        level,
        estimate: 0.2 + level * 0.1,
        ci_lo: 0.15 + level * 0.1,
        ci_hi: 0.25 + level * 0.1,
      }),
    ),
  ),
  { outcome: 'ATTEND_SVCS', stat: 'proportion' },
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

const byCountry = (outcome: string, offset: number) =>
  testResponse(
    [
      testRow({
        group: { country_code: 1 },
        estimate: 6 + offset,
        ci_lo: 5.9 + offset,
        ci_hi: 6.1 + offset,
      }),
      testRow({
        group: { country_code: 22 },
        estimate: 7 + offset,
        ci_lo: 6.9 + offset,
        ci_hi: 7.1 + offset,
      }),
    ],
    { outcome },
  )

const byGender = (outcome: string) =>
  testResponse(
    [1, 22].flatMap((code) =>
      [1, 2].map((gender) =>
        testRow({ group: { country_code: code, gender }, estimate: 5 + gender + code / 100 }),
      ),
    ),
    { outcome, by: ['country_code', 'gender'] },
  )

const tier: Routes = {
  '/data/meta.json': testMeta,
  '/data/variables.json': {
    variables: [sfiVariable, happyVariable, attendVariable, ...domainVariables],
  },
  '/data/v1/HAPPY/variable.json': {
    ...happyVariable,
    value_labels: [],
    missingness: [],
    scoring: null,
    components: [],
  },
  '/data/v1/HAPPY/Y1/mean_by-country_code.json': byCountry('HAPPY', 1),
  '/data/v1/ATTEND_SVCS/variable.json': attendDetail,
  '/data/v1/ATTEND_SVCS/Y1/proportion_by-country_code.json': attendByCountry,
  '/health': okHealth,
  ...Object.fromEntries(
    SFI_DOMAINS.flatMap((domain, index) => [
      [`/data/v1/${domain}/Y1/mean_by-country_code.json`, byCountry(domain, index / 10)],
      [`/data/v1/${domain}/Y1/mean_by-country_code-gender.json`, byGender(domain)],
    ]),
  ),
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

describe('compare helpers', () => {
  test('units read A–Z; rows are stamped with their outcome; a proportion keeps the default level', () => {
    // With the item's labelled answers: the first one, Atlas's default.
    const labelled = combineRows([attendByCountry], ['ATTEND_SVCS'], [1], {
      ATTEND_SVCS: attendDetail,
    })
    expect(labelled.map((row) => row.level)).toEqual([1])
    // Without any (a derived binary): the highest level, its positive share.
    expect(compareUnits([22, 1], testMeta)).toEqual(['Testland', 'United States'])
    const rows = combineRows(
      [
        byCountry('sfi_happiness', 0),
        testResponse(
          [
            testRow({ group: { country_code: 1 }, stat: 'proportion', level: 0, estimate: 0.7 }),
            testRow({ group: { country_code: 1 }, stat: 'proportion', level: 1, estimate: 0.3 }),
          ],
          { outcome: 'phq2_positive', stat: 'proportion' },
        ),
      ],
      ['sfi_happiness', 'phq2_positive'],
      [1],
    )
    expect(
      rows.map((row) => [row.group['outcome'], row.group['country_code'], row.level ?? null]),
    ).toEqual([
      ['sfi_happiness', 1, null],
      ['phq2_positive', 1, 1],
    ])
  })
})

describe('Compare view', () => {
  test('asks for two to five countries before fetching anything', async () => {
    const calls = mockFetch(tier)
    await renderAt('/compare')
    expect(await screen.findByText('Choose two to five countries')).toBeInTheDocument()
    expect(screen.getByText('Choose up to 5')).toBeInTheDocument()
    expect(calls.some((url) => url.includes('/data/v1/sfi_'))).toBe(false)
  })

  test('with no countries in the URL and the three defaults in the release, it starts on them', async () => {
    const calls = mockFetch({
      ...tier,
      '/data/meta.json': {
        ...testMeta,
        countries: [
          { code: 7, name: 'Indonesia', iso3: 'IDN' },
          { code: 9, name: 'Japan', iso3: 'JPN' },
          { code: 22, name: 'United States', iso3: 'USA' },
        ],
      },
    })
    const router = await renderAt('/compare')
    expect(
      await screen.findByRole('img', {
        name: /Six domains of flourishing for Indonesia, Japan, United States/,
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('3 of 5 selected')).toBeInTheDocument()
    expect(calls.filter((url) => url.includes('/data/v1/sfi_')).length).toBe(6)
    // The defaults never reach the URL.
    expect(router.state.location.searchStr).toBe('')
    expect(defaultCompareCountries(testMeta.countries)).toEqual([])
  })

  test('two countries: six panels named by the catalog, one table with a Measure column', async () => {
    const calls = mockFetch(tier)
    await renderAt('/compare?countries=1,22')
    const figure = await screen.findByRole('img', {
      name: /Six domains of flourishing for Testland, United States/,
    })
    const text = figure.querySelector('svg')?.textContent ?? ''
    for (const name of Object.values(DOMAIN_NAMES)) expect(text).toContain(name)
    expect(text).toContain('Testland')
    expect(text).toContain('United States')
    // Every domain wears its fixed hue, as a token.
    expect(figure.innerHTML).toContain('var(--sfi-financial)')
    expect(figure.innerHTML).not.toMatch(/#[0-9a-f]{6}/i)
    // Six static requests, no API aggregate.
    expect(calls.filter((url) => url.includes('/data/v1/sfi_')).length).toBe(6)
    expect(calls.some((url) => url.includes('/v1/aggregate'))).toBe(false)
    fireEvent.click(screen.getByText('Data table'))
    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Measure' })).toBeInTheDocument()
    expect(within(table).getAllByText('SFI: meaning & purpose').length).toBe(2)
    expect(within(table).getByText(/Weighted estimates \(w_c1\)/)).toBeInTheDocument()
  })

  test('more than five countries in the URL degrades with the notice', async () => {
    mockFetch(tier)
    await renderAt('/compare?countries=1,2,3,4,5,6')
    expect(await screen.findByText(/were invalid and were reset/)).toHaveTextContent('countries')
    expect(screen.getByText('Choose two to five countries')).toBeInTheDocument()
  })

  test('a split by demographic makes each country a column of its levels', async () => {
    mockFetch(tier)
    await renderAt('/compare?countries=1,22&by=gender')
    const figure = await screen.findByRole('img', { name: /the levels of Gender in each country/ })
    const svg = figure.querySelector('svg')
    const text = svg?.textContent ?? ''
    expect(text).toContain('Male')
    expect(text).toContain('Female')
    expect(text).toContain('Testland')
    // The domain name reads once per row, not once per column; the dots
    // wear one ink hue (the column already names the country); every
    // row carries its value label, like Atlas.
    const happiness = DOMAIN_NAMES['sfi_happiness'] as string
    expect(text.split(happiness).length - 1).toBe(1)
    expect(svg?.innerHTML).not.toContain('var(--sfi-happiness)')
    expect(svg?.innerHTML).toContain('var(--ink)')
    expect(text).toContain('6.01') // Testland, Male: the fixture's 5 + gender + code / 100
  })

  test('without a split the six domains keep their hues and the value labels', async () => {
    mockFetch(tier)
    await renderAt('/compare?countries=1,22')
    const figure = await screen.findByRole('img', { name: /a row per country/ })
    const svg = figure.querySelector('svg')
    expect(svg?.innerHTML).toContain('var(--sfi-happiness)')
    expect(svg?.textContent).toContain('7.00') // the United States row of the first domain
  })

  test('an added categorical measure shows its first answer, as Atlas does', async () => {
    mockFetch(tier)
    await renderAt('/compare?countries=1,22&outcome=ATTEND_SVCS')
    expect(
      await screen.findByRole('img', { name: /^Service attendance for Testland, United States/ }),
    ).toBeInTheDocument()
    expect(screen.getAllByText(/[Ss]hare answering “Weekly”/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/[Ss]hare answering “Never”/)).toBeNull()
  })

  test('an added measure becomes a second figure; removing it drops the param', async () => {
    mockFetch(tier)
    const router = await renderAt('/compare?countries=1,22&outcome=HAPPY')
    expect(
      await screen.findByRole('img', { name: /^Happiness for Testland, United States/ }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Happiness' }))
    await waitFor(() => expect(router.state.location.searchStr).toBe('?countries=1%2C22'))
  })
})

describe('CountryFilter at its cap', () => {
  test('disables the rest and says so in plain words', () => {
    const onChange = vi.fn()
    render(
      <CountryFilter
        countries={[...testMeta.countries, { code: 24, name: 'Hong Kong', iso3: 'HKG' }]}
        selected={[1, 22]}
        onChange={onChange}
        max={2}
        capMessage="Up to 2 countries at a time — clear one to add another."
      />,
    )
    expect(screen.getByText('2 of 2 selected')).toBeInTheDocument()
    expect(screen.getByText(/Up to 2 countries at a time/)).toBeInTheDocument()
    expect(screen.getByLabelText('Hong Kong')).toBeDisabled()
    expect(screen.getByLabelText('Testland')).not.toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Select all' })).toBeNull()
    fireEvent.click(screen.getByLabelText('Testland'))
    expect(onChange).toHaveBeenCalledWith([22])
  })
})
