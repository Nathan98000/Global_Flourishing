// The Correlates view (Phase 6): what goes with a measure, from two
// /v1/correlates envelopes — the ranked list for one country and the same
// measures across countries, one view at a time. The guards that matter:
// a correlation is a point estimate and gets no interval anywhere (no
// whisker, no "95%", no interval in the footnote); the adjusted model is
// gone from the page (ADR-0018) and an old link's `adjusted` is reported,
// never sent; the caveat is said in the deck and the footnote as plain
// sentences.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { predictorOrder } from '../api/correlates'
import { resetNegativePathCache } from '../api/estimates'
import type {
  ApiHealth,
  CorrelationsResponse,
  EstimateRow,
  PairResponse,
  VariableDetail,
  VariableSummary,
} from '../api/types'
import { footnoteCopy } from '../charts/ChartFigure'
import { shareLabel, shareTint } from '../charts/CrossTab'
import { DIVERGING_RAMP, SEQUENTIAL_RAMP, divergingTint, signMark, tipText } from '../charts/theme'
import { RankedBar, wrapLabel } from '../charts/RankedBar'
import { HEAT_CELL_PAD, HeatTable, columnsPastEdge, intervalText } from '../charts/TransitionTable'
import { pairToCsv } from '../export/csv'
import { formatEstimate } from '../format'
import { createAppRouter } from '../router'
import { headingColumnWidth } from '../views/correlates/CompareSeveral'
import {
  attendVariable,
  happyVariable,
  sfiVariable,
  testMeta,
  testResponse,
  testResponseMeta,
  testRow,
} from '../test-utils/fixtures'
import {
  CORRELATES_NOTE,
  CORRELATION_SCALE,
  axisEnds,
  belowFloor,
  averagedOver,
  coverageLine,
  pooledPlace,
  scopeLabel,
  countriesByName,
  fewPeople,
  defaultCountry,
  heatCells,
  acrossSubtitle,
  legendEnds,
  pairAxisTitle,
  likelyRange,
  pairBarTip,
  pairCellTip,
  pinnedFirst,
  rankedSubtitle,
  rankedTip,
  starred,
  shortName,
  statisticPhrase,
  waveNote,
} from '../views/correlatesRows'

const okHealth: ApiHealth = {
  status: 'ok',
  service: 'flourish-atlas-api',
  version: '0.2.0',
  git_sha: 'abc1234def',
  data: 'ok',
  data_version: 'test.1.0.0',
}

const lonelyVariable: VariableSummary = {
  ...happyVariable,
  name: 'LONELY',
  display_name: 'Loneliness',
  direction: 'lower_better',
  polarity: 'ascending',
  waves_available: ['Y1'],
}

const urbanVariable: VariableSummary = {
  ...happyVariable,
  name: 'URBAN_RURAL',
  display_name: 'Urban or rural',
  scale_type: 'nominal',
  direction: 'none',
  polarity: 'ascending',
  min: 1,
  max: 4,
  default_stat: 'proportion',
}

const todayVariable: VariableSummary = {
  ...happyVariable,
  name: 'WB_TODAY',
  display_name: 'Life evaluation today',
  wording: 'On which step of the ladder do you stand today?',
}

const incomeVariable: VariableSummary = {
  ...attendVariable,
  name: 'INCOME_FEELINGS',
  display_name: 'Feelings about household income',
  family: 'demographics',
  subfamily: null,
  min: 1,
  max: 4,
}

const sfiDetail: VariableDetail = {
  ...sfiVariable,
  value_labels: [],
  missingness: [],
  scoring: null,
  components: [{ name: 'HAPPY', display_name: 'Happiness', wording: null, value_labels: [] }],
}

const happyDetail: VariableDetail = {
  ...happyVariable,
  value_labels: [],
  missingness: [],
  scoring: null,
  components: [],
}

/** An unadjusted row: a point estimate, no interval of any kind. */
const plainRow = (predictor: string, estimate: number, code?: number, n = 54) =>
  testRow({
    group: code === undefined ? {} : { country_code: code },
    predictor,
    stat: 'pearson_r',
    estimate,
    se: null,
    ci_lo: null,
    ci_hi: null,
    ci_method: 'none',
    se_method: 'none',
    n,
  })

const rankedPlain = testResponse([plainRow('LONELY', -0.52), plainRow('ATTEND_SVCS', 0.31)], {
  outcome: 'HAPPY',
  stat: 'pearson_r',
  se_method: 'none',
  by: [],
  filters: { country_code: [22] },
  adjusted: false,
  controls: [],
  model: null,
  min_n: 20,
  n_excluded: 1,
})

/** Across countries; the last cell rests on too few cases to rank. */
const acrossPlain = testResponse(
  [
    plainRow('LONELY', -0.52, 1),
    plainRow('LONELY', -0.4, 22),
    plainRow('ATTEND_SVCS', 0.31, 1),
    plainRow('ATTEND_SVCS', 0.05, 22, 7),
  ],
  {
    outcome: 'HAPPY',
    stat: 'pearson_r',
    se_method: 'none',
    by: ['country_code'],
    adjusted: false,
    min_n: 20,
    n_excluded: 0,
  },
)

/** Service attendance (columns: Never → Weekly, its aligned order) by
 * Feelings about household income (rows: very difficult → living
 * comfortably) in the United States, as the cross-tab the pair endpoint
 * serves; cells with fewer than 5 people are flagged. */
const FEELINGS = [
  { code: 4, label: 'Finding it very difficult on present income' },
  { code: 3, label: 'Finding it difficult on present income' },
  { code: 2, label: 'Getting by on present income' },
  { code: 1, label: 'Living comfortably on present income' },
]
const ATTEND = [
  { code: 3, label: 'Never', share: 0.3, n: 18 },
  { code: 2, label: 'Sometimes', share: 0.3, n: 18 },
  { code: 1, label: 'Weekly', share: 0.4, n: 24 },
]
/** Each column's shares and counts, rows in FEELINGS order. */
const GRID: [number, number][][] = [
  [
    [0.5, 9],
    [0.3, 5],
    [0.15, 3],
    [0.05, 1],
  ],
  [
    [0.3, 5],
    [0.3, 5],
    [0.3, 6],
    [0.1, 2],
  ],
  [
    [0.1, 2],
    [0.2, 5],
    [0.3, 7],
    [0.4, 10],
  ],
]

const pairFixture: PairResponse = {
  x: 'ATTEND_SVCS',
  y: 'INCOME_FEELINGS',
  x_grouping: 'answers',
  y_grouping: 'answers',
  correlation: plainRow('ATTEND_SVCS', 0.31, undefined, 60),
  min_n: 20,
  columns: ATTEND.map((column) => ({
    ...column,
    ci_lo: column.share - 0.1,
    ci_hi: column.share + 0.1,
    flagged: false,
  })),
  rows: FEELINGS,
  cells: ATTEND.flatMap((column, i) =>
    FEELINGS.map((row, j) => {
      const [share, n] = GRID[i]?.[j] ?? [0, 0]
      return { x: column.code, y: row.code, share, n, flagged: n < 5 }
    }),
  ),
  shares: testResponse(
    ATTEND.flatMap((column, i) =>
      FEELINGS.map((row, j) => {
        const [share, n] = GRID[i]?.[j] ?? [0, 0]
        return testRow({
          group: { ATTEND_SVCS: column.code, INCOME_FEELINGS: row.code },
          stat: 'proportion',
          estimate: share,
          se: 0.02,
          ci_lo: Math.max(0, share - 0.04),
          ci_hi: share + 0.04,
          n,
          sum_w: column.n,
        })
      }),
    ),
    {
      outcome: 'INCOME_FEELINGS',
      scale_type: 'ordinal',
      stat: 'proportion',
      by: ['ATTEND_SVCS', 'INCOME_FEELINGS'],
      filters: { country_code: [22] },
      n_valid: 60,
    },
  ),
  cell_flag_below: 5,
  column_flag_below: 10,
}

/** The pair's correlation in each country (Compare two, in every country). */
const pairAcross = testResponse(
  [plainRow('INCOME_FEELINGS', 0.12, 1, 8), plainRow('INCOME_FEELINGS', 0.31, 22, 60)],
  {
    outcome: 'ATTEND_SVCS',
    stat: 'pearson_r',
    se_method: 'none',
    by: ['country_code'],
    adjusted: false,
    min_n: 20,
    n_excluded: 0,
  },
)

/** A three-question table: one pair estimated, one built from the same
 * answers (never estimated), one resting on too few people. */
const tableFixture: CorrelationsResponse = {
  meta: {
    data_version: 'test.1.0.0',
    vars: ['HAPPY', 'LONELY', 'ATTEND_SVCS'],
    wave: 'Y1',
    stat: 'pearson_r',
    weight_key: 'y1',
    weight: 'w_c1',
    ci_level: 0.95,
    suppression: { threshold: 0, flag_below: 0 },
    n_frame: 60,
    filters: { country_code: [22] },
    min_n: 20,
  },
  pairs: [
    {
      a: 'HAPPY',
      b: 'LONELY',
      shares_answers: false,
      below_min_n: false,
      correlation: plainRow('LONELY', -0.52),
    },
    { a: 'HAPPY', b: 'ATTEND_SVCS', shares_answers: true, below_min_n: false, correlation: null },
    {
      a: 'LONELY',
      b: 'ATTEND_SVCS',
      shares_answers: false,
      below_min_n: true,
      correlation: plainRow('ATTEND_SVCS', 0.2, undefined, 7),
    },
  ],
  similar_order: ['LONELY', 'HAPPY', 'ATTEND_SVCS'],
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

// The cross-country requests carry `by`; the ranked one filters to a country.
const tier: Routes = {
  '/data/meta.json': testMeta,
  '/data/variables.json': {
    variables: [
      sfiVariable,
      happyVariable,
      attendVariable,
      lonelyVariable,
      urbanVariable,
      todayVariable,
      incomeVariable,
    ],
  },
  '/data/v1/HAPPY/variable.json': happyDetail,
  '/health': okHealth,
  '/v1/correlations/pair': pairFixture,
  '/v1/correlations?': tableFixture,
  'against=INCOME_FEELINGS&by=country_code': pairAcross,
  '&by=country_code': acrossPlain,
  'filter=country_code%3A22': rankedPlain,
}

/** What a reader sees: textContent minus the <style> blocks Plot embeds. */
function visibleText(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement
  for (const node of clone.querySelectorAll('style, script')) node.remove()
  return clone.textContent ?? ''
}

/** The line after a chart's data table: on this page, its one note. */
function figureNote(chart: HTMLElement): string {
  const details = chart.closest('figure')?.querySelector(':scope > details')
  return details?.nextElementSibling?.textContent ?? ''
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetNegativePathCache()
})

const FOUR_COLUMNS = ['w', 'x', 'y', 'z'].map((key) => ({ key, label: key.toUpperCase() }))

/** A HeatTable's layout, faked for jsdom: the scroll box `width` wide,
 * header cell i spanning [100i, 100i + 100] (the sticky corner is cell
 * 0), a ResizeObserver that measures once; returns the box's scrollBy
 * spy and the undo. */
function fakeHeatLayout(width: number) {
  const rect = (left: number, span: number) =>
    ({
      left,
      right: left + span,
      width: span,
      top: 0,
      bottom: 20,
      height: 20,
      x: left,
      y: 0,
    }) as DOMRect
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  const rects = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ) {
    if (this.tagName !== 'TH') return rect(0, width)
    return rect([...(this.parentElement?.children ?? [])].indexOf(this) * 100, 100)
  })
  const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width)
  const scrollBy = vi.fn()
  HTMLElement.prototype.scrollBy = scrollBy
  return {
    scrollBy,
    restore: () => {
      rects.mockRestore()
      clientWidth.mockRestore()
      delete (HTMLElement.prototype as { scrollBy?: unknown }).scrollBy
    },
  }
}

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

const ruleLines = (figure: HTMLElement) =>
  figure.querySelectorAll('svg [aria-label="rule"] line').length

// --- All countries: the plain average of the countries (ADR-0020) ---

const POOLED_META = { pooled: 'average', countries: [1, 22] } as const

const pairPooled: PairResponse = {
  ...pairFixture,
  correlation: { ...pairFixture.correlation, n_countries: 2 },
  shares: {
    meta: { ...pairFixture.shares.meta, filters: {}, ...POOLED_META, countries: [1, 22] },
    rows: pairFixture.shares.rows.map((row) => ({ ...row, n_countries: 2 })),
  },
}

/** Pooled: LONELY was asked in one of the two countries only. */
const rankedPooled = testResponse(
  [
    { ...plainRow('LONELY', -0.48, undefined, 900), n_countries: 1 },
    { ...plainRow('ATTEND_SVCS', 0.28, undefined, 1800), n_countries: 2 },
  ],
  {
    outcome: 'HAPPY',
    stat: 'pearson_r',
    se_method: 'none',
    by: [],
    filters: {},
    adjusted: false,
    controls: [],
    model: null,
    min_n: 20,
    n_excluded: 0,
    dropped_overlap: {},
    ...POOLED_META,
    countries: [1, 22],
  },
)

const tablePooled: CorrelationsResponse = {
  ...tableFixture,
  meta: { ...tableFixture.meta, filters: {}, ...POOLED_META, countries: [1, 22] },
  pairs: tableFixture.pairs.map((pair) =>
    pair.correlation
      ? { ...pair, correlation: { ...pair.correlation, n_countries: pair.b === 'LONELY' ? 1 : 2 } }
      : pair,
  ),
}

const pooledPairRow = testResponse(
  [{ ...plainRow('INCOME_FEELINGS', 0.27, undefined, 120), n_countries: 2 }],
  {
    outcome: 'ATTEND_SVCS',
    stat: 'pearson_r',
    se_method: 'none',
    by: [],
    filters: {},
    min_n: 20,
    ...POOLED_META,
    countries: [1, 22],
  },
)

/** The pooled requests first: a route matches on its first needle. */
const pooledTier: Routes = {
  'pair?y=INCOME_FEELINGS&x=ATTEND_SVCS&wave=Y1&pooled=average': pairPooled,
  'outcome=HAPPY&wave=Y1&pooled=average': rankedPooled,
  'vars=ATTEND_SVCS&wave=Y1&pooled=average': tablePooled,
  'outcome=ATTEND_SVCS&wave=Y1&against=INCOME_FEELINGS&pooled=average': pooledPairRow,
  ...tier,
}

describe('All countries (ADR-0020)', () => {
  test('the Country select offers All countries first; chosen, Compare two averages every country', async () => {
    const calls = mockFetch(pooledTier)
    const router = await renderAt('/correlates?a=ATTEND_SVCS&b=INCOME_FEELINGS')
    await screen.findByRole('img', { name: /in United States: for each of 3 answers/ })
    const select = within(screen.getByRole('main')).getByLabelText('Country') as HTMLSelectElement
    expect(select.options[0]?.text).toBe('All countries')
    expect(select.value).toBe('22')
    fireEvent.change(select, { target: { value: 'all' } })
    await waitFor(() => expect(router.state.location.searchStr).toContain('country=all'))
    const figure = await screen.findByRole('img', {
      name: /, averaged over 2 countries: for each of 3 answers/,
    })
    const request = calls.filter((url) => url.includes('/v1/correlations/pair')).pop() as string
    expect(request).toContain('pooled=average')
    expect(request).not.toContain('filter=country_code')
    expect(screen.getByText('All countries (average of 2) · Wave 1, 2023')).toBeInTheDocument()
    // The toggle's first choice names the scope.
    expect(screen.getByLabelText('All countries')).toBeChecked()
    expect(figureNote(figure)).toBe(CORRELATES_NOTE)
    // The data table gains a Countries column.
    fireEvent.click(screen.getByText('Data table'))
    const data = screen.getAllByRole('table')[0] as HTMLElement
    expect(within(data).getByRole('columnheader', { name: 'Countries' })).toBeInTheDocument()
    // Back to one country: the URL drops the average.
    fireEvent.change(select, { target: { value: '22' } })
    await waitFor(() => expect(router.state.location.searchStr).not.toContain('country='))
  })

  test('Find related, All countries: the averaged list; a row asked in fewer countries says so', async () => {
    const calls = mockFetch(pooledTier)
    await renderAt('/correlates?view=related&outcome=HAPPY&country=all')
    const figure = await screen.findByRole('group', {
      name: /most strongly associated with it in all countries \(their average\)/,
    })
    expect(calls.some((url) => url.includes('outcome=HAPPY&wave=Y1&pooled=average'))).toBe(true)
    expect(
      screen.getByText('All countries (average of 2) · Wave 1, 2023 · correlation, −1 to 1'),
    ).toBeInTheDocument()
    const [lonely, attend] = within(figure).getAllByRole('button')
    fireEvent.focus(lonely as HTMLElement)
    expect(within(figure).getByRole('tooltip').textContent).toBe(
      '−0.48 · Loneliness\nAsked in 1 of 2 countries.',
    )
    fireEvent.blur(lonely as HTMLElement)
    fireEvent.focus(attend as HTMLElement)
    expect(within(figure).getByRole('tooltip').textContent).toBe('+0.28 · Service attendance')
  })

  test('Find related country by country, All countries: every country A–Z, none pinned', async () => {
    mockFetch(pooledTier)
    await renderAt('/correlates?view=related&outcome=HAPPY&country=all&scope=all')
    const matrix = await screen.findByRole('img', {
      name: /ranked for all countries \(their average\)/,
    })
    const headers = within(matrix).getAllByRole('columnheader')
    expect(headers.slice(1).map((th) => th.textContent)).toEqual(['Testland', 'United States'])
    expect(headers.some((th) => th.hasAttribute('data-highlight'))).toBe(false)
    expect(
      screen.getByText(
        'The 2 questions ranked for all countries, country by country · Wave 1, 2023 · correlation, −1 to 1',
      ),
    ).toBeInTheDocument()
  })

  test('Compare two country by country, All countries: nothing picked out; the strip reads the average', async () => {
    mockFetch(pooledTier)
    await renderAt('/correlates?a=ATTEND_SVCS&b=INCOME_FEELINGS&country=all&scope=all')
    const figure = await screen.findByRole('img', {
      name: /their correlation in each of 2 countries, strongest first, on a fixed scale from −1 to 1\. /,
    })
    expect(figure.innerHTML).not.toContain('var(--control-selected)')
    const strip = screen.getByText('Correlation', { selector: 'span' }).parentElement as HTMLElement
    expect(within(strip).getByText('+0.27')).toBeInTheDocument()
    expect(within(strip).getByText('All countries:')).toBeInTheDocument()
    expect(figure.querySelector('svg')?.textContent).toContain('All countries +0.27')
  })

  test('Compare several, All countries: the averaged table, coverage in the tooltips, a Countries column', async () => {
    mockFetch(pooledTier)
    await renderAt('/correlates?view=matrix&vars=HAPPY,LONELY,ATTEND_SVCS&country=all')
    const figure = await screen.findByRole('group', {
      name: /Correlations among 3 questions averaged over 2 countries/,
    })
    expect(
      screen.getByText('All countries (average of 2) · Wave 1, 2023 · correlation, −1 to 1'),
    ).toBeInTheDocument()
    const lonely = within(figure).getByRole('button', {
      name: 'Loneliness with Happiness, −0.52: see the two questions together',
    })
    fireEvent.focus(lonely)
    expect(within(figure).getByRole('tooltip').textContent).toBe(
      '−0.52 · Loneliness with Happiness\nAsked in 1 of 2 countries.',
    )
    fireEvent.blur(lonely)
    fireEvent.click(screen.getByText('Data table'))
    const data = screen.getAllByRole('table').at(-1) as HTMLElement
    expect(within(data).getByRole('columnheader', { name: 'Countries' })).toBeInTheDocument()
  })

  test('where an average over the countries stands, in words', () => {
    const countries = [
      ...testMeta.countries,
      { code: 25, name: 'China', iso3: 'CHN' },
      { code: 4, name: 'Egypt', iso3: 'EGY' },
      { code: 9, name: 'Japan', iso3: 'JPN' },
      { code: 23, name: 'Sweden', iso3: 'SWE' },
    ]
    const everyone = countries.map((country) => country.code)
    expect(pooledPlace(everyone, countries)).toBe('All countries (average of 6)')
    expect(pooledPlace(undefined, countries)).toBe('All countries (average of 6)')
    expect(pooledPlace([1, 22, 9, 23], countries)).toBe(
      'Average of 4 countries (not asked in China or Egypt)',
    )
    // More than three left out: the count alone.
    expect(pooledPlace([1, 22], countries)).toBe('Average of 2 countries')
    expect(pooledPlace([22], countries)).toBe('Average of 1 country')
    expect(averagedOver([1, 22, 9, 23], countries)).toBe('averaged over 4 countries')
    expect(coverageLine({ n_countries: 21 }, 23)).toBe('Asked in 21 of 23 countries.')
    expect(coverageLine({ n_countries: 23 }, 23)).toBeUndefined()
    expect(coverageLine({ n_countries: null }, 23)).toBeUndefined()
    expect(scopeLabel('All countries')).toBe('All countries')
    expect(scopeLabel('Japan')).toBe('In Japan')
  })
})

// --- Midyear: reachable, and paired with 2023 or 2024 (ADR-0020) ----------

const timeMediaVariable: VariableSummary = {
  ...attendVariable,
  name: 'TIME_MEDIA',
  display_name: 'Daily social media time',
  family: 'midyear',
  subfamily: null,
  waves_available: ['MY'],
  min: 1,
  max: 5,
}

const midyearTier: Routes = {
  ...tier,
  '/data/variables.json': {
    variables: [
      sfiVariable,
      happyVariable,
      attendVariable,
      lonelyVariable,
      urbanVariable,
      todayVariable,
      incomeVariable,
      timeMediaVariable,
    ],
  },
}

/** The row note at Midyear as a reader hears it: its inline choice of
 * year read as the year chosen, "[2023]". */
function noteSentence(): string {
  const select = screen.getByRole('combobox', {
    name: 'Year of the other answers',
  }) as HTMLSelectElement
  const note = select.closest('p') as HTMLElement
  const clone = note.cloneNode(true) as HTMLElement
  clone.querySelector('select')?.replaceWith(`[${select.value === 'Y2' ? '2024' : '2023'}]`)
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim()
}

describe('Midyear (ADR-0020)', () => {
  test('the Midyear chip is open; chosen, Compare two takes a midyear question beside 2023 answers', async () => {
    const calls = mockFetch(midyearTier)
    const router = await renderAt('/correlates')
    await screen.findByRole('img', { name: /Life evaluation today and Feelings about household/ })
    const wave = screen.getByRole('group', { name: 'Wave' })
    expect(within(wave).getByLabelText('Midyear')).toBeEnabled()
    expect(screen.queryByRole('combobox', { name: 'Year of the other answers' })).toBeNull()
    fireEvent.click(within(wave).getByText('Midyear', { exact: true }))
    await waitFor(() => expect(router.state.location.searchStr).toBe('?a=TIME_MEDIA&wave=MY'))
    expect(
      screen.getByText(
        'Daily social media time, from the midyear survey, took the place of Life evaluation today.',
      ),
    ).toHaveAttribute('role', 'status')
    // No second row of year buttons: the choice is in the note's sentence,
    // worded for the country on screen (every US midyear respondent
    // answered inside the Wave 2 interview).
    expect(screen.getByRole('combobox', { name: 'Year of the other answers' })).toHaveValue('Y1')
    expect(noteSentence()).toBe(
      'The other question uses the same people’s [2023] answers, given about 12 months earlier.',
    )
    await screen.findByRole('img', { name: /Daily social media time and Feelings about/ })
    const request = calls.filter((url) => url.includes('/v1/correlations/pair')).pop() as string
    expect(request).toContain('y=INCOME_FEELINGS&x=TIME_MEDIA&wave=MY')
    expect(request).toContain('other_wave=Y1')
    expect(
      screen.getByText('United States · Midyear survey, with 2023 answers from the same people'),
    ).toBeInTheDocument()
    // The other wave's question wears its year: on its trigger, its axis.
    expect(
      screen.getByRole('button', {
        name: 'Second question: Feelings about household income, 2023 answers',
      }),
    ).toHaveTextContent('2023')
    expect(
      screen.getByRole('button', { name: 'First question: Daily social media time' }),
    ).toBeVisible()
  })

  test('2024 answers: the note’s choice switches the request, the note and the subtitle', async () => {
    const calls = mockFetch(midyearTier)
    const router = await renderAt('/correlates?a=TIME_MEDIA&wave=MY')
    await screen.findByRole('img', { name: /Daily social media time and Feelings about/ })
    const other = screen.getByRole('combobox', { name: 'Year of the other answers' })
    fireEvent.change(other, { target: { value: 'Y2' } })
    await waitFor(() => expect(router.state.location.searchStr).toContain('other=Y2'))
    await waitFor(() =>
      expect(
        calls.some((url) => url.includes('/v1/correlations/pair') && url.includes('other_wave=Y2')),
      ).toBe(true),
    )
    expect(noteSentence()).toBe(
      'The other question uses the same people’s [2024] answers, from the same interview.',
    )
    expect(
      await screen.findByText(
        'United States · Midyear survey, with 2024 answers from the same people',
      ),
    ).toBeInTheDocument()
  })

  test('back to 2023 with a midyear question in view: the default takes its place, the line says so', async () => {
    mockFetch(midyearTier)
    const router = await renderAt('/correlates?a=TIME_MEDIA&wave=MY')
    await screen.findByRole('img', { name: /Daily social media time and Feelings about/ })
    const wave = screen.getByRole('group', { name: 'Wave' })
    fireEvent.click(within(wave).getByText('2023', { exact: true }))
    await waitFor(() => expect(router.state.location.searchStr).toBe(''))
    expect(
      screen.getByText(
        'Daily social media time was asked only in the midyear survey, so Life evaluation today took its place.',
      ),
    ).toBeInTheDocument()
  })

  test('picking a midyear question at 2023 switches to Midyear; the picker tags it', async () => {
    mockFetch(midyearTier)
    const router = await renderAt('/correlates?view=related&outcome=HAPPY')
    await screen.findByRole('group', { name: /most strongly associated with it/ })
    fireEvent.click(screen.getByRole('button', { name: 'Question: Happiness' }))
    const picker = screen.getByRole('dialog', { name: 'Question' })
    fireEvent.change(within(picker).getByRole('searchbox'), { target: { value: 'social' } })
    const option = within(picker).getByRole('option', { name: 'Daily social media time, Midyear' })
    expect(option).not.toHaveAttribute('aria-disabled')
    fireEvent.click(option)
    await waitFor(() =>
      expect(router.state.location.searchStr).toBe('?view=related&outcome=TIME_MEDIA&wave=MY'),
    )
    // Only what changed: the note under the row says whose answers and when.
    expect(
      screen.getByText(
        'Daily social media time is a midyear question, so the page switched to Midyear.',
      ),
    ).toBeInTheDocument()
  })

  test('Find related at Midyear ranks other waves’ questions; the note, not each row, names their year', async () => {
    const calls = mockFetch(midyearTier)
    await renderAt('/correlates?view=related&outcome=TIME_MEDIA&wave=MY')
    const figure = await screen.findByRole('group', { name: /most strongly associated with it/ })
    const request = calls.find((url) => url.includes('/v1/correlates')) as string
    expect(request).toContain('outcome=TIME_MEDIA&wave=MY')
    expect(request).toContain('other_wave=Y1')
    const svgText = figure.querySelector('svg')?.textContent ?? ''
    expect(svgText).toContain('Loneliness')
    expect(svgText).not.toContain('(2023)')
    expect(noteSentence()).toBe(
      'The other questions use the same people’s [2023] answers, given about 12 months earlier.',
    )
    expect(
      screen.getByText(
        'United States · Midyear survey, with 2023 answers from the same people · correlation, −1 to 1',
      ),
    ).toBeInTheDocument()
    // Its picker tags the others by their answers' year.
    fireEvent.click(screen.getByRole('button', { name: 'Question: Daily social media time' }))
    const picker = screen.getByRole('dialog', { name: 'Question' })
    fireEvent.change(within(picker).getByRole('searchbox'), { target: { value: 'lonel' } })
    expect(
      within(picker).getByRole('option', { name: 'Loneliness, 2023 answers' }),
    ).toBeInTheDocument()
  })

  test('a link to a midyear question at 2023 lands at Midyear', async () => {
    mockFetch(midyearTier)
    const router = await renderAt('/correlates?a=TIME_MEDIA')
    await waitFor(() => expect(router.state.location.searchStr).toBe('?a=TIME_MEDIA&wave=MY'))
  })
})

describe('Correlates view', () => {
  test('a first visit lands on Compare two with the default pair, one chart and no causes', async () => {
    const calls = mockFetch(tier)
    await renderAt('/correlates')
    await screen.findByRole('img', {
      name: /Life evaluation today and Feelings about household income in United States/,
    })
    const main = screen.getByRole('main')
    // The lede, the switcher right under it, the view's purpose in a line.
    expect(screen.getByText('See how answers to different questions go together.')).toBeVisible()
    const views = screen.getByRole('group', { name: 'View' })
    expect(
      within(views)
        .getAllByRole('radio')
        .map((radio) => radio.closest('label')?.textContent),
    ).toEqual(['Compare two', 'Compare several', 'Find related'])
    expect(within(views).getByLabelText('Compare two')).toBeChecked()
    expect(
      screen.getByText(
        'Pick two questions to see how people’s answers to one line up with their answers to the other.',
      ),
    ).toBeVisible()
    // The view's own pickers, named by their role; no page-level picker.
    expect(
      screen.getByRole('button', { name: 'First question: Life evaluation today' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Second question: Feelings about household income' }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Topic')).toBeNull()
    expect(screen.queryByLabelText('Measure')).toBeNull()
    expect(screen.queryByLabelText('Or search')).toBeNull()
    // The pair: the second question on the rows (the API's y), the first on the columns.
    const pair = calls.find((url) => url.includes('/v1/correlations/pair')) as string
    expect(pair).toContain('y=INCOME_FEELINGS&x=WB_TODAY&wave=Y1&filter=country_code%3A22')
    expect(calls.some((url) => url.includes('/v1/correlates'))).toBe(false)
    // No cause-and-effect reminder anywhere on the page.
    expect(visibleText(main)).not.toMatch(/cause|Associations, not/i)
    // The United States by default (found by its ISO code in meta).
    expect(within(main).getByLabelText('Country')).toHaveValue('22')
  })

  test('Find related: a ranked list of questions with no interval anywhere', async () => {
    const calls = mockFetch(tier)
    await renderAt('/correlates?view=related&outcome=HAPPY')
    const figure = await screen.findByRole('group', { name: /most strongly associated with it/ })
    expect(
      screen.getByText(
        'Pick one question to find the other questions whose answers rise or fall most closely with it, strongest first. Select any row to see the two side by side.',
      ),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Question: Happiness' })).toBeInTheDocument()
    // Rows are questions, named from the catalog, strongest first, signed.
    const svgText = figure.querySelector('svg')?.textContent ?? ''
    expect(svgText).toContain('Loneliness')
    expect(svgText).toContain('Service attendance')
    expect(svgText).toContain('−0.52')
    expect(svgText).toContain('+0.31')
    expect(svgText.indexOf('Loneliness')).toBeLessThan(svgText.indexOf('Service attendance'))
    // Signed hues, token-only; one rule (zero), no CI whiskers.
    expect(figure.innerHTML).toContain('var(--div-neg-mark)')
    expect(figure.innerHTML).toContain('var(--div-pos-mark)')
    expect(figure.innerHTML).not.toMatch(/#[0-9a-f]{6}/i)
    expect(ruleLines(figure)).toBe(1)
    expect(screen.getByText('What goes with Happiness')).toBeInTheDocument()
    expect(
      screen.getByText('United States · Wave 1, 2023 · correlation, −1 to 1'),
    ).toBeInTheDocument()
    const ticks = [...figure.querySelectorAll('[aria-label="x-axis tick label"] text')].map(
      (node) => node.textContent,
    )
    expect(ticks).toEqual(['−1', '−0.5', '0', '0.5', '1'])
    // The key and the axis ends say "a higher/lower" question.
    // "higher" and "lower" set apart: <em> in the key, bold italic
    // tspans in ink under the axis (so the PNG carries them).
    // (The key's words are one inline run: the <em> sits inside it.)
    const inKey = (words: string) =>
      screen.getByText(
        (_, node) =>
          node?.textContent === words &&
          node.querySelector('em') !== null &&
          !node.querySelector('span'),
      )
    expect(inKey('Goes with a higher Happiness').querySelector('em')).toHaveTextContent(/^higher$/)
    expect(inKey('Goes with a lower Happiness').querySelector('em')).toHaveTextContent(/^lower$/)
    expect(svgText).toContain('← goes with a lower Happiness')
    expect(svgText).toContain('goes with a higher Happiness →')
    const turns = [...figure.querySelectorAll('g[aria-description="axis end"] tspan[font-style]')]
    expect(turns.map((node) => node.textContent)).toEqual(['lower', 'higher'])
    for (const node of turns) {
      expect(node.getAttribute('font-style')).toBe('italic')
      expect(node.getAttribute('font-weight')).toBe('600')
      expect(node.getAttribute('fill')).toBe('var(--ink)')
    }
    // Every row is a real button (label and dot alike); its tooltip is
    // the value and the question — never the n.
    const rowButtons = within(figure).getAllByRole('button')
    expect(rowButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Loneliness, −0.52: see it beside Happiness',
      'Service attendance, +0.31: see it beside Happiness',
    ])
    fireEvent.focus(rowButtons[0] as HTMLElement)
    expect(within(figure).getByRole('tooltip')).toHaveTextContent(/^−0\.52 · Loneliness$/)
    fireEvent.blur(rowButtons[0] as HTMLElement)
    const text = visibleText(screen.getByRole('main'))
    // One note under the chart, and nothing else: no interval clause, no
    // Methods link, not how many went unranked (ADR-0020).
    expect(figureNote(figure)).toBe(CORRELATES_NOTE)
    expect(text).not.toContain('Dots are point estimates')
    expect(text).not.toMatch(/not ranked|respondents are/)
    expect(text).not.toContain('95%')
    expect(text).not.toMatch(/adjusted|accounting for|model card|standard deviation|cause/i)
    // One chart on screen: the matrix waits for its own scope.
    expect(screen.queryByRole('img', { name: /as a matrix/ })).toBeNull()
    const correlates = calls.filter((url) => url.includes('/v1/correlates'))
    expect(correlates).toHaveLength(1)
    expect(correlates[0]).toContain('outcome=HAPPY')
    expect(correlates[0]).toContain('filter=country_code%3A22')
    expect(correlates[0]).not.toContain('adjusted')
    expect(screen.getByLabelText('In United States')).toBeChecked()
    // The data table names the question and its n on every row.
    fireEvent.click(screen.getAllByText('Data table')[0] as HTMLElement)
    const data = screen.getAllByRole('table')[0] as HTMLElement
    // Plain headings and caption: "Question", "Correlation", and the
    // weighting in words — no weight code (review M6).
    expect(within(data).getByRole('columnheader', { name: 'Question' })).toBeInTheDocument()
    expect(within(data).getByRole('columnheader', { name: 'Correlation' })).toBeInTheDocument()
    expect(
      within(data).getByText('Weighted to each country’s adult population.'),
    ).toBeInTheDocument()
    expect(data.textContent).not.toContain('w_c1')
    expect(within(data).getByText('Loneliness')).toBeInTheDocument()
    expect(within(data).getAllByText('54').length).toBeGreaterThan(0)
  })

  test('Find related in every country: the ranked questions across countries, the chosen one pinned first', async () => {
    const calls = mockFetch(tier)
    const router = await renderAt('/correlates?view=related&outcome=HAPPY')
    await screen.findByRole('group', { name: /most strongly associated with it/ })
    fireEvent.click(screen.getByLabelText('Country by country'))
    await waitFor(() => expect(router.state.location.searchStr).toContain('scope=all'))
    const matrix = await screen.findByRole('img', { name: /as a matrix/ })
    // The ranked chart has left the page: one chart at a time.
    expect(screen.queryByRole('group', { name: /most strongly associated with it/ })).toBeNull()
    expect(screen.getByText('What goes with Happiness, country by country')).toBeInTheDocument()
    const table = within(matrix).getByRole('table')
    const headers = within(table).getAllByRole('columnheader')
    expect(headers.map((th) => th.textContent)).toEqual([
      'Question ↓ · country →',
      'United States',
      'Testland',
    ])
    expect(headers[1]).toHaveAttribute('data-highlight')
    // Every cell shows its value; the one few people are behind wears an
    // asterisk and a dashed outline, and its tooltip says so — no n.
    const cells = within(table).getAllByRole('cell')
    expect(cells.map((cell) => cell.textContent)).toEqual([
      '−0.40',
      '−0.52',
      '+0.05*, small sample size',
      '+0.31',
    ])
    expect(cells[2]).toHaveAttribute('data-flagged')
    expect(cells[2]?.getAttribute('style')).toContain('var(--div-')
    fireEvent.pointerEnter(cells[2] as HTMLElement)
    const tip = within(matrix).getByRole('tooltip').textContent ?? ''
    expect(tip).toContain('+0.05*')
    expect(tip).not.toMatch(/Few people|less reliable/)
    expect(tip).not.toMatch(/n =|people answered|Too few/)
    fireEvent.pointerLeave(cells[2] as HTMLElement)
    expect(within(matrix).getByText('* small sample size')).toBeInTheDocument()
    expect(figureNote(matrix)).toBe(CORRELATES_NOTE)
    // The legend's turning words, in <em>.
    const legendWords = within(matrix).getByText(
      (_, node) =>
        node?.tagName === 'SPAN' &&
        node.textContent ===
          'rust: goes with a lower Happiness · teal: goes with a higher Happiness',
    )
    expect([...legendWords.querySelectorAll('em')].map((node) => node.textContent)).toEqual([
      'lower',
      'higher',
    ])
    expect(within(matrix).queryByText(/— too few/)).toBeNull()
    const correlates = calls.filter((url) => url.includes('/v1/correlates'))
    expect(correlates).toHaveLength(2)
    expect(correlates[1]).toContain('against=LONELY&against=ATTEND_SVCS&by=country_code')
  })

  test('a cell with no estimate is a plain dash that says so — never an asterisk', async () => {
    const empty = { ...plainRow('ATTEND_SVCS', 0.05, 22, 0), estimate: null }
    mockFetch({
      ...tier,
      '&by=country_code': {
        ...acrossPlain,
        rows: [...acrossPlain.rows.slice(0, 3), empty],
      },
    })
    await renderAt('/correlates?view=related&outcome=HAPPY&scope=all')
    const matrix = await screen.findByRole('img', { name: /as a matrix/ })
    const cell = within(matrix).getAllByRole('cell')[2] as HTMLElement
    expect(cell).toHaveTextContent('—, no estimate')
    expect(cell).not.toHaveAttribute('data-flagged')
    fireEvent.pointerEnter(cell)
    expect(within(matrix).getByRole('tooltip')).toHaveTextContent(
      'No estimate: too few people answered both.',
    )
  })

  test('old links land on the right view: the ranked list, the matrix, the old pair', async () => {
    mockFetch(tier)
    await renderAt('/correlates?outcome=HAPPY&view=ranked')
    expect(
      await screen.findByRole('group', { name: /most strongly associated with it/ }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Find related')).toBeChecked()
    expect(screen.queryByText(/were invalid/)).toBeNull()
    await renderAt('/correlates?outcome=HAPPY&view=countries')
    expect(await screen.findByRole('img', { name: /as a matrix/ })).toBeInTheDocument()
    await renderAt('/correlates?outcome=HAPPY&view=pair&x=ATTEND_SVCS')
    expect(
      await screen.findByRole('img', { name: /Service attendance and Happiness in United States/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'First question: Service attendance' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Second question: Happiness' })).toBeVisible()
  })

  test('Compare two: a column-percent heat grid under bars of who gave each answer', async () => {
    const calls = mockFetch(tier)
    await renderAt('/correlates?a=ATTEND_SVCS&b=INCOME_FEELINGS')
    const figure = await screen.findByRole('img', {
      name: /Service attendance and Feelings about household income in United States: for each of 3 answers/,
    })
    // The rows' people on the columns' answers: the second on the rows.
    const pair = calls.find((url) => url.includes('/v1/correlations/pair')) as string
    expect(pair).toContain('y=INCOME_FEELINGS&x=ATTEND_SVCS&wave=Y1&filter=country_code%3A22')
    const caption = figure.closest('figure')?.querySelector('figcaption') as HTMLElement
    expect(
      within(caption).getByText('Service attendance and Feelings about household income'),
    ).toBeInTheDocument()
    expect(screen.getByText('United States · Wave 1, 2023')).toBeInTheDocument()
    // The header: the correlation strip alone. Where is chosen outside
    // the figure, under the shared control row, as in Find related.
    const strip = screen.getByText('Correlation', { selector: 'span' }).parentElement as HTMLElement
    expect(within(strip).getByText('+0.31')).toBeInTheDocument()
    expect(screen.getByLabelText('In United States')).toBeChecked()
    expect(screen.getByLabelText('Country by country')).not.toBeChecked()
    const where = screen.getByRole('group', { name: 'Where' })
    expect(figure.contains(where)).toBe(false)
    const shared = screen.getByRole('group', { name: 'Correlation type' })
    expect(shared.compareDocumentPosition(where) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The legend: how to read it, the fixed bins, and the asterisk.
    expect(screen.getByText('Share of each column (columns add to 100%)')).toBeInTheDocument()
    expect(screen.getByText('* small sample size')).toBeInTheDocument()
    // One SVG: the bars, the grid and every label (so the PNG carries them).
    const svgs = figure.querySelectorAll('svg')
    expect(svgs).toHaveLength(1)
    const svg = svgs[0] as SVGSVGElement
    // A wrapped label is one <text> of <tspan> lines: read it as words.
    const texts = [...svg.querySelectorAll('text')].map((node) => {
      const lines = [...node.querySelectorAll('tspan')].map((line) => line.textContent ?? '')
      return lines.length > 0 ? lines.join(' ') : (node.textContent ?? '')
    })
    // Columns left to right in aligned order; rows with the most at the top.
    const at = (label: string) => texts.findIndex((text) => text.includes(label))
    expect(at('Never')).toBeLessThan(at('Sometimes'))
    expect(at('Sometimes')).toBeLessThan(at('Weekly'))
    expect(at('Living comfortably')).toBeLessThan(at('Finding it very difficult'))
    expect(texts).toContain('Share of respondents who gave each answer to Service attendance')
    expect(texts).toContain('Feelings about household income')
    expect(texts).toContain('Service attendance')
    // Each bar's share, and each cell's share of its column — few people:
    // an asterisk. Every column adds to 100%.
    for (const label of ['30%', '40%', '50%', '15%*', '5%*', '10%*']) {
      expect(texts).toContain(label)
    }
    // Tints from the sequential ramp only, a flagged cell outlined in dashes.
    expect(svg.innerHTML).toContain('var(--seq-')
    expect(svg.innerHTML).toContain('stroke-dasharray="3,2"')
    expect(svg.innerHTML).not.toMatch(/#[0-9a-f]{6}/i)
    // One note, after the data table; no column explanation, no causes.
    const main = visibleText(screen.getByRole('main'))
    expect(figureNote(figure)).toBe(CORRELATES_NOTE)
    expect(main).not.toContain('Each column is the people')
    expect(main).not.toContain('Hover a cell for its 95% confidence interval')
    expect(main).not.toMatch(/cause/i)
    expect(screen.queryByRole('link', { name: 'How these numbers are made' })).toBeNull()
    // The screen-reader summary ends on the stars.
    expect(figure.getAttribute('aria-label')).toMatch(
      / \d+ cells are starred: small sample size\.$/,
    )
    // The data table names both questions' answers, with every n (its
    // second table: the grid, after the bars).
    fireEvent.click(screen.getByText('Data table'))
    const data = screen.getAllByRole('table')[1] as HTMLElement
    expect(
      within(data).getByRole('columnheader', { name: 'Service attendance' }),
    ).toBeInTheDocument()
    expect(
      within(data).getByRole('columnheader', { name: 'Feelings about household income' }),
    ).toBeInTheDocument()
    expect(within(data).getAllByText('Never').length).toBe(4)
    expect(within(data).getAllByText('Living comfortably on present income').length).toBe(3)
  })

  test('Compare two in every country: the pair’s correlation in each, the chosen one picked out', async () => {
    const calls = mockFetch(pooledTier)
    const router = await renderAt('/correlates?a=ATTEND_SVCS&b=INCOME_FEELINGS')
    await screen.findByRole('img', {
      name: /Service attendance and Feelings about household income in/,
    })
    fireEvent.click(screen.getByLabelText('Country by country'))
    await waitFor(() => expect(router.state.location.searchStr).toContain('scope=all'))
    const figure = await screen.findByRole('img', {
      name: /their correlation in each of 2 countries/,
    })
    // Only this chart: the grid has left.
    expect(screen.queryByText('Share of each column (columns add to 100%)')).toBeNull()
    expect(
      screen.getByText('Country by country · Wave 1, 2023 · correlation, −1 to 1'),
    ).toBeInTheDocument()
    const request = calls.find((url) => url.includes('by=country_code')) as string
    expect(request).toContain('outcome=ATTEND_SVCS&wave=Y1&against=INCOME_FEELINGS&by=country_code')
    // Strongest first; Testland rests on few people.
    const svgText = figure.querySelector('svg')?.textContent ?? ''
    expect(svgText.indexOf('United States')).toBeLessThan(svgText.indexOf('Testland'))
    expect(svgText).toContain('+0.12*')
    const ticks = [...figure.querySelectorAll('[aria-label="x-axis tick label"] text')].map(
      (node) => node.textContent,
    )
    expect(ticks).toEqual(['−1', '−0.5', '0', '0.5', '1'])
    expect(figure.innerHTML).toContain('var(--control-selected)')
    // The axis ends' turning words, set apart in the SVG itself.
    expect(
      [...figure.querySelectorAll('g[aria-description="axis end"] tspan[font-style="italic"]')].map(
        (node) => node.textContent,
      ),
    ).toEqual(['higher', 'lower', 'higher', 'higher'])
    // The All countries average as a labelled rule, whatever country is
    // chosen (the zero rule is the other).
    expect(ruleLines(figure)).toBe(2)
    expect(svgText).toContain('All countries +0.27')
    expect(figure.getAttribute('aria-label')).toContain(
      'A dashed line marks the All countries average, +0.27.',
    )
    // The strip still reads the chosen country's correlation, and names it.
    const strip = screen.getByText('Correlation', { selector: 'span' }).parentElement as HTMLElement
    expect(within(strip).getByText('+0.31')).toBeInTheDocument()
    expect(within(strip).getByText('United States:')).toBeInTheDocument()
  })

  test('Compare two country by country: a country that was not asked has no row', async () => {
    mockFetch({
      ...pooledTier,
      'against=INCOME_FEELINGS&by=country_code': {
        ...pairAcross,
        rows: pairAcross.rows.map((row) =>
          row.group['country_code'] === 1 ? { ...row, estimate: null, n: 0, sum_w: 0 } : row,
        ),
      },
    })
    await renderAt('/correlates?a=ATTEND_SVCS&b=INCOME_FEELINGS&scope=all')
    const figure = await screen.findByRole('img', {
      name: /their correlation in each of 1 countries/,
    })
    expect(figure.querySelector('svg')?.textContent ?? '').not.toContain('Testland')
  })

  test('Compare two: the data table below carries every number, as the summary says', async () => {
    mockFetch(tier)
    await renderAt('/correlates?a=ATTEND_SVCS&b=INCOME_FEELINGS')
    const figure = await screen.findByRole('img', {
      name: /The data table below carries every number\./,
    })
    const holder = figure.closest('figure') as HTMLElement
    fireEvent.click(within(holder).getByText('Data table'))
    const tables = within(holder).getAllByRole('table')
    const text = tables.map((table) => table.textContent ?? '').join(' ')
    // The bars, every cell and the correlation, each value as the table
    // prints it; the asterisks as a "Small sample" column.
    for (const column of pairFixture.columns)
      expect(text).toContain(formatEstimate(column.share, 'proportion'))
    for (const row of pairFixture.shares.rows)
      expect(text).toContain(formatEstimate(row.estimate, 'proportion'))
    expect(text).toContain(formatEstimate(pairFixture.correlation.estimate, 'pearson_r'))
    const headers = tables.map((table) =>
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    )
    expect(headers[0]).toContain('Share')
    expect(headers[1]).toContain('Share of column')
    expect(headers[2]).toContain('Correlation')
    for (const header of headers) expect(header).toContain('Small sample')
    const flagged = pairFixture.cells.filter((cell) => cell.flagged).length
    expect(within(tables[1] as HTMLElement).queryAllByText('Yes')).toHaveLength(flagged)
    // The weighting in words; no weight code.
    expect(text).toContain('Weighted to each country’s adult population.')
    expect(text).not.toMatch(/w_c1|Weighted estimates/)
  })

  test('Compare two: pick either question, and Swap exchanges the two', async () => {
    mockFetch(tier)
    const router = await renderAt('/correlates')
    await screen.findByRole('img', {
      name: /Life evaluation today and Feelings about household income/,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }))
    await waitFor(() => expect(router.state.location.searchStr).toBe('?a=INCOME_FEELINGS'))
    expect(
      await screen.findByRole('button', {
        name: 'First question: Feelings about household income',
      }),
    ).toBeInTheDocument()
    // The picker: the second question's panel, a question from its topic.
    fireEvent.click(screen.getByRole('button', { name: 'Second question: Life evaluation today' }))
    const dialog = screen.getByRole('dialog', { name: 'Second question' })
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'happi' } })
    fireEvent.click(within(dialog).getByRole('option', { name: 'Happiness' }))
    await waitFor(() => expect(router.state.location.searchStr).toBe('?a=INCOME_FEELINGS&b=HAPPY'))
  })

  test('Compare two says why when the two questions cannot be set side by side', async () => {
    mockFetch(tier)
    await renderAt('/correlates?a=URBAN_RURAL&b=HAPPY')
    expect(await screen.findByText(/is a set of categories with no order/)).toBeInTheDocument()
    await renderAt('/correlates?a=HAPPY&b=HAPPY')
    expect(await screen.findByText(/The two questions are the same one/)).toBeInTheDocument()
    // A score and its own question: said before asking, once its components are known.
    const calls = mockFetch({ ...tier, '/data/v1/sfi/variable.json': sfiDetail })
    await renderAt('/correlates?a=sfi&b=HAPPY')
    expect(
      await screen.findByText(
        /are built from the same answers, so they go together by construction/,
      ),
    ).toBeInTheDocument()
    expect(calls.some((url) => url.includes('/v1/correlations/pair?y=HAPPY&x=sfi'))).toBe(false)
  })

  test('a Find related row opens Compare two with the question first and the row second', async () => {
    mockFetch(tier)
    const router = await renderAt('/correlates?view=related&outcome=HAPPY')
    const figure = await screen.findByRole('group', { name: /most strongly associated with it/ })
    fireEvent.click(within(figure).getByRole('button', { name: /^Service attendance/ }))
    await waitFor(() => expect(router.state.location.searchStr).toBe('?a=HAPPY&b=ATTEND_SVCS'))
    expect(
      await screen.findByRole('img', { name: /Happiness and Service attendance in/ }),
    ).toBeInTheDocument()
  })

  test('state carries across views: Find related’s question seeds Compare two, and back', async () => {
    mockFetch(tier)
    const router = await renderAt('/correlates?a=HAPPY&b=LONELY')
    await screen.findByRole('img', { name: /Happiness and Loneliness in/ })
    fireEvent.click(screen.getByLabelText('Find related'))
    await waitFor(() =>
      expect(router.state.location.searchStr).toBe('?view=related&b=LONELY&outcome=HAPPY'),
    )
    expect(
      await screen.findByRole('group', { name: /Happiness: the 2 questions most strongly/ }),
    ).toBeInTheDocument()
    // A new question here becomes Compare two's first.
    fireEvent.click(screen.getByRole('button', { name: 'Question: Happiness' }))
    const dialog = screen.getByRole('dialog', { name: 'Question' })
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'attend' } })
    fireEvent.click(within(dialog).getByRole('option', { name: 'Service attendance' }))
    await waitFor(() => expect(router.state.location.searchStr).toContain('outcome=ATTEND_SVCS'))
    fireEvent.click(screen.getByLabelText('Compare two'))
    await waitFor(() => expect(router.state.location.searchStr).toBe('?a=ATTEND_SVCS&b=LONELY'))
  })

  test('the ranking’s overlap is not spelled out under the chart', async () => {
    mockFetch({
      ...tier,
      'filter=country_code%3A22': {
        ...rankedPlain,
        meta: { ...rankedPlain.meta, dropped_overlap: { HAPPY_ITEM: 'sfi', LONELY_ITEM: 'sfi' } },
      },
    })
    await renderAt('/correlates?view=related&outcome=HAPPY')
    const figure = await screen.findByRole('group', { name: /most strongly associated with it/ })
    expect(figureNote(figure)).toBe(CORRELATES_NOTE)
    expect(screen.queryByText(/are left out/)).toBeNull()
  })

  test('Compare several starts from the pair and the first question’s top correlates', async () => {
    const calls = mockFetch(tier)
    const router = await renderAt('/correlates?view=matrix&a=HAPPY&b=sfi')
    await screen.findByRole('group', { name: /Correlations among 4 questions/ })
    expect(
      screen.getByText('Pick up to 10 questions to see how strongly each pair goes together.'),
    ).toBeVisible()
    const ranked = calls.find((url) => url.includes('/v1/correlates')) as string
    expect(ranked).toContain('outcome=HAPPY')
    const request = calls.find((url) => url.includes('/v1/correlations?')) as string
    expect(request).toContain('vars=HAPPY&vars=sfi&vars=LONELY&vars=ATTEND_SVCS&wave=Y1')
    expect(router.state.location.searchStr).not.toContain('vars=')
  })

  test('Compare several: a lower triangle by short names, no empty row or column, on a fixed scale', async () => {
    mockFetch(tier)
    const router = await renderAt('/correlates?view=matrix&vars=HAPPY,LONELY,ATTEND_SVCS')
    const figure = await screen.findByRole('group', { name: /Correlations among 3 questions/ })
    // The set builder: n of 10, a chip per question, "+ Add questions" last.
    const chips = screen.getByRole('list', { name: 'Questions in the table · 3 of 10' })
    expect(
      within(chips)
        .getAllByRole('button', { name: /^Remove / })
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Remove Happiness', 'Remove Loneliness', 'Remove Service attendance'])
    expect(within(chips).getByRole('button', { name: 'Add questions' })).toBeEnabled()
    expect(screen.queryByText(/Start from/)).toBeNull()
    const table = within(figure).getByRole('table')
    // Rows are the questions from the second on; columns up to the last
    // but one — by short name, with no numbers at six questions or fewer;
    // headings horizontal, over an empty, unshaded corner (review M7).
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((th) => th.textContent),
    ).toEqual(['Loneliness', 'Service attendance'])
    const headers = within(table).getAllByRole('columnheader')
    expect(headers.map((th) => th.textContent)).toEqual(['Happiness', 'Loneliness'])
    expect(table.textContent).not.toMatch(/Question ↓|with →/)
    const cells = within(table).getAllByRole('cell')
    expect(cells.map((cell) => cell.textContent)).toEqual([
      '−0.52',
      '',
      '·, built from the same answers',
      '+0.20*, small sample size',
    ])
    // The tint is on a fixed −1 to 1: −0.52 is the middle rust step, not the deepest.
    expect(cells[0]?.getAttribute('style')).toContain('var(--div-n3)')
    // One line of legend: the ramp's ends, the asterisk, the dot — no numbers of questions.
    const legend = figure.querySelector('[class*=legendRow]') as HTMLElement
    expect(legend.textContent).toBe('−1+1* small sample size· built from the same answers')
    // The tooltip: the value (starred when flagged), the row with the column.
    const lonely = within(table).getByRole('button', {
      name: 'Loneliness with Happiness, −0.52: see the two questions together',
    })
    fireEvent.focus(lonely)
    expect(within(figure).getByRole('tooltip')).toHaveTextContent(
      /^−0\.52 · Loneliness with Happiness$/,
    )
    fireEvent.blur(lonely)
    const flagged = within(table).getByRole('button', { name: /\+0\.20, small sample size/ })
    fireEvent.focus(flagged)
    expect(within(figure).getByRole('tooltip').textContent).toMatch(/^\+0\.20\* · /)
    fireEvent.blur(flagged)
    expect(figureNote(figure)).toBe(CORRELATES_NOTE)
    expect(screen.getByText('Select a cell to see the two questions together.')).toBeVisible()
    // A cell opens Compare two: the column first, the row second.
    fireEvent.click(lonely)
    await waitFor(() =>
      expect(router.state.location.searchStr).toBe(
        '?a=HAPPY&b=LONELY&vars=HAPPY%2CLONELY%2CATTEND_SVCS',
      ),
    )
  })

  test('on a phone the shared row folds into one line; Change opens it in place', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('40rem'),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }))
    mockFetch(tier)
    await renderAt('/correlates')
    await screen.findByRole('img', { name: /Life evaluation today and Feelings about household/ })
    expect(screen.getByText('2023 · United States · Straight-line')).toBeVisible()
    expect(screen.queryByRole('group', { name: 'Wave' })).toBeNull()
    const change = screen.getByRole('button', { name: 'Change wave, country and correlation type' })
    expect(change).toHaveTextContent('Change')
    expect(change).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(change)
    expect(screen.getByRole('group', { name: 'Wave' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Correlation type' })).toBeInTheDocument()
    const done = screen.getByRole('button', { name: 'Done changing' })
    expect(done).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(done)
    expect(screen.queryByRole('group', { name: 'Wave' })).toBeNull()
  })

  test('Compare several on a phone (or past six questions): numbered columns, the same numbers before the rows', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('40rem'),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }))
    mockFetch(tier)
    await renderAt('/correlates?view=matrix&vars=HAPPY,LONELY,ATTEND_SVCS')
    const figure = await screen.findByRole('group', { name: /Correlations among 3 questions/ })
    const table = within(figure).getByRole('table')
    const headers = within(table).getAllByRole('columnheader')
    expect(headers.map((th) => th.textContent)).toEqual(['1', '2'])
    // A numbered heading's full name is its accessible name.
    expect(headers[0]).toHaveAttribute('aria-label', 'Happiness')
    // Every question has a row, so every number has its name.
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((th) => th.textContent),
    ).toEqual(['1. Happiness', '2. Loneliness', '3. Service attendance'])
  })

  test('a heading wraps to three lines at most: the column widens until it does', () => {
    const measure = (text: string) => text.length * 7
    expect(headingColumnWidth(['Happiness'], measure)).toBe(60)
    const long = ['Feelings about household income', 'Religious service attendance']
    const width = headingColumnWidth(long, measure)
    expect(width).toBeGreaterThan(60)
    for (const label of long)
      expect(
        wrapLabel(label, width - 2 * HEAT_CELL_PAD, measure, Infinity).length,
      ).toBeLessThanOrEqual(3)
    // Never past the cap: a longer heading takes more lines instead.
    expect(headingColumnWidth(['word '.repeat(60)], measure)).toBe(150)
  })

  test('Compare several: similar together is the server’s order; the page only reorders', async () => {
    mockFetch(tier)
    const router = await renderAt('/correlates?view=matrix&vars=HAPPY,LONELY,ATTEND_SVCS')
    const figure = await screen.findByRole('group', { name: /Correlations among 3 questions/ })
    expect(screen.getByLabelText('As added')).toBeChecked()
    fireEvent.click(screen.getByLabelText('Similar together'))
    await waitFor(() => expect(router.state.location.searchStr).toContain('order=similar'))
    const table = within(figure).getByRole('table')
    await waitFor(() =>
      expect(
        within(table)
          .getAllByRole('columnheader')
          .map((th) => th.textContent),
      ).toEqual(['Loneliness', 'Happiness']),
    )
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((th) => th.textContent),
    ).toEqual(['Happiness', 'Service attendance'])
    // The chips keep the order added.
    expect(
      within(screen.getByRole('list', { name: /Questions in the table/ }))
        .getAllByRole('button', { name: /^Remove / })
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Remove Happiness', 'Remove Loneliness', 'Remove Service attendance'])
  })

  test('Compare several: add with the multi-select picker, remove, reorder by keyboard and by drag', async () => {
    mockFetch(tier)
    const router = await renderAt('/correlates?view=matrix&vars=HAPPY,LONELY,ATTEND_SVCS')
    await screen.findByRole('group', { name: /Correlations among 3 questions/ })
    fireEvent.click(screen.getByRole('button', { name: 'Add questions' }))
    const dialog = screen.getByRole('dialog', { name: 'Add questions' })
    // Questions already in the table: ticked, disabled, said so.
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'happi' } })
    expect(within(dialog).getByRole('option', { name: 'Happiness, In the table' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'secure' } })
    fireEvent.click(within(dialog).getByRole('option', { name: 'Secure Flourishing Index' }))
    expect(within(dialog).getByText('1 selected · room for 6 more')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add 1 to the table' }))
    await waitFor(() =>
      expect(router.state.location.searchStr).toContain('vars=HAPPY%2CLONELY%2CATTEND_SVCS%2Csfi'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove Loneliness' }))
    await waitFor(() =>
      expect(router.state.location.searchStr).toContain('vars=HAPPY%2CATTEND_SVCS%2Csfi'),
    )
    // Alt+↑ moves a question earlier, and says where it went.
    const handle = screen.getByRole('button', { name: 'Move Service attendance' })
    handle.focus()
    fireEvent.keyDown(handle, { key: 'ArrowUp', altKey: true })
    await waitFor(() =>
      expect(router.state.location.searchStr).toContain('vars=ATTEND_SVCS%2CHAPPY%2Csfi'),
    )
    expect(screen.getByText('Service attendance moved to position 1 of 3.')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Move Service attendance' })).toHaveFocus(),
    )
    // An arrow without Alt moves nothing.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Happiness' }), { key: 'ArrowUp' })
    expect(router.state.location.searchStr).toContain('vars=ATTEND_SVCS%2CHAPPY%2Csfi')
    // Drag the last chip onto the first.
    const items = within(screen.getByRole('list', { name: /Questions in the table/ })).getAllByRole(
      'listitem',
    )
    const transfer = { setData: vi.fn(), effectAllowed: '' }
    fireEvent.dragStart(items[2] as HTMLElement, { dataTransfer: transfer })
    fireEvent.dragOver(items[0] as HTMLElement, { dataTransfer: transfer })
    fireEvent.drop(items[0] as HTMLElement, { dataTransfer: transfer })
    await waitFor(() =>
      expect(router.state.location.searchStr).toContain('vars=sfi%2CATTEND_SVCS%2CHAPPY'),
    )
    // At two, nothing more can go; at ten, nothing more can come.
    await renderAt('/correlates?view=matrix&vars=HAPPY,LONELY')
    const pairOnly = await screen.findByRole('list', { name: 'Questions in the table · 2 of 10' })
    const removers = within(pairOnly).getAllByRole('button', { name: /^Remove / })
    expect(removers.every((button) => (button as HTMLButtonElement).disabled)).toBe(true)
    const ten = ['HAPPY', 'LONELY', 'ATTEND_SVCS', 'sfi', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6']
    mockFetch({
      ...tier,
      '/data/variables.json': {
        variables: [
          sfiVariable,
          happyVariable,
          attendVariable,
          lonelyVariable,
          ...ten.slice(4).map((name) => ({ ...happyVariable, name, display_name: `Q ${name}` })),
        ],
      },
    })
    await renderAt(`/correlates?view=matrix&vars=${ten.join(',')}`)
    await screen.findByRole('list', { name: 'Questions in the table · 10 of 10' })
    const adds = screen.getAllByRole('button', { name: 'Add questions' })
    expect(adds[adds.length - 1]).toBeDisabled()
  })

  test('Compare several: a linked question not asked at the wave is left out, and named', async () => {
    mockFetch(tier)
    // LONELY is asked at Y1 only.
    await renderAt('/correlates?wave=Y2&view=matrix&vars=HAPPY,LONELY,ATTEND_SVCS')
    expect(
      await screen.findByText('Left out, not asked in Wave 2, 2024: Loneliness.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('list', { name: 'Questions in the table · 2 of 10' }),
    ).toBeInTheDocument()
  })

  test('an old link asking for the adjusted model gets the usual notice, and never sends it', async () => {
    const calls = mockFetch(tier)
    await renderAt('/correlates?view=related&outcome=HAPPY&adjusted=true')
    expect(
      await screen.findByText(/invalid and were reset to defaults: adjusted/),
    ).toBeInTheDocument()
    const figure = await screen.findByRole('group', { name: /most strongly associated with it/ })
    expect(ruleLines(figure)).toBe(1) // the zero rule; no whiskers
    const correlates = calls.filter((url) => url.includes('/v1/correlates'))
    expect(correlates.length).toBeGreaterThan(0)
    expect(correlates.every((url) => !url.includes('adjusted'))).toBe(true)
  })

  test('one shared row: Wave · Country · Correlation type, and the wave’s reason under it all', async () => {
    const calls = mockFetch(tier)
    const router = await renderAt('/correlates?a=HAPPY&b=LONELY')
    await screen.findByRole('img', { name: /Happiness and Loneliness in/ })
    const wave = screen.getByRole('group', { name: 'Wave' })
    const type = screen.getByRole('group', { name: 'Correlation type' })
    expect(within(type).getByLabelText('Straight-line')).toBeChecked()
    expect(screen.queryByRole('button', { name: /^Method/ })).toBeNull()
    // The reason a wave is unavailable is one line under the whole row,
    // not inside the Wave column; the disabled options point to it.
    // (Midyear is never unavailable: its questions come from any wave.)
    const note = screen.getByText(
      "2024 isn't available: the two questions weren't both asked in Wave 2.",
    )
    expect(wave).not.toContainElement(note)
    expect(note.previousElementSibling).toContainElement(type)
    expect(within(wave).getByLabelText('2024')).toHaveAccessibleDescription(note.textContent ?? '')
    expect(within(wave).getByLabelText('2023')).not.toHaveAccessibleDescription()
    // "What's the difference?" opens a note in plain words; Escape closes it.
    const info = screen.getByRole('button', { name: 'What’s the difference?' })
    expect(info).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(info)
    // Four short paragraphs, each method named in bold.
    const panel = document.getElementById(info.getAttribute('aria-controls') ?? '') as HTMLElement
    expect(panel).toBeVisible()
    expect(panel).toHaveAttribute('data-variant', 'info')
    const paragraphs = [...panel.querySelectorAll('p')].map((p) => p.textContent)
    expect(paragraphs).toHaveLength(4)
    expect(paragraphs[0]).toMatch(/^Both numbers run from −1 to 1\. Near 0/)
    expect(paragraphs[1]).toMatch(/^Straight-line \(Pearson\) treats answers as numbers/)
    expect(paragraphs[2]).toMatch(/^By rank \(Spearman\) puts people in order/)
    expect(paragraphs[3]).toMatch(/are pulling Straight-line\.$/)
    expect([...panel.querySelectorAll('strong')].map((b) => b.textContent)).toEqual([
      'Straight-line (Pearson)',
      'By rank (Spearman)',
      'Straight-line',
    ])
    fireEvent.keyDown(info, { key: 'Escape' })
    expect(info).toHaveAttribute('aria-expanded', 'false')
    expect(info).toHaveFocus()
    // By rank: asked for and kept in the URL.
    fireEvent.click(within(type).getByLabelText('By rank'))
    await waitFor(() => expect(router.state.location.searchStr).toContain('method=spearman'))
    await waitFor(() => expect(calls.some((url) => url.includes('method=spearman'))).toBe(true))
    fireEvent.click(within(type).getByLabelText('Straight-line'))
    await waitFor(() => expect(router.state.location.searchStr).not.toContain('method='))
  })

  test('countries run A–Z by name in the select and across the matrix', async () => {
    mockFetch({
      ...tier,
      '/data/meta.json': {
        ...testMeta,
        countries: [...testMeta.countries, { code: 5, name: 'Albania', iso3: 'ALB' }],
      },
    })
    await renderAt('/correlates?view=related&outcome=HAPPY&scope=all')
    const matrix = await screen.findByRole('img', { name: /as a matrix/ })
    const select = within(screen.getByRole('main')).getByLabelText('Country') as HTMLSelectElement
    // Every country pooled first, then each A–Z.
    expect([...select.options].map((option) => option.text)).toEqual([
      'All countries',
      'Albania',
      'Testland',
      'United States',
    ])
    expect(
      within(matrix)
        .getAllByRole('columnheader')
        .slice(1)
        .map((th) => th.textContent),
    ).toEqual(['United States', 'Albania', 'Testland'])
  })

  test('the model cards are retired: an old link lands on the not-found page', async () => {
    mockFetch(tier)
    await renderAt('/model-cards#continuous')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.queryByText(/Model card/)).toBeNull()
  })

  test('a question with no order says so instead of asking the API', async () => {
    const calls = mockFetch(tier)
    await renderAt('/correlates?view=related&outcome=URBAN_RURAL')
    expect(await screen.findByText(/a set of categories with no order/)).toBeInTheDocument()
    expect(calls.some((url) => url.includes('/v1/correlates'))).toBe(false)
  })

  test('a wave the questions were not asked in is unavailable, and the line under the row says why — never Midyear', async () => {
    mockFetch(tier)
    // Compare two: the pair's waves; Midyear stays open (ADR-0020).
    await renderAt('/correlates?a=HAPPY&b=LONELY')
    await screen.findByRole('img', { name: /Happiness and Loneliness in/ })
    const wave = screen.getByRole('group', { name: 'Wave' })
    expect(within(wave).getByLabelText('Midyear')).toBeEnabled()
    expect(within(wave).getByLabelText('2024')).toBeDisabled()
    expect(within(wave).getByLabelText('2024')).toHaveAccessibleDescription(
      "2024 isn't available: the two questions weren't both asked in Wave 2.",
    )
    // A link at Midyear with no midyear question in view shows the other
    // answers' wave instead, and says so.
    const router = await renderAt('/correlates?view=related&outcome=HAPPY&wave=MY')
    await waitFor(() => expect(router.state.location.searchStr).not.toContain('wave='))
    expect(
      await screen.findByText('No midyear question is left, so the page switched to 2023.'),
    ).toBeInTheDocument()
  })

  test('choosing a country changes the request; the default country never reaches the URL', async () => {
    const calls = mockFetch({
      ...tier,
      'filter=country_code%3A1': {
        ...rankedPlain,
        meta: { ...rankedPlain.meta, filters: { country_code: [1] } },
      },
    })
    const router = await renderAt('/correlates?view=related&outcome=HAPPY')
    await screen.findByRole('group', { name: /most strongly associated with it/ })
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: '1' } })
    await waitFor(() =>
      expect(calls.some((url) => url.includes('filter=country_code%3A1'))).toBe(true),
    )
    expect(router.state.location.searchStr).toContain('country=1')
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: '22' } })
    await waitFor(() => expect(router.state.location.searchStr).not.toContain('country='))
  })
})

describe('correlates helpers', () => {
  test('the diverging tint is quantized onto the eleven ramp tokens, never a resolved color', () => {
    expect(divergingTint(null)).toBe('transparent')
    expect(divergingTint(-1)).toBe(DIVERGING_RAMP[0])
    expect(divergingTint(0)).toBe(DIVERGING_RAMP[5])
    expect(divergingTint(1)).toBe(DIVERGING_RAMP[10])
    expect(divergingTint(0.4)).toBe('var(--div-p2)')
    expect(divergingTint(-2)).toBe('var(--div-n5)') // clamped
    expect(divergingTint(1.5, 3)).toBe('var(--div-p3)') // scaled to the extent
    expect(DIVERGING_RAMP).toHaveLength(11)
    expect(signMark(-0.1)).toBe('var(--div-neg-mark)')
    expect(signMark(0.1)).toBe('var(--div-pos-mark)')
    expect(signMark(null)).toBe('var(--div-pos-mark)')
    // A value that shows as 0.00 has no sign on the page: neutral ink.
    expect(signMark(0.004)).toBe('var(--ink-secondary)')
    expect(signMark(-0.004)).toBe('var(--ink-secondary)')
    expect(signMark(0)).toBe('var(--ink-secondary)')
    expect(signMark(-0.005)).toBe('var(--div-neg-mark)')
    expect(formatEstimate(-0.004, 'pearson_r')).toBe('0.00')
  })

  test('predictor order, the cell lookup, countries by name', () => {
    expect(predictorOrder(acrossPlain.rows)).toEqual(['LONELY', 'ATTEND_SVCS'])
    expect(heatCells(acrossPlain.rows).get('LONELY:22')?.estimate).toBe(-0.4)
    expect(
      countriesByName([
        { code: 22, name: 'United States', iso3: 'USA' },
        { code: 30, name: 'China', iso3: 'CHN' },
        { code: 2, name: 'Sweden', iso3: 'SWE' },
      ]).map((country) => country.name),
    ).toEqual(['China', 'Sweden', 'United States'])
    // The United States by its ISO code; the first country without one.
    expect(defaultCountry(testMeta)).toBe(22)
    expect(defaultCountry({ countries: [{ code: 3, name: 'Elsewhere', iso3: 'ELS' }] })).toBe(3)
  })

  test('the legend and subtitle say the window in words', () => {
    expect(legendEnds(0.52, 'pearson_r')).toEqual(['−0.52', '+0.52'])
    expect(acrossSubtitle(20, 'Japan', 'Y2')).toBe(
      'The 20 questions ranked for Japan, country by country · Wave 2, 2024 · correlation, −1 to 1',
    )
    expect(acrossSubtitle(1, 'Japan', 'Y1')).toContain('The 1 question ranked for Japan')
    const countries = [
      { code: 22, name: 'United States', iso3: 'USA' },
      { code: 30, name: 'China', iso3: 'CHN' },
      { code: 2, name: 'Sweden', iso3: 'SWE' },
    ]
    expect(pinnedFirst(countries, 2).map((country) => country.name)).toEqual([
      'Sweden',
      'China',
      'United States',
    ])
    expect(pinnedFirst(countries, undefined).map((country) => country.name)).toEqual([
      'China',
      'Sweden',
      'United States',
    ])
    // A short name only when the catalog serves one; the display name otherwise.
    expect(shortName(happyVariable)).toBe('Happiness')
    expect(shortName({ ...happyVariable, short_label: 'SFI' })).toBe('SFI')
    expect(shortName({ ...happyVariable, short_label: ' ' })).toBe('Happiness')
  })

  test('the ranking floor: cells below it are known', () => {
    expect(belowFloor({ n: 7 }, 100)).toBe(true)
    expect(belowFloor({ n: 100 }, 100)).toBe(false)
    expect(belowFloor({ n: 7 }, null)).toBe(false)
    // An asterisk only on a value: a cell with no estimate says so instead.
    expect(fewPeople({ estimate: 0.1, n: 7, flagged: false }, 100)).toBe(true)
    expect(fewPeople({ estimate: null, n: 7, flagged: false }, 100)).toBe(false)
    expect(fewPeople({ estimate: 0.1, n: 700, flagged: false }, 100)).toBe(false)
    // An average: starred when the server flags every country in it
    // below the floor, whatever the countries' total (ADR-0020).
    expect(fewPeople({ estimate: 0.1, n: 700, flagged: true }, 100)).toBe(true)
    // Columns past the visible edge of the matrix, for the "N more" hint.
    expect(columnsPastEdge([100, 200, 300, 400], 250)).toBe(2)
    expect(columnsPastEdge([100, 200], 250)).toBe(0)
  })

  test('plain words for the method and the waves', () => {
    expect(statisticPhrase(undefined)).toBe('correlation, −1 to 1')
    expect(statisticPhrase('spearman')).toBe('correlation by rank, −1 to 1')
    expect(rankedSubtitle('Japan', undefined, 'Y2')).toBe(
      'Japan · Wave 2, 2024 · correlation, −1 to 1',
    )
    expect(axisEnds('Happiness')).toEqual([
      '← goes with a lower Happiness',
      'goes with a higher Happiness →',
    ])
    // No tooltip carries an n (ADR-0016, restored by ADR-0019); a
    // correlation few people are behind keeps its asterisk, and no more.
    expect(rankedTip({ estimate: 0.412, stat: 'pearson_r' }, 'Gratitude')).toBe('+0.41 · Gratitude')
    expect(rankedTip({ estimate: 0.412, stat: 'pearson_r' }, 'Gratitude', true)).toBe(
      '+0.41* · Gratitude',
    )
    expect(starred('+0.41', true)).toBe('+0.41*')
    expect(starred('+0.41', false)).toBe('+0.41')
    // Why a wave is unavailable, from the waves the measure was asked in.
    expect(waveNote(['Y1', 'Y2'])).toBe(
      "Midyear isn't available: this question wasn't asked in the midyear survey.",
    )
    expect(waveNote(['Y1', 'MY'])).toBe(
      "2024 isn't available: this question wasn't asked in Wave 2.",
    )
    expect(waveNote(['MY'])).toBe(
      "2023 and 2024 aren't available: this question was asked only in the midyear survey.",
    )
    expect(waveNote(['Y1'])).toBe(
      "Midyear and 2024 aren't available: this question was asked only in Wave 1.",
    )
    expect(waveNote(['Y1', 'MY', 'Y2'])).toBeUndefined()
    expect(waveNote([])).toBeUndefined()
    // For a pair, and for a table (a wave opens with two questions asked).
    expect(waveNote(['Y1', 'Y2'], 'pair')).toBe(
      "Midyear isn't available: the two questions weren't both asked in the midyear survey.",
    )
    expect(waveNote(['Y1'], 'table')).toBe(
      "Midyear and 2024 aren't available: fewer than two of these questions were asked in the midyear survey and Wave 2.",
    )
  })

  test('Compare two in words: axis titles, tooltips without n, fixed tint bins', () => {
    const todayDetail: VariableDetail = {
      ...happyDetail,
      value_labels: [
        { code: 0, label: 'Worst possible', wave: null, country_code: null, is_nonresponse: false },
        { code: 5, label: '', wave: null, country_code: null, is_nonresponse: false },
        { code: 10, label: 'Best possible', wave: null, country_code: null, is_nonresponse: false },
        { code: 99, label: '(Refused)', wave: null, country_code: null, is_nonresponse: true },
      ],
    }
    // A numbered axis names its ends; an axis of words needs none.
    expect(pairAxisTitle(todayVariable, todayDetail)).toBe(
      'Life evaluation today · 0 = Worst possible, 10 = Best possible',
    )
    const feelingsDetail: VariableDetail = {
      ...happyDetail,
      ...incomeVariable,
      value_labels: FEELINGS.map((row) => ({
        code: row.code,
        label: row.label,
        wave: null,
        country_code: null,
        is_nonresponse: false,
      })),
    }
    expect(pairAxisTitle(incomeVariable, feelingsDetail)).toBe('Feelings about household income')
    expect(pairAxisTitle(sfiVariable, todayDetail)).toBe('Secure Flourishing Index')
    // Tooltips in plain words (review M2): three lines, no asterisk, no n.
    expect(likelyRange(0.438, 0.864)).toBe('Likely range: 44%–86%')
    expect(likelyRange(-0.004, 0.021)).toBe('Likely range: 0%–2%')
    expect(likelyRange(null, 0.5)).toBeUndefined()
    const tip = {
      aLevel: '0',
      aShort: 'Life evaluation today',
      bLevel: 'Finding it very difficult on present income',
      share: 0.65,
      range: likelyRange(0.438, 0.864),
    }
    expect(pairCellTip(tip)).toBe(
      'Life evaluation today: 0\n65% — Finding it very difficult on present income\nLikely range: 44%–86%',
    )
    expect(pairCellTip({ ...tip, share: 0.004, range: undefined })).toBe(
      'Life evaluation today: 0\n<1% — Finding it very difficult on present income',
    )
    expect(pairCellTip({ ...tip, share: null })).toBe(
      'Life evaluation today: 0\nNobody here gave this answer.',
    )
    expect(
      pairBarTip({
        level: '8',
        short: 'Life evaluation today',
        share: 0.25,
        range: likelyRange(0.2474, 0.2561),
      }),
    ).toBe('Life evaluation today: 8\n25% of people\nLikely range: 25%–26%')
    // Shares: whole percents, "<1%" for a sliver, never "0%" above zero.
    expect(shareLabel(0.57)).toBe('57%')
    expect(shareLabel(0.004)).toBe('<1%')
    expect(shareLabel(0)).toBe('0%')
    // A narrow column leaves the "%" to the key.
    expect(shareLabel(0.57, false)).toBe('57')
    expect(shareLabel(0.004, false)).toBe('<1')
    // Fixed bins at 0/5/10/20/30/45/60/75/90%, onto the nine ramp tokens:
    // they reach the top.
    expect([0, 0.049, 0.05, 0.1, 0.2, 0.3, 0.45, 0.6, 0.75, 0.9, 1].map(shareTint)).toEqual([
      SEQUENTIAL_RAMP[0],
      SEQUENTIAL_RAMP[0],
      SEQUENTIAL_RAMP[1],
      SEQUENTIAL_RAMP[2],
      SEQUENTIAL_RAMP[3],
      SEQUENTIAL_RAMP[4],
      SEQUENTIAL_RAMP[5],
      SEQUENTIAL_RAMP[6],
      SEQUENTIAL_RAMP[7],
      SEQUENTIAL_RAMP[8],
      SEQUENTIAL_RAMP[8],
    ])
    // "Yes" at 84% and at 93% (review H3): two different steps.
    expect(shareTint(0.84)).not.toBe(shareTint(0.93))
    expect(SEQUENTIAL_RAMP).toHaveLength(9)
    expect(shareTint(null)).toBe('transparent')
  })

  test('the pair CSV: every cell with both answers in words, its column’s share and n', () => {
    const lines = pairToCsv(pairFixture).trim().split('\n')
    expect(lines).toContain('# x: ATTEND_SVCS')
    expect(lines).toContain('# y: INCOME_FEELINGS')
    expect(lines).toContain('# correlation: 0.31 (pearson_r, n=60)')
    expect(lines).toContain('# cell_flag_below: 5')
    expect(lines).toContain('# column_flag_below: 10')
    const header = lines.find((line) => !line.startsWith('#')) as string
    expect(header.split(',').slice(0, 6)).toEqual([
      'x',
      'x_label',
      'x_share',
      'x_n',
      'y',
      'y_label',
    ])
    expect(header.endsWith(',cell_flagged')).toBe(true)
    const rows = lines.slice(lines.indexOf(header) + 1)
    expect(rows).toHaveLength(12)
    expect(rows[0]).toMatch(
      /^3,Never,0\.3,18,4,Finding it very difficult on present income,proportion,0\.5,/,
    )
    expect(rows[3]?.endsWith(',True')).toBe(true)
    expect(rows[0]?.endsWith(',False')).toBe(true)
  })

  test('point estimates say so in tooltips and footnotes; signed formatting', () => {
    const plain = plainRow('LONELY', -0.52)
    expect(tipText(plain, 'Loneliness')).toContain('no interval is computed')
    // Neither the n (it lives in the data table) nor the weight's column name.
    expect(tipText(plain, 'Loneliness')).not.toContain('n =')
    expect(tipText(plain, 'Loneliness')).not.toContain('w_c1')
    // The footnote's noun follows the statistic without an interval.
    expect(footnoteCopy({ ...rankedPlain.meta, stat: 'quantile' }, 'dots', false)).toContain(
      'no confidence interval is computed for a median',
    )
    expect(intervalText(plain)).toContain('point estimate')
    expect(footnoteCopy(rankedPlain.meta, 'dots', false)).toContain('Dots are point estimates')
    expect(footnoteCopy(rankedPlain.meta, 'table', false)).toContain('Cells are point estimates')
    expect(formatEstimate(-0.52, 'pearson_r')).toBe('−0.52')
    expect(formatEstimate(0.3, 'beta')).toBe('+0.30')
    expect(formatEstimate(0, 'spearman_r')).toBe('0.00')
  })

  test('HeatTable renders an em dash for a missing cell and the hidden n for a present one', () => {
    render(
      <HeatTable
        caption="cap"
        corner="rows ↓ · cols →"
        rows={[{ key: 'a', label: 'A' }]}
        columns={[
          { key: 'x', label: 'X' },
          { key: 'y', label: 'Y' },
        ]}
        cellAt={(_row, column) =>
          column.key === 'x'
            ? { text: '+0.10', title: 'tip', tint: 'var(--div-500)', hidden: ', too few to rank' }
            : undefined
        }
      />,
    )
    const cells = screen.getAllByRole('cell')
    expect(cells.map((cell) => cell.textContent)).toEqual(['+0.10, too few to rank', '—'])
    expect(cells[0]?.getAttribute('style')).toContain('var(--div-500)')
    // Without a column width, columns keep fitting their one-line labels.
    expect(screen.getByRole('table')).not.toHaveAttribute('data-fixed')
    const row: EstimateRow = plainRow('LONELY', 0.2)
    expect(row.ci_method).toBe('none')
  })

  test('a midyear question wears its small tag: a heat table’s headers, a ranked row', () => {
    render(
      <HeatTable
        caption="cap"
        corner="rows ↓ · cols →"
        rows={[{ key: 'a', label: 'Daily social media time', tag: 'Midyear' }]}
        columns={[{ key: 'x', label: 'Loneliness' }]}
        cellAt={() => ({ text: '+0.10', title: 'tip', tint: 'var(--div-p1)' })}
      />,
    )
    const header = screen.getByRole('rowheader')
    expect(header.textContent).toBe('Daily social media timeMidyear')
    expect(within(header).getByText('Midyear').tagName).toBe('SPAN')
    cleanup()
    const figure = render(
      <RankedBar
        rows={[plainRow('TIME_MEDIA', 0.3), plainRow('LONELY', -0.2)]}
        meta={testMeta}
        responseMeta={testResponseMeta({ stat: 'pearson_r' })}
        variable={happyVariable}
        color="var(--div-pos-mark)"
        labelOf={(row) =>
          row.predictor === 'TIME_MEDIA' ? 'Daily social media time' : 'Loneliness'
        }
        fixedScale={CORRELATION_SCALE}
        fitLabels
        tagOf={(row) => (row.predictor === 'TIME_MEDIA' ? 'Midyear' : undefined)}
      />,
    ).container
    const tags = [...figure.querySelectorAll('tspan[font-size="11"]')].map(
      (node) => node.textContent,
    )
    expect(tags).toEqual(['Midyear'])
    expect(figure.querySelector('svg')?.textContent).toContain('Daily social media time Midyear')
  })

  test('HeatTable: past the edge, "N more →" is a button that pages the box beside its sticky column', () => {
    const layout = fakeHeatLayout(250)
    try {
      render(
        <HeatTable
          caption="cap"
          corner="rows ↓ · cols →"
          rows={[{ key: 'a', label: 'A' }]}
          columns={FOUR_COLUMNS}
          cellAt={() => ({ text: '1.00', title: 'tip', tint: 'var(--seq-100)' })}
          columnWidth={96}
        />,
      )
      // X is cut at the box's edge (250); Y and Z lie past it.
      const more = screen.getByRole('button', { name: '3 more →' })
      fireEvent.click(more)
      // X, the first column not wholly in view, comes in beside the
      // sticky first column (which ends at 100): 100, not the box's 150.
      expect(layout.scrollBy).toHaveBeenCalledWith({ left: 100 })
      const table = screen.getByRole('table')
      expect(table).toHaveAttribute('data-fixed')
      expect(table.getAttribute('style')).toContain('--heat-column: 96px')
    } finally {
      layout.restore()
    }
  })

  test('HeatTable: the sorted column wears its arrow and aria-sort, and comes into view', () => {
    const layout = fakeHeatLayout(250)
    try {
      const table = (sort: { column: string; dir: 'asc' | 'desc' }) => (
        <HeatTable
          caption="cap"
          corner="rows ↓ · cols →"
          rows={[{ key: 'a', label: 'A' }]}
          columns={FOUR_COLUMNS}
          cellAt={() => undefined}
          columnWidth={96}
          sort={sort}
        />
      )
      const { rerender } = render(table({ column: 'z', dir: 'desc' }))
      const z = screen.getByRole('columnheader', { name: /^Z/ })
      expect(z.textContent).toBe('Z\u00a0▼')
      expect(z).toHaveAttribute('aria-sort', 'descending')
      expect(screen.getByRole('columnheader', { name: 'W' })).not.toHaveAttribute('aria-sort')
      // Z spans 400–500 past the box's edge (250): it comes in beside the
      // sticky column, which ends at 100.
      expect(layout.scrollBy).toHaveBeenLastCalledWith({ left: 300 })
      layout.scrollBy.mockClear()
      // A sort on a column already in view leaves the box be.
      rerender(table({ column: 'w', dir: 'asc' }))
      expect(screen.getByRole('columnheader', { name: /^W/ }).textContent).toBe('W\u00a0▲')
      expect(layout.scrollBy).not.toHaveBeenCalled()
    } finally {
      layout.restore()
    }
  })
})
