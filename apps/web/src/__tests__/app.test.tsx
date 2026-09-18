// The shell end to end: static-first boot, honest banners scoped to the
// data views, the deck line, the topic → measure picker, the question on
// the page, coverage on Y2 (derived scores included), empty-state
// precedence for an unknown measure, invalid-param notices, 404.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { resetNegativePathCache } from '../api/estimates'
import type { ApiHealth, VariableDetail } from '../api/types'
import { createAppRouter } from '../router'
import { happyVariable, sfiVariable, testMeta, testResponse, testRow } from '../test-utils/fixtures'

const okHealth: ApiHealth = {
  status: 'ok',
  service: 'flourish-atlas-api',
  version: '0.2.0',
  git_sha: 'abc1234def',
  data: 'ok',
  data_version: 'test.1.0.0',
}

const sfiByCountry = testResponse(
  [
    testRow({ group: { country_code: 1 }, estimate: 6.9, ci_lo: 6.8, ci_hi: 7.0, n: 100 }),
    testRow({ group: { country_code: 22 }, estimate: 7.4, ci_lo: 7.3, ci_hi: 7.5, n: 200 }),
  ],
  { outcome: 'sfi' },
)

// A derived score ships no missingness rows — coverage must still appear.
const sfiDetail: VariableDetail = {
  ...sfiVariable,
  value_labels: [],
  missingness: [],
  scoring: 'The mean of the 12 questions below, computed when at least 10 are answered; 0–10.',
  components: [
    {
      name: 'HAPPY',
      display_name: 'Happiness',
      wording: 'How would you rate: happiness?',
      value_labels: [
        { code: 0, label: 'Worst', wave: null, country_code: null, is_nonresponse: false },
      ],
    },
  ],
}

const happyDetail: VariableDetail = {
  ...happyVariable,
  value_labels: [],
  missingness: [],
  scoring: null,
  components: [],
}

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
        if (value instanceof Error) throw value
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

const staticTier: Routes = {
  '/data/meta.json': testMeta,
  '/data/variables.json': { variables: [sfiVariable, happyVariable] },
  '/data/v1/sfi/variable.json': sfiDetail,
  '/data/v1/sfi/Y1/mean_by-country_code.json': sfiByCountry,
  '/data/v1/HAPPY/variable.json': happyDetail,
  '/data/v1/HAPPY/Y1/mean_by-country_code.json': testResponse(
    [testRow({ group: { country_code: 1 } })],
    { outcome: 'HAPPY' },
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

test('the shell renders nav, the deck line, and a citation-only footer', async () => {
  mockFetch(staticTier)
  await renderAt('/')
  const nav = await screen.findByRole('navigation', { name: 'Main' })
  for (const label of ['Atlas', 'Breakdowns', 'Codebook', 'Methods']) {
    expect(nav).toHaveTextContent(label)
  }
  // The deck says what this is, above the fold (F5); the count sits in
  // its own ink-colored span (§6), so match the two parts.
  expect(await screen.findByText(/207,919 people across/)).toBeInTheDocument()
  expect(
    screen.getByText(/rate their own lives — the Global Flourishing Study, 2023–2024/),
  ).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Global Flourishing Study/ })).toHaveAttribute(
    'href',
    'https://doi.org/10.17605/OSF.IO/3JTZ8',
  )
  // The footer carries the citation only (decision 5).
  expect(screen.queryByText(/data version/)).toBeNull()
  expect(screen.queryByText(/associations, not causes/)).toBeNull()
  // The theme button names its action (F15).
  expect(screen.getByRole('button', { name: /Switch to (dark|light)/ })).toBeInTheDocument()
})

test('the Atlas renders from the static tier, question on the page, plain footnote', async () => {
  const calls = mockFetch(staticTier)
  await renderAt('/')
  // In the chart/table as well as the country filter.
  await waitFor(() => expect(screen.getAllByText('United States').length).toBeGreaterThan(1))
  // The wording (here a derived score's description) is on the page, not
  // behind a button (decision 3).
  expect(screen.getByText(/Mean of the 12 SFI items/)).toBeInTheDocument()
  // The footnote names the interval level and nothing more (item 7).
  expect(screen.getByText(/Lines are 95% confidence intervals/)).toBeInTheDocument()
  expect(screen.queryByText(/withheld|flagged|true value/)).toBeNull()
  expect(calls.some((url) => url.includes('/v1/aggregate'))).toBe(false)
})

test('the topic → measure picker: topics carry counts, search jumps across topics', async () => {
  mockFetch(staticTier)
  await renderAt('/')
  const topic = (await screen.findByLabelText('Topic')) as HTMLSelectElement
  expect(topic.value).toBe('derived') // inferred from the sfi outcome
  expect(screen.getByRole('option', { name: 'Flourishing index & its domains (1)' })).toBeVisible()
  const measure = screen.getByLabelText('Measure') as HTMLSelectElement
  expect(measure.value).toBe('sfi')

  // Changing topic keeps the chart until a measure is picked.
  fireEvent.change(topic, { target: { value: 'wellbeing' } })
  const measureAfter = (await screen.findByLabelText('Measure')) as HTMLSelectElement
  expect(measureAfter.value).toBe('') // "Choose a measure…"

  // The search field selects a measure directly and re-infers its topic.
  fireEvent.change(screen.getByLabelText(/or search all/), { target: { value: 'happiness' } })
  fireEvent.click(await screen.findByRole('button', { name: /Happiness/ }))
  expect((await screen.findByLabelText('Topic')) as HTMLSelectElement).toHaveValue('wellbeing')
})

test('an unknown measure gets the empty state, not an API error (F4)', async () => {
  const calls = mockFetch(staticTier)
  await renderAt('/?outcome=NOT_A_VARIABLE')
  expect(await screen.findByText('Choose a measure to begin')).toBeInTheDocument()
  expect(screen.getByText(/isn't in this release's codebook/)).toBeInTheDocument()
  // No doomed request, no API-blame.
  expect(screen.queryByRole('alert')).toBeNull()
  expect(calls.some((url) => url.includes('aggregate') || url.includes('NOT_A_VARIABLE'))).toBe(
    false,
  )
})

test('with the API down the Atlas still renders, with the plain-words banner', async () => {
  mockFetch({ ...staticTier, '/health': new TypeError('fetch failed') })
  await renderAt('/')
  expect(await screen.findByText(/Live data service is/)).toBeInTheDocument()
  expect(screen.getByText(/standard views still work/)).toBeInTheDocument()
  expect((await screen.findAllByText('United States')).length).toBeGreaterThan(0)
})

test('an API without a data build is its own banner', async () => {
  mockFetch({ ...staticTier, '/health': { ...okHealth, data: 'absent', data_version: null } })
  await renderAt('/')
  expect(await screen.findByText(/no data yet/)).toBeInTheDocument()
})

test('with no data source at all the shell renders honestly', async () => {
  mockFetch({ '/health': new TypeError('down') })
  await renderAt('/')
  // Bold sits only on the state word (§7), so the phrase spans elements.
  expect(await screen.findByText(/is reachable right now/)).toBeInTheDocument()
  expect(screen.getByText('No data')).toBeInTheDocument()
  expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
})

test('the offline banner stays off Methods and the 404 page (F13)', async () => {
  mockFetch({ ...staticTier, '/health': new TypeError('fetch failed') })
  await renderAt('/methods')
  expect(await screen.findByRole('heading', { level: 2, name: 'Methods' })).toBeInTheDocument()
  expect(screen.queryByText(/Live data service is/)).toBeNull()
})

test('invalid search params degrade to defaults with a visible notice', async () => {
  mockFetch(staticTier)
  await renderAt('/?wave=Y9&view=pie')
  expect(
    await screen.findByText(/invalid and were reset to defaults: wave, view/),
  ).toBeInTheDocument()
  // The view still renders the default query, not a crash.
  expect((await screen.findAllByText('United States')).length).toBeGreaterThan(0)
})

test('the notice lists every rejected parameter and dismiss clears the URL (F5)', async () => {
  mockFetch(staticTier)
  const router = await renderAt('/?wave=Y9&stat=banana')
  // Both rejected params are listed — and stay listed across the
  // router's own URL rebuilds, because the rejected raws stay in the
  // URL until dismissed.
  expect(await screen.findByText(/reset to defaults: wave, stat/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  await waitFor(() => expect(screen.queryByText(/reset to defaults/)).toBeNull())
  expect(router.state.location.searchStr).toBe('')
})

test('a derived score explains itself in the Codebook (item 11)', async () => {
  mockFetch(staticTier)
  await renderAt('/codebook/sfi')
  expect(await screen.findByText('How it is scored')).toBeInTheDocument()
  expect(
    screen.getByText(/mean of the 12 questions below, computed when at least 10 are answered/),
  ).toBeInTheDocument()
  expect(screen.getByText('The questions behind it')).toBeInTheDocument()
  // Each component question renders with its exact wording and options.
  expect(screen.getByText('How would you rate: happiness?')).toBeInTheDocument()
  expect(screen.getByText('Worst')).toBeInTheDocument()
})

test('unknown routes render the not-found page', async () => {
  mockFetch(staticTier)
  await renderAt('/nowhere')
  expect(await screen.findByText('Page not found')).toBeInTheDocument()
})

// --- Visual-redesign behaviours (Sept 2026, §6/§8) ---

test('chart exports are quiet text links: "Download CSV · PNG" (§6)', async () => {
  mockFetch(staticTier)
  await renderAt('/')
  await screen.findByText('Secure Flourishing Index — Wave 1 (2023)')
  // Healthy API → the CSV is a real download link; PNG stays a button
  // whose accessible name carries the verb.
  expect(screen.getByRole('link', { name: 'Download CSV' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Download PNG' })).toBeInTheDocument()
})

test('the codebook table wears topic names, hides the Chartable header, links "Chart it →" (§6)', async () => {
  mockFetch(staticTier)
  await renderAt('/codebook')
  await screen.findByText(/of \d+ variables/)
  // Family cells and the filter render display names, never raw codes.
  expect(screen.getAllByText('Wellbeing').length).toBeGreaterThan(0)
  expect(screen.queryByText('wellbeing')).toBeNull()
  // The header text survives for screen readers (visually hidden).
  expect(screen.getByText('Chartable')).toBeInTheDocument()
  expect(screen.getAllByRole('link', { name: 'Chart it →' }).length).toBeGreaterThan(0)
})

function stubViewport(matcher: (query: string) => boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matcher(query),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }))
}

test('under 40rem the display options fold into a disclosure; Measure and Wave stay out (§8)', async () => {
  stubViewport((query) => query.includes('40rem'))
  mockFetch(staticTier)
  await renderAt('/')
  await screen.findByText('Secure Flourishing Index — Wave 1 (2023)')
  const summary = screen.getByText('More options — chart, sort, countries')
  const details = summary.closest('details')
  expect(details).not.toBeNull()
  // Wave stays visible outside the fold; Sort lives inside it.
  const wave = screen.getByRole('group', { name: 'Wave' })
  expect(details?.contains(wave)).toBe(false)
  const sort = screen.getByRole('group', { name: 'Sort' })
  expect(details?.contains(sort)).toBe(true)
})

test('the Statistic group becomes a native select under 30rem (§8)', async () => {
  stubViewport(() => true) // a phone matches both 30rem and 40rem
  mockFetch(staticTier)
  await renderAt('/')
  await screen.findByText('Secure Flourishing Index — Wave 1 (2023)')
  const statistic = screen.getByLabelText('Statistic')
  expect(statistic.tagName).toBe('SELECT')
  expect(statistic).toHaveDisplayValue('Mean')
})
