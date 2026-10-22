// US States (Phase 5): the shipped topology (us-atlas states-10m)
// resolves every state and DC, every state is its own (none pooled,
// ADR-0028), the choropleth wears token fills with the "no estimate"
// swatch for absent states, every state is named by the server, the
// adjusted-weight control is unavailable on Wave 1 with its reason, and
// the states are read beside the US overall figure on the same weight.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { resetNegativePathCache } from '../api/estimates'
import type { ApiHealth } from '../api/types'
import { RankedBar } from '../charts/RankedBar'
import { StateChoropleth, stateTipText } from '../charts/StateChoropleth'
import { POSTAL_TO_FIPS, featuresFromUsTopology, joinStates } from '../charts/usTopology'
import { createAppRouter } from '../router'
import {
  happyVariable,
  sfiVariable,
  testMeta,
  testResponse,
  testResponseMeta,
  testRow,
} from '../test-utils/fixtures'
import { barLabels } from '../test-utils/bar'
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
  [stateRow('CA', 7.1), stateRow('TX', 6.8), stateRow('VT', 7.4), stateRow('NY', 6.5)],
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

  test('each state fills its own feature; an unknown code is reported, not dropped silently', () => {
    // A pooled group's code is no state's: reported, never spread over
    // its members (ADR-0028).
    const { entries, unmatched } = joinStates(
      [...statesResponse.rows, stateRow('ZZ', 1), stateRow('ME_NH_RI_VT', 7)],
      features,
    )
    expect(unmatched).toEqual(['ZZ', 'ME_NH_RI_VT'])
    expect(entries).toHaveLength(51)
    const byName = new Map(entries.map((entry) => [entry.name, entry]))
    expect(byName.get('Vermont')?.code).toBe('VT')
    expect(byName.get('Vermont')?.value).toBe(7.4)
    expect(byName.get('California')?.code).toBe('CA')
    // A state with no estimate keeps its feature, with no row — Maine
    // included, whatever its neighbour shows.
    expect(byName.get('Ohio')?.row).toBeNull()
    expect(byName.get('Maine')?.row).toBeNull()
    expect(entries.filter((entry) => entry.row !== null)).toHaveLength(4)
  })

  test('the choropleth paints token fills, the empty fill for absent states and names from meta', () => {
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
    // Seven shades: the highest state wears the ramp's seventh step, and
    // nothing the two deeper ones (Compare two's grid's alone).
    expect(html).toContain('var(--seq-700)')
    expect(html).not.toMatch(/--seq-[89]00/)
    expect(svg?.querySelectorAll('path').length).toBeGreaterThanOrEqual(51)
    // No state wears a pooled group's dashed outline.
    expect(svg?.querySelector('g[stroke-dasharray]')).toBeNull()
    // Cards name the state as the server does, then the value in words,
    // its CI and its n (Plot renders tips on hover, so the text is
    // checked through the function the mark uses).
    const { entries } = joinStates(statesResponse.rows, features)
    const tip = (name: string) =>
      stateTipText(
        entries.find((entry) => entry.name === name) as (typeof entries)[number],
        testMeta,
        { range: { min: 0, max: 10 } },
      )
    expect(tip('California').split('\n')).toEqual([
      'California',
      'Mean: 7.10 on a 0–10 scale',
      '95% CI: [7.00, 7.20]',
      expect.stringMatching(/^Based on \d[\d,]* people$/),
    ])
    expect(tip('Vermont').split('\n').slice(0, 2)).toEqual([
      'Vermont',
      'Mean: 7.40 on a 0–10 scale',
    ])
    expect(tip('Ohio')).toBe('Ohio\nNo estimate')
  })
})

describe('state rows', () => {
  test('by value in either direction, valueless last, ties by the server’s names', () => {
    const rows = [
      stateRow('TX', 6.8),
      stateRow('CA', 7.1),
      stateRow('NY', null as unknown as number, { estimate: null }),
    ]
    expect(sortStateRows(rows, 'desc').map((row) => row.group['state'])).toEqual(['CA', 'TX', 'NY'])
    expect(sortStateRows(rows, 'asc').map((row) => row.group['state'])).toEqual(['TX', 'CA', 'NY'])
    // A tie reads in the server's names: California before Vermont.
    const tied = [stateRow('VT', 7.1), stateRow('CA', 7.1)]
    const label = (code: string) => testMeta.state_labels[code]?.name ?? code
    expect(sortStateRows(tied, 'desc', label).map((row) => row.group['state'])).toEqual([
      'CA',
      'VT',
    ])
  })

  test('RankedBar labels rows by the server’s state names and draws the reference', () => {
    const { container } = render(
      <RankedBar
        rows={sortStateRows(statesResponse.rows, 'desc')}
        meta={testMeta}
        responseMeta={testResponseMeta({ scope: 'us_state', by: ['state'] })}
        variable={sfiVariable}
        color="var(--series-1)"
        labelColumn="state"
        reference={{ value: 7.21, label: 'US overall (state weights)' }}
      />,
    )
    const text = container.querySelector('svg')?.textContent ?? ''
    expect(text).toContain('Vermont')
    expect(text).toContain('California')
    expect(text).not.toContain('VT')
    expect(text).toContain('US overall (state weights)')
  })
})

describe('the US overall label', () => {
  /** An element's drawn y: its own translate, plus its group's. */
  const drawnY = (element: Element) =>
    [element, element.parentElement].reduce((y, node) => {
      const match = /translate\([^,]+,([-\d.]+)\)/.exec(node?.getAttribute('transform') ?? '')
      return y + (match ? Number(match[1]) : 0)
    }, 0)

  test('on a share chart it sits above the first bar, never on the axis below', () => {
    const rows = ['CA', 'TX', 'VT', 'NY'].map((state, index) =>
      testRow({
        group: { state },
        stat: 'proportion',
        level: 1,
        estimate: 0.4 + index / 10,
        ci_lo: 0.35 + index / 10,
        ci_hi: 0.45 + index / 10,
      }),
    )
    const { container } = render(
      <RankedBar
        rows={rows}
        meta={testMeta}
        responseMeta={testResponseMeta({ stat: 'proportion', scope: 'us_state', by: ['state'] })}
        variable={sfiVariable}
        color="var(--series-1)"
        labelColumn="state"
        reference={{ value: 55, label: 'US overall (state weights)' }}
      />,
    )
    const svg = container.querySelector('svg') as SVGSVGElement
    const label = [...svg.querySelectorAll('text')].find(
      (text) => text.textContent === 'US overall (state weights)',
    ) as SVGTextElement
    // Its baseline (the text runs up from it) above the first bar's top.
    const firstBar = svg.querySelector('g[aria-label="bar"] > path') as SVGPathElement
    const barTop = Number(/^M[-\d.]+,([-\d.]+)/.exec(firstBar.getAttribute('d') ?? '')?.[1])
    expect(drawnY(label)).toBeLessThan(barTop)
    // The axis's labels are under the bars, far from it.
    const tick = svg.querySelector('g[aria-label="x-axis tick label"] text') as SVGTextElement
    expect(drawnY(tick)).toBeGreaterThan(barTop)
  })
})

describe('US States view', () => {
  test('the question bar: Question, then Year (ADR-0029)', async () => {
    mockFetch(tier)
    await renderAt('/states')
    await screen.findByRole('button', { name: /^Question: / })
    expect(barLabels()).toEqual(['Question', 'Year'])
  })

  test('the one question picker: every question; a pick writes the outcome and clears the answer', async () => {
    mockFetch(tier)
    const router = await renderAt('/states?view=bars&level=2')
    fireEvent.click(
      await screen.findByRole('button', { name: 'Question: Secure Flourishing Index' }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Question' })
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'happi' } })
    fireEvent.click(within(dialog).getByRole('option', { name: /^Happiness/ }))
    await waitFor(() => expect(router.state.location.searchStr).toBe('?outcome=HAPPY&view=bars'))
  })

  test('the map view: states on state weights beside the US overall figure on the same weight, names from the server', async () => {
    const calls = mockFetch(tier)
    await renderAt('/states')
    const figure = await screen.findByRole('img', { name: /Secure Flourishing Index by US state/ })
    expect(figure).toBeInTheDocument()
    // The header line is the whole US on the state weight; the national
    // figure follows it, in words.
    expect(await screen.findByText(/US overall \(state weights\)/)).toBeInTheDocument()
    expect(screen.getByText('7.02')).toBeInTheDocument()
    // The n, and no weight code: the weighting is said in words.
    expect(screen.getByText('based on 38,142 people')).toBeInTheDocument()
    expect(screen.queryByText(/n = 38,142 · /)).toBeNull()
    expect(
      screen.getByText(/On the national weight, the US overall figure is 7\.21 \[7\.10, 7\.32\]/),
    ).toBeInTheDocument()
    expect(calls.some((url) => url.includes('/v1/states?outcome=sfi&wave=Y1&stat=mean'))).toBe(true)
    expect(
      calls.some((url) =>
        url.includes('/v1/aggregate?outcome=sfi&wave=Y1&stat=mean&scope=us_state'),
      ),
    ).toBe(true)
    // The topology arrives inside the lazy chunk, never before; nothing
    // is pooled, so the legend has no pooled entry (ADR-0028).
    expect(await screen.findByText('no estimate')).toBeInTheDocument()
    expect(screen.queryByText(/pooled/i)).toBeNull()
    // The aria summary names states, not codes.
    expect(figure.getAttribute('aria-label')).toContain('Highest: Vermont 7.40')
    // No data table (ADR-0022): each state's card carries its numbers.
    expect(screen.queryByText('Data table')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByText('VT')).toBeNull()
  })

  test('the states chart’s subtitle carries its state in the controls’ words, and a control off says why', async () => {
    mockFetch(tier)
    await renderAt('/states?view=bars')
    await screen.findByRole('img', { name: /Secure Flourishing Index by US state/ })
    // No weight jargon: the year and the order (ADR-0029).
    expect(
      screen.getByText('Mean score, 0–10 · 2023 · highest first', { selector: 'figcaption *' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/state weights/, { selector: 'figcaption *' })).toBeNull()
    // No line under the chart (ADR-0024).
    const text = screen.getByRole('main').textContent ?? ''
    expect(text).not.toContain('weighted so each')
    const reason = screen.getByText(/The release has no adjusted state weight for 2023/)
    expect(reason.className).toContain('reason')
  })

  test('adjusted weights: unavailable on Wave 1 with the reason, offered on Wave 2, never sent for Y1', async () => {
    const calls = mockFetch(tier)
    const router = await renderAt('/states?view=bars')
    await screen.findByRole('img', { name: /Secure Flourishing Index by US state/ })
    const adj = screen.getByLabelText(/Adjust for who answered in each state/) as HTMLInputElement
    expect(adj).toBeDisabled()
    // A year the question wasn't asked in says why, in view (F6).
    const midyear = within(screen.getByRole('group', { name: 'Year' })).getByRole('radio', {
      name: 'Midyear',
    })
    expect(midyear).toBeDisabled()
    expect(midyear).toHaveAccessibleDescription(
      'Midyear — not asked in the midyear survey, a shorter survey between the two years.',
    )
    expect(screen.getByText(/no adjusted state weight for 2023/)).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('group', { name: 'Year' }).querySelector('input[value="Y2"]') as HTMLElement,
    )
    const adjY2 = await screen.findByLabelText(/Adjust for who answered in each state/)
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
