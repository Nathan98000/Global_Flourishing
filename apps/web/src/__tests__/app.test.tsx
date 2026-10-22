// The shell end to end: static-first boot, honest banners scoped to the
// data views, the deck line, the one question picker, the question on
// the page, coverage on Y2 (derived scores included), empty-state
// precedence for an unknown measure, invalid-param notices, 404.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { resetNegativePathCache } from '../api/estimates'
import type { ApiHealth, VariableDetail } from '../api/types'
import { tipText } from '../charts/theme'
import { barLabels } from '../test-utils/bar'
import { createAppRouter } from '../router'
import {
  attendVariable,
  happyVariable,
  sfiVariable,
  testMeta,
  testResponse,
  testRow,
} from '../test-utils/fixtures'

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

/** A derived score whose catalog family is `derived`, which the picker
 * lists under Mental health (ADR-0018). */
const phq2Variable = {
  ...sfiVariable,
  name: 'phq2_score',
  display_name: 'PHQ-2 depression score',
  label: 'Sum of the two PHQ-2 items rescored 0–3 each; 0–6.',
  scale_type: 'count',
  direction: 'lower_better',
  min: 0,
  max: 6,
}

const staticTier: Routes = {
  '/data/meta.json': testMeta,
  '/data/variables.json': { variables: [sfiVariable, happyVariable, phq2Variable] },
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
  // The picker's recently used list lives in this tab's storage.
  window.sessionStorage.clear()
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
  // Phase 6 nav order less Compare (ADR-0017) and the Codebook, which
  // Methods links to instead (ADR-0021) — seven items.
  expect(
    within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent),
  ).toEqual(['Atlas', 'Change', 'What Matters', 'Correlates', 'US States', 'Segments', 'Methods'])
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
  // One light theme (ADR-0023): no theme switch in the header.
  expect(screen.queryByRole('button', { name: /Switch to (dark|light)/ })).toBeNull()
})

/** The statistics keep their names (owner, 22 Oct 2026): Mean, Median,
 * Distribution, Share, 95% CI — never these. */
const RENAMED = /\bAverage\b|Middle value|All answers|likely range/

test('no control, subtitle or card renames a statistic: Mean, Median, Distribution, 95% CI', async () => {
  mockFetch(staticTier)
  await renderAt('/')
  await screen.findByRole('img', { name: /United States/ })
  const main = screen.getByRole('main')
  expect(within(main).getByText(/^Mean score, 0–10/)).toBeInTheDocument()
  expect(main.textContent).not.toMatch(RENAMED)
  // The Show options name the statistics.
  const show = screen.getByRole('group', { name: 'Show' })
  expect(
    within(show)
      .getAllByRole('radio')
      .map((radio) => radio.closest('label')?.textContent),
  ).toEqual(['Mean', 'Distribution', 'Median'])
  // Every card's words, for every statistic the pages show.
  const range = { min: 0, max: 10 }
  for (const stat of ['mean', 'quantile', 'proportion', 'change', 'change_share', 'pearson_r']) {
    const card = tipText(testRow({ stat, estimate: 0.5, ci_lo: 0.4, ci_hi: 0.6 }), 'Testland', {
      range,
      answer: 'Yes',
    })
    expect(card).not.toMatch(RENAMED)
  }
  expect(tipText(testRow({ stat: 'mean' }), 'Testland', { range })).toMatch(/^Testland\nMean: /)
  expect(tipText(testRow({ stat: 'mean' }), 'Testland')).toMatch(/95% CI: \[/)
})

test('the Atlas renders from the static tier, question on the page, no line under the chart', async () => {
  const calls = mockFetch(staticTier)
  await renderAt('/')
  await screen.findByRole('img', { name: /United States/ })
  // The wording (here a derived score's description) is on the page, not
  // behind a button (decision 3).
  expect(
    within(screen.getByRole('figure')).getByText(/Mean of the 12 SFI items/),
  ).toBeInTheDocument()
  // No footnote under the chart (ADR-0024): the cards name the CI's level.
  expect(screen.queryByText(/Lines are 95% confidence intervals/)).toBeNull()
  expect(screen.queryByRole('link', { name: 'How these numbers are made' })).toBeNull()
  expect(screen.queryByText(/withheld|flagged|true value/)).toBeNull()
  expect(calls.some((url) => url.includes('/v1/aggregate'))).toBe(false)
})

test('a categorical question shows every answer, country by country, from its share file', async () => {
  const attendDetail: VariableDetail = {
    ...attendVariable,
    value_labels: ['Weekly', 'Sometimes', 'Never'].map((label, index) => ({
      code: index + 1,
      label,
      wave: null,
      country_code: null,
      is_nonresponse: false,
    })),
    missingness: [],
    scoring: null,
    components: [],
  }
  // Every answer's share for both countries: Testland mostly "Weekly",
  // the United States mostly "Never".
  const shares: Record<number, number[]> = { 1: [0.6, 0.3, 0.1], 22: [0.2, 0.3, 0.5] }
  const proportion = testResponse(
    Object.entries(shares).flatMap(([code, values]) =>
      values.map((estimate, index) =>
        testRow({
          group: { country_code: Number(code) },
          stat: 'proportion',
          level: index + 1,
          estimate,
          ci_lo: estimate - 0.02,
          ci_hi: estimate + 0.02,
        }),
      ),
    ),
    { outcome: 'ATTEND_SVCS', stat: 'proportion' },
  )
  const calls = mockFetch({
    ...staticTier,
    '/data/variables.json': { variables: [sfiVariable, happyVariable, attendVariable] },
    '/data/v1/ATTEND_SVCS/variable.json': attendDetail,
    '/data/v1/ATTEND_SVCS/Y1/proportion_by-country_code.json': proportion,
  })
  const router = await renderAt('/?outcome=ATTEND_SVCS')
  // Share is the default; Distribution is offered beside it.
  const statistic = await screen.findByRole('group', { name: 'Show' })
  expect(within(statistic).getByLabelText('Share')).toBeChecked()
  fireEvent.click(within(statistic).getByLabelText('Distribution'))
  await waitFor(() => expect(router.state.location.searchStr).toContain('stat=distribution'))
  // One stacked bar per country, a segment per answer, keyed in the
  // codebook's order; sorted by the first answer's share, high first.
  const figure = await screen.findByRole('img', { name: /the share giving each of 3 answers/ })
  expect(
    within(screen.getByRole('list', { name: 'Answers' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent),
  ).toEqual(['Weekly', 'Sometimes', 'Never'])
  expect(screen.getByText(/Share giving each answer · sorted by “Weekly”/)).toBeInTheDocument()
  const svg = figure.querySelector('svg') as SVGSVGElement
  expect(svg.querySelectorAll('g[aria-label="bar"] rect')).toHaveLength(6)
  expect(
    [...svg.querySelectorAll('[aria-label="y-axis tick label"] text')].map((t) => t.textContent),
  ).toEqual(['Testland', 'United States'])
  // Sorted by another answer, the order follows it.
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Sort by answer' })).getByLabelText('Never'),
  )
  await waitFor(() =>
    expect(
      [
        ...svg.ownerDocument.querySelectorAll('figure svg [aria-label="y-axis tick label"] text'),
      ].map((t) => t.textContent),
    ).toEqual(['United States', 'Testland']),
  )
  // The share file serves it: no distribution request for a categorical item.
  expect(calls.some((url) => url.includes('ATTEND_SVCS/Y1/distribution'))).toBe(false)
  expect(calls.filter((url) => url.includes('ATTEND_SVCS/Y1/proportion')).length).toBeGreaterThan(0)
})

test('the one question picker: closed, the question and its wording; open, topics and search (ADR-0029)', async () => {
  mockFetch({
    ...staticTier,
    '/data/v1/sfi/Y1/mean_by-country_code.json': sfiByCountry,
  })
  const router = await renderAt('/?level=2')
  // Closed: one button — the short name in bold, a line of wording, and
  // "Change"; its name says what it is.
  const trigger = await screen.findByRole('button', { name: 'Question: Secure Flourishing Index' })
  expect(trigger).toHaveTextContent(/^Secure Flourishing IndexMean of the 12 SFI items.*Change$/)
  expect(screen.queryByLabelText('Topic')).toBeNull()
  expect(screen.queryByLabelText('Measure')).toBeNull()
  // Open: the panel browses the question's own topic, with counts; the
  // PHQ-2 and GAD-2 scores are listed under Mental health (ADR-0018).
  fireEvent.click(trigger)
  const dialog = screen.getByRole('dialog', { name: 'Question' })
  const topics = within(dialog).getByRole('listbox', { name: 'Topics' })
  expect(
    within(topics)
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual(['Flourishing index & its domains1', 'Wellbeing1', 'Mental health1'])
  expect(within(topics).getByRole('option', { name: /Flourishing index/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  // Search finds a question in any topic; picking it writes `outcome`
  // and clears `level`, exactly as the old picker did.
  fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'happiness' } })
  fireEvent.click(within(dialog).getByRole('option', { name: /^Happiness/ }))
  await waitFor(() => expect(router.state.location.searchStr).toBe('?outcome=HAPPY'))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(await screen.findByText('Happiness', { selector: 'figcaption *' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Question: Happiness' })).toHaveFocus()
})

test('the question bar: the same order on every page — what, then when and where (ADR-0029)', async () => {
  mockFetch(staticTier)
  await renderAt('/')
  await screen.findByRole('button', { name: /^Question: / })
  expect(barLabels()).toEqual(['Question', 'Year', 'Countries'])
  cleanup()
  await renderAt('/segments')
  await screen.findByRole('button', { name: /^Question: / })
  expect(barLabels()).toEqual(['Question', 'Split by', 'then by', 'Year', 'Countries'])
})

test('a topic in the URL opens the picker on that topic; a pick clears it', async () => {
  mockFetch(staticTier)
  const router = await renderAt('/?topic=wellbeing')
  fireEvent.click(await screen.findByRole('button', { name: 'Question: Secure Flourishing Index' }))
  const dialog = screen.getByRole('dialog', { name: 'Question' })
  expect(within(dialog).getByRole('option', { name: /^Wellbeing/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  const wellbeing = within(dialog).getByRole('listbox', { name: 'Wellbeing questions' })
  expect(within(wellbeing).getAllByRole('option')).toHaveLength(1)
  fireEvent.click(within(wellbeing).getByRole('option', { name: /^Happiness/ }))
  await waitFor(() => expect(router.state.location.searchStr).toBe('?outcome=HAPPY'))
})

test('Segments has the same picker; a pick keeps the split', async () => {
  mockFetch(staticTier)
  const router = await renderAt('/segments?by=gender')
  fireEvent.click(await screen.findByRole('button', { name: 'Question: Secure Flourishing Index' }))
  const dialog = screen.getByRole('dialog', { name: 'Question' })
  fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'happi' } })
  fireEvent.click(within(dialog).getByRole('option', { name: /^Happiness/ }))
  await waitFor(() => expect(router.state.location.searchStr).toBe('?outcome=HAPPY&by=gender'))
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
  const banner = await screen.findByText(/Some views need the live data service, which is/)
  // What still works, by name, each a link — and no claim that filters
  // are unavailable (the country filter works offline, F13).
  expect(banner).toHaveTextContent(
    'Some views need the live data service, which is offline. The Atlas, Segments and What Matters still work.',
  )
  expect(
    within(banner)
      .getAllByRole('link')
      .map((link) => [link.textContent, link.getAttribute('href')]),
  ).toEqual([
    ['Atlas', '/'],
    ['Segments', '/segments'],
    ['What Matters', '/what-matters'],
  ])
  expect(screen.queryByText(/filters (and medians )?are unavailable/)).toBeNull()
  expect((await screen.findAllByText('United States')).length).toBeGreaterThan(0)
})

test('offline, Median says why it is unavailable, and a median link shows the mean without blame', async () => {
  mockFetch({ ...staticTier, '/health': new TypeError('fetch failed') })
  for (const stat of ['quantile', 'median']) {
    const router = await renderAt(`/?stat=${stat}`)
    expect(
      await screen.findByText(
        'The live data service is offline, so medians can’t be shown right now — showing the mean.',
      ),
    ).toBeInTheDocument()
    // Not the link's fault: no invalid-link notice.
    expect(screen.queryByText(/This link asked for something/)).toBeNull()
    expect(await screen.findByText(/^Mean score, 0–10/)).toBeInTheDocument()
    const median = screen.getByRole('radio', { name: 'Median' })
    expect(median).toBeDisabled()
    expect(median).toHaveAccessibleDescription('Median — needs the live data service.')
    expect(screen.getByRole('radio', { name: 'Mean' })).toBeChecked()
    // The link keeps its ask, for when the service is back.
    expect(router.state.location.searchStr).toBe('?stat=quantile')
    cleanup()
  }
})

test('a disabled year says why in view on Segments too (F6)', async () => {
  mockFetch(staticTier)
  await renderAt('/segments')
  const midyear = await screen.findByRole('radio', { name: 'Midyear' })
  expect(midyear).toBeDisabled()
  expect(midyear).toHaveAccessibleDescription(
    'Midyear — not asked in the midyear survey, a shorter survey between the two years.',
  )
})

test('a disabled year says why in view, and points to the reason (F6)', async () => {
  mockFetch(staticTier)
  await renderAt('/')
  await screen.findByText(/^Mean score, 0–10/)
  const midyear = screen.getByRole('radio', { name: 'Midyear' })
  expect(midyear).toBeDisabled()
  expect(midyear).toHaveAccessibleDescription(
    'Midyear — not asked in the midyear survey, a shorter survey between the two years.',
  )
  expect(
    screen.getByText(
      'Midyear — not asked in the midyear survey, a shorter survey between the two years.',
    ),
  ).toBeVisible()
  // No hover-only reason; the open years point nowhere.
  expect(midyear.closest('label')).not.toHaveAttribute('title')
  expect(screen.getByRole('radio', { name: '2023' })).not.toHaveAttribute('aria-describedby')
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
  await renderAt('/?wave=Y9&sort=pie')
  const notice = await screen.findByText(/This link asked for something we can’t show/)
  expect(notice).toHaveTextContent(
    'This link asked for something we can’t show; showing the default instead. Dismiss',
  )
  expect(notice).toHaveAttribute('data-params', 'wave,sort')
  // The view still renders the default query, not a crash.
  expect((await screen.findAllByText('United States')).length).toBeGreaterThan(0)
})

test('the notice lists every rejected parameter and dismiss clears the URL (F5)', async () => {
  mockFetch(staticTier)
  const router = await renderAt('/?wave=Y9&stat=banana')
  // Both rejected params are listed — and stay listed across the
  // router's own URL rebuilds, because the rejected raws stay in the
  // URL until dismissed.
  expect(await screen.findByText(/This link asked for something/)).toHaveAttribute(
    'data-params',
    'wave,stat',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  await waitFor(() => expect(screen.queryByText(/This link asked for something/)).toBeNull())
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

test('a codebook entry’s tables each sit in a box that scrolls sideways on a phone', async () => {
  // The value labels and "Answered, by country and wave": a label with
  // nowhere to break can be wider than a phone — its box scrolls, the
  // page never does (journey 11 holds the widths).
  mockFetch({
    ...staticTier,
    '/data/v1/HAPPY/variable.json': {
      ...happyDetail,
      value_labels: [
        { code: 0, label: 'Worst', wave: null, country_code: null, is_nonresponse: false },
      ],
      missingness: [
        {
          country_code: 1,
          wave: 'Y1',
          n_present: 60,
          n_valid: 60,
          n_dk: 0,
          n_refused: 0,
          n_skipped: 0,
        },
      ],
    } satisfies VariableDetail,
  })
  await renderAt('/codebook/HAPPY')
  expect(await screen.findByText('Value labels')).toBeInTheDocument()
  const tables = screen.getAllByRole('table')
  expect(tables).toHaveLength(2)
  for (const table of tables) {
    expect(table.parentElement?.className).toContain('tableScroll')
  }
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
  await screen.findByText('Mean score, 0–10 · 2023')
  // Healthy API → the CSV is a real download link; PNG stays a button
  // whose accessible name carries the verb.
  expect(screen.getByRole('link', { name: 'Download CSV' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Download PNG' })).toBeInTheDocument()
})

test('the codebook table wears topic names, hides the Chartable header, links "Chart it →" (§6)', async () => {
  mockFetch(staticTier)
  await renderAt('/codebook')
  await screen.findByText(/\d+ questions/)
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
  await screen.findByText('Mean score, 0–10 · 2023')
  const summary = screen.getByText('More options — chart, order, countries')
  const details = summary.closest('details')
  expect(details).not.toBeNull()
  // Year stays visible outside the fold; Order lives inside it.
  const wave = screen.getByRole('group', { name: 'Year' })
  expect(details?.contains(wave)).toBe(false)
  const order = screen.getByRole('group', { name: 'Order' })
  expect(details?.contains(order)).toBe(true)
})

test('the Statistic group becomes a native select under 30rem (§8)', async () => {
  stubViewport(() => true) // a phone matches both 30rem and 40rem
  mockFetch(staticTier)
  await renderAt('/')
  await screen.findByText('Mean score, 0–10 · 2023')
  const statistic = screen.getByLabelText('Show')
  expect(statistic.tagName).toBe('SELECT')
  expect(statistic).toHaveDisplayValue('Mean')
})

test('on a phone the secondary three nav items collapse behind "More" (type unchanged)', async () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      // A phone: below both the display-option fold and the nav fold.
      matches: query === '(max-width: 40rem)' || query === '(max-width: 50rem)',
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })),
  )
  mockFetch(staticTier)
  await renderAt('/codebook')
  const nav = await screen.findByRole('navigation', { name: 'Main' })
  // The primary four are inline; the rest sit inside the disclosure.
  const inline = within(nav)
    .getAllByRole('link')
    .map((link) => link.textContent)
  expect(inline).toEqual([
    'Atlas',
    'Change',
    'What Matters',
    'Correlates',
    'US States',
    'Segments',
    'Methods',
  ])
  const more = within(nav).getByText('More')
  expect(more.closest('details')).not.toBeNull()
  // A codebook page is reached from Methods, which lives inside "More":
  // the summary and Methods both read active (ADR-0021).
  expect(more).toHaveAttribute('data-status', 'active')
  const methods = within(nav).getByRole('link', { name: 'Methods' })
  expect(methods.closest('details')).not.toBeNull()
  expect(methods).toHaveAttribute('data-status', 'active')
  expect(within(nav).queryByRole('link', { name: 'Codebook' })).toBeNull()
  expect(within(nav).getByRole('link', { name: 'Atlas' }).closest('details')).toBeNull()
})

test('entering an API-only view fires one warm-up ping; the Atlas does not', async () => {
  const atlasCalls = mockFetch(staticTier)
  await renderAt('/')
  await screen.findByText(/207,919 people across/)
  await waitFor(() => expect(atlasCalls.filter((url) => url.endsWith('/health'))).toHaveLength(1))

  const changeCalls = mockFetch(staticTier)
  await renderAt('/change')
  expect(await screen.findByRole('heading', { name: 'Change' })).toBeInTheDocument()
  // The boot ping (useBootStatus) plus the route's own warm-up.
  await waitFor(() =>
    expect(changeCalls.filter((url) => url.endsWith('/health')).length).toBeGreaterThanOrEqual(2),
  )
  // The outage banner is scoped to data views: the new routes count.
  expect(screen.queryByText(/Every view on this deployment/)).toBeNull()
})

test('the Phase 5 routes exist, parse their URL state and say what they are', async () => {
  mockFetch(staticTier)
  for (const [path, heading] of [
    ['/change?via=MY', 'Change'],
    ['/what-matters?by=gender', 'What Matters'],
    ['/states?wave=Y2&adj=true', 'US States'],
  ] as const) {
    const router = await renderAt(path)
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(path.split('?')[0])
    cleanup()
  }
  // Bad params degrade with the notice, never a crash.
  await renderAt('/states?adj=true')
  expect(await screen.findByText(/This link asked for something/)).toHaveAttribute(
    'data-params',
    'adj',
  )
})

test('an old Compare link lands on Segments with its outcome and wave, and no notice', async () => {
  mockFetch(staticTier)
  for (const [path, href, outcome] of [
    // sfi is the Segments default, so the address omits it (defaults
    // never reach the URL); the view still shows sfi.
    ['/compare?outcome=sfi&countries=1,2', '/segments', 'sfi'],
    [
      '/compare?countries=1,22&wave=Y2&by=gender&outcome=HAPPY&topic=wellbeing',
      '/segments?outcome=HAPPY&wave=Y2',
      'HAPPY',
    ],
    // Invalid values are dropped silently, like every other param.
    ['/compare?outcome=HAPPY&wave=Y9', '/segments?outcome=HAPPY', 'HAPPY'],
  ] as const) {
    const router = await renderAt(path)
    expect(await screen.findByRole('heading', { name: 'Segments' })).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.href).toBe(href))
    // Compare's countries and split did not come along.
    expect(router.state.matches.at(-1)?.search).toMatchObject({
      outcome,
      countries: [],
      by: ['age_band'],
    })
    expect(screen.queryByText(/This link asked for something/)).toBeNull()
    cleanup()
  }
})

test('an old Breakdowns link lands on Segments with every param it carried', async () => {
  mockFetch(staticTier)
  for (const [path, href] of [
    ['/breakdowns?by=gender', '/segments?by=gender'],
    [
      '/breakdowns?outcome=HAPPY&wave=Y2&by=gender&sort=gap&countries=1%2C22',
      '/segments?outcome=HAPPY&wave=Y2&by=gender&sort=gap&countries=1%2C22',
    ],
    // An old A–Z order opens the value order, unannounced (ADR-0029):
    // `name` is never written again.
    ['/breakdowns?outcome=HAPPY&by=gender&sort=name&dir=asc', '/segments?outcome=HAPPY&by=gender'],
  ] as const) {
    const router = await renderAt(path)
    expect(await screen.findByRole('heading', { name: 'Segments' })).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.href).toBe(href))
    expect(document.title).toBe('Segments — Flourish Atlas')
    cleanup()
  }
  // A bad value rides along too, and Segments flags it as Breakdowns did.
  const router = await renderAt('/breakdowns?wave=Y9')
  await waitFor(() => expect(router.state.location.href).toBe('/segments?wave=Y9'))
  expect(await screen.findByText(/This link asked for something/)).toHaveAttribute(
    'data-params',
    'wave',
  )
})
