// US States (Phase 5): the shipped topology (us-atlas states-10m)
// resolves every state and DC, pooled groups fill each member and wear
// an outline, the choropleth wears token fills with the "no estimate"
// swatch for absent states, every state is named by the server, the
// adjusted-weight control is unavailable on Wave 1 with its reason, and
// the states are read beside the US overall figure on the same weight.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { resetNegativePathCache } from '../api/estimates'
import type { ApiHealth } from '../api/types'
import { RankedBar } from '../charts/RankedBar'
import { StateChoropleth, stateTipText } from '../charts/StateChoropleth'
import {
  POSTAL_TO_FIPS,
  featuresFromUsTopology,
  joinStates,
  stateMembers,
} from '../charts/usTopology'
import { createAppRouter } from '../router'
import {
  happyVariable,
  sfiVariable,
  testMeta,
  testResponse,
  testResponseMeta,
  testRow,
} from '../test-utils/fixtures'
import { sortStateRows } from '../views/stateRows'

const topology = JSON.parse(
  readFileSync(join(process.cwd(), 'node_modules', 'us-atlas', 'states-10m.json'), 'utf8'),
) as unknown
const features = featuresFromUsTopology(topology)

const okHealth: ApiHealth = {
  status: 'ok',
  service: 'flourish-atlas-api',
  version: '0.2.0',
  git_sha: 'abc1234def',
  data: 'ok',
  data_version: 'test.1.0.0',
}

const stateRow = (state: string, estimate: number, extra = {}) =>
  testRow({
    group: { state },
    estimate,
    ci_lo: estimate - 0.1,
    ci_hi: estimate + 0.1,
    weight: 'w_state_c1',
    ...extra,
  })

const statesResponse = testResponse(
  [stateRow('CA', 7.1), stateRow('TX', 6.8), stateRow('ME_NH_RI_VT', 7.4), stateRow('NY', 6.5)],
  {
    outcome: 'sfi',
    scope: 'us_state',
    weight_key: 'us_state:y1',
    weight: 'w_state_c1',
    by: ['state'],
  },
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
  '/data/variables.json': { variables: [sfiVariable, happyVariable] },
  '/data/v1/sfi/variable.json': {
    ...sfiVariable,
    value_labels: [],
    missingness: [],
    scoring: null,
    components: [],
  },
  '/data/v1/sfi/Y1/mean_by-country_code.json': testResponse(
    [
      testRow({ group: { country_code: 1 }, estimate: 6.9 }),
      testRow({ group: { country_code: 22 }, estimate: 7.21, ci_lo: 7.1, ci_hi: 7.32, n: 38299 }),
    ],
    { outcome: 'sfi' },
  ),
  '/data/v1/sfi/Y2/mean_by-country_code.json': testResponse(
    [testRow({ group: { country_code: 22 }, estimate: 7.05, n: 30000, weight: 'w_c2' })],
    { outcome: 'sfi', waves: ['Y2'] },
  ),
  '/health': okHealth,
  '/v1/states?outcome=sfi&wave=Y1': statesResponse,
  '/v1/states?outcome=sfi&wave=Y2': {
    ...statesResponse,
    meta: { ...statesResponse.meta, waves: ['Y2'] },
  },
  // The whole US on the state weight: the reference the states are read against.
  'scope=us_state': testResponse(
    [
      testRow({
        group: {},
        estimate: 7.02,
        ci_lo: 6.95,
        ci_hi: 7.09,
        n: 38142,
        weight: 'w_state_c1',
      }),
    ],
    { outcome: 'sfi', scope: 'us_state', weight_key: 'us_state:y1', weight: 'w_state_c1', by: [] },
  ),
  'states-10m': topology,
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

describe('the states topology', () => {
  test('resolves the fifty states and DC, and nothing else', () => {
    expect(features).toHaveLength(51)
    const ids = new Set(features.map((item) => String(item.id)))
    for (const [postal, fips] of Object.entries(POSTAL_TO_FIPS)) {
      expect(ids.has(fips), postal).toBe(true)
    }
    // Territories in the file are dropped: no respondents there.
    expect(ids.has('72')).toBe(false)
  })

  test('a pooled group fills each member; an unknown code is reported, not dropped silently', () => {
    expect(stateMembers('ME_NH_RI_VT')).toEqual(['ME', 'NH', 'RI', 'VT'])
    expect(stateMembers('CA')).toEqual(['CA'])
    const { entries, unmatched } = joinStates([...statesResponse.rows, stateRow('ZZ', 1)], features)
    expect(unmatched).toEqual(['ZZ'])
    expect(entries).toHaveLength(51)
    const byName = new Map(entries.map((entry) => [entry.name, entry]))
    expect(byName.get('Maine')?.code).toBe('ME_NH_RI_VT')
    expect(byName.get('Vermont')?.value).toBe(7.4)
    expect(byName.get('California')?.code).toBe('CA')
    // A state with no estimate keeps its feature, with no row.
    expect(byName.get('Ohio')?.row).toBeNull()
    expect(entries.filter((entry) => entry.row !== null)).toHaveLength(7)
  })

  test('the choropleth paints token fills, the empty fill for absent states, names from meta, and outlines pooled members', () => {
    const { container } = render(
      <StateChoropleth
        rows={statesResponse.rows}
        responseMeta={testResponseMeta({ scope: 'us_state', by: ['state'] })}
        features={features}
        meta={testMeta}
      />,
    )
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    const html = svg?.innerHTML ?? ''
    expect(html).toContain('var(--seq-')
    expect(html).toContain('var(--map-empty)')
    expect(html).not.toMatch(/#[0-9a-f]{6}/i)
    expect(svg?.querySelectorAll('path').length).toBeGreaterThanOrEqual(51)
    // The four pooled members wear a dashed outline on top of the fill
    // (Plot sets a mark's constant stroke on its group).
    const outlined = svg?.querySelector('g[stroke-dasharray]')
    expect(outlined?.querySelectorAll('path').length).toBe(4)
    // Tips name the state as the server does, pooled groups in full,
    // with the interval and the n (Plot renders tips on hover, so the
    // text is checked through the function the mark uses).
    const { entries } = joinStates(statesResponse.rows, features)
    const tip = (name: string) =>
      stateTipText(
        entries.find((entry) => entry.name === name) as (typeof entries)[number],
        testMeta,
      )
    expect(tip('California')).toBe('7.10  California\n95% CI 7.00 to 7.20\nn = 1,204')
    expect(tip('Maine')).toContain('Maine — Maine, New Hampshire, Rhode Island & Vermont (pooled)')
    expect(tip('Ohio')).toBe('Ohio\nno estimate')
  })
})

describe('state rows', () => {
  test('sort by value or by name, valueless last', () => {
    const rows = [
      stateRow('TX', 6.8),
      stateRow('CA', 7.1),
      stateRow('NY', null as unknown as number, { estimate: null }),
    ]
    expect(sortStateRows(rows, 'estimate', 'desc').map((row) => row.group['state'])).toEqual([
      'CA',
      'TX',
      'NY',
    ])
    expect(sortStateRows(rows, 'name', 'asc').map((row) => row.group['state'])).toEqual([
      'CA',
      'NY',
      'TX',
    ])
    // By the server's names, the pooled group sorts under "Maine…".
    const named = [stateRow('TX', 6.8), stateRow('ME_NH_RI_VT', 7.4), stateRow('CA', 7.1)]
    const label = (code: string) => testMeta.state_labels[code]?.name ?? code
    expect(sortStateRows(named, 'name', 'asc', label).map((row) => row.group['state'])).toEqual([
      'CA',
      'ME_NH_RI_VT',
      'TX',
    ])
  })

  test('RankedBar labels rows by the server’s state names and draws the reference', () => {
    const { container } = render(
      <RankedBar
        rows={sortStateRows(statesResponse.rows, 'estimate', 'desc')}
        meta={testMeta}
        responseMeta={testResponseMeta({ scope: 'us_state', by: ['state'] })}
        variable={sfiVariable}
        color="var(--series-1)"
        labelColumn="state"
        reference={{ value: 7.21, label: 'US overall (state weights)' }}
      />,
    )
    const text = container.querySelector('svg')?.textContent ?? ''
    expect(text).toContain('Maine, New Hampshire, Rhode Island & Vermont (pooled)')
    expect(text).toContain('California')
    expect(text).not.toContain('ME_NH_RI_VT')
    expect(text).toContain('US overall (state weights)')
  })
})

describe('US States view', () => {
  test('the map view: states on state weights beside the US overall figure on the same weight, names in the table', async () => {
    const calls = mockFetch(tier)
    await renderAt('/states')
    const figure = await screen.findByRole('img', { name: /Secure Flourishing Index by US state/ })
    expect(figure).toBeInTheDocument()
    // The header line is the whole US on the state weight; the national
    // figure is in the footnote, in words.
    expect(await screen.findByText(/US overall \(state weights\)/)).toBeInTheDocument()
    expect(screen.getByText('7.02')).toBeInTheDocument()
    expect(screen.getByText(/n = 38,142 · w_state_c1/)).toBeInTheDocument()
    expect(
      screen.getByText(/On the national weight, the US overall figure is 7\.21 \[7\.10, 7\.32\]/),
    ).toBeInTheDocument()
    expect(calls.some((url) => url.includes('/v1/states?outcome=sfi&wave=Y1&stat=mean'))).toBe(true)
    expect(
      calls.some((url) =>
        url.includes('/v1/aggregate?outcome=sfi&wave=Y1&stat=mean&scope=us_state'),
      ),
    ).toBe(true)
    // The topology arrives inside the lazy chunk, never before; the
    // legend explains the pooled outline.
    expect(await screen.findByText('no estimate')).toBeInTheDocument()
    expect(screen.getByText(/pooled small states/)).toBeInTheDocument()
    // The aria summary names states, not codes.
    expect(figure.getAttribute('aria-label')).toContain(
      'Highest: Maine, New Hampshire, Rhode Island & Vermont (pooled) 7.40',
    )
    fireEvent.click(screen.getByText('Data table'))
    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'State' })).toBeInTheDocument()
    expect(
      within(table).getByText('Maine, New Hampshire, Rhode Island & Vermont (pooled)'),
    ).toBeInTheDocument()
    expect(within(table).queryByText('ME_NH_RI_VT')).toBeNull()
    expect(within(table).getByText(/Weighted estimates \(w_state_c1\)/)).toBeInTheDocument()
  })

  test('the states chart is weighted by state, says so, and gives the reason a control is off', async () => {
    mockFetch(tier)
    await renderAt('/states?view=bars')
    await screen.findByRole('img', { name: /Secure Flourishing Index by US state/ })
    const text = screen.getByRole('main').textContent ?? ''
    expect(text).toContain("weighted so each state's sample stands for its adult population")
    expect(text).not.toContain("each country's sample")
    const reason = screen.getByText(/The release has no adjusted state weight for Wave 1, 2023/)
    expect(reason.className).toContain('reason')
  })

  test('adjusted weights: unavailable on Wave 1 with the reason, offered on Wave 2, never sent for Y1', async () => {
    const calls = mockFetch(tier)
    const router = await renderAt('/states?view=bars')
    await screen.findByRole('img', { name: /Secure Flourishing Index by US state/ })
    const adj = screen.getByLabelText(/Adjusted state weights/) as HTMLInputElement
    expect(adj).toBeDisabled()
    expect(screen.getByText(/no adjusted state weight for Wave 1, 2023/)).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('group', { name: 'Wave' }).querySelector('input[value="Y2"]') as HTMLElement,
    )
    const adjY2 = await screen.findByLabelText(/Adjusted state weights/)
    expect(adjY2).not.toBeDisabled()
    fireEvent.click(adjY2)
    await screen.findByRole('img', { name: /Secure Flourishing Index by US state/ })
    expect(router.state.location.searchStr).toContain('adj=true')
    expect(
      calls.some((url) => url.includes('/v1/states?outcome=sfi&wave=Y2&stat=mean&adj=true')),
    ).toBe(true)
    expect(calls.some((url) => url.includes('wave=Y1') && url.includes('adj=true'))).toBe(false)
  })

  test('the chart view sorts states and draws the national rule', async () => {
    mockFetch(tier)
    await renderAt('/states?view=bars&sort=name')
    const figure = await screen.findByRole('img', { name: /Secure Flourishing Index by US state/ })
    const text = figure.querySelector('svg')?.textContent ?? ''
    expect(text).toContain('US overall (state weights)')
    expect(text.indexOf('California')).toBeLessThan(text.indexOf('Texas'))
  })
})
