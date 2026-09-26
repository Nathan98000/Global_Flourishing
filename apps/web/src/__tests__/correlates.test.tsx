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
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { predictorOrder } from '../api/correlates'
import { resetNegativePathCache } from '../api/estimates'
import type {
  ApiHealth,
  EstimateRow,
  PairResponse,
  VariableDetail,
  VariableSummary,
} from '../api/types'
import { footnoteCopy } from '../charts/ChartFigure'
import { DIVERGING_RAMP, divergingTint, signMark, tipText } from '../charts/theme'
import { HeatTable, columnsPastEdge, intervalText } from '../charts/TransitionTable'
import { formatEstimate } from '../format'
import { createAppRouter } from '../router'
import {
  attendVariable,
  happyVariable,
  sfiVariable,
  testMeta,
  testResponse,
  testRow,
} from '../test-utils/fixtures'
import {
  axisTitle,
  belowFloor,
  countriesByName,
  defaultCountry,
  excludedNote,
  heatCells,
  acrossSubtitle,
  hollowNote,
  legendEnds,
  methodLabel,
  pairSubtitle,
  pairTip,
  pinnedFirst,
  shareText,
  shortName,
  statisticPhrase,
  tintExtent,
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

/** Happiness by Service attendance in the United States: three answers
 * in the item's aligned order (Never → Weekly), the first resting on too
 * few people. */
const meanRow = (code: number, estimate: number, n: number) =>
  testRow({
    group: { ATTEND_SVCS: code },
    estimate,
    se: 0.3,
    ci_lo: estimate - 0.6,
    ci_hi: estimate + 0.6,
    n,
    sum_w: n,
  })

const pairFixture: PairResponse = {
  x: 'ATTEND_SVCS',
  grouping: 'answers',
  correlation: plainRow('ATTEND_SVCS', 0.157, undefined, 54),
  means: testResponse([meanRow(3, 4.19, 12), meanRow(2, 4.05, 18), meanRow(1, 5.37, 24)], {
    outcome: 'HAPPY',
    stat: 'mean',
    by: ['ATTEND_SVCS'],
    filters: { country_code: [22] },
    min_n: 15,
    n_valid: 54,
  }),
  groups: [
    { code: 3, label: 'Never', share: 12 / 54, below_min_n: true },
    { code: 2, label: 'Sometimes', share: 18 / 54, below_min_n: false },
    { code: 1, label: 'Weekly', share: 24 / 54, below_min_n: false },
  ],
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
    variables: [sfiVariable, happyVariable, attendVariable, lonelyVariable, urbanVariable],
  },
  '/data/v1/HAPPY/variable.json': happyDetail,
  '/health': okHealth,
  '/v1/correlations/pair': pairFixture,
  '&by=country_code': acrossPlain,
  'filter=country_code%3A22': rankedPlain,
}

/** What a reader sees: textContent minus the <style> blocks Plot embeds. */
function visibleText(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement
  for (const node of clone.querySelectorAll('style, script')) node.remove()
  return clone.textContent ?? ''
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

describe('Correlates view', () => {
  test('a ranked list of measures with no interval anywhere, and the caveat in plain words', async () => {
    const calls = mockFetch(tier)
    await renderAt('/correlates?outcome=HAPPY')
    const figure = await screen.findByRole('img', { name: /most strongly associated with it/ })
    // Rows are measures, named from the catalog, strongest first, signed.
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
    // The footnote names no interval that does not exist, and the caveat
    // is a sentence in the deck and in the footnote — no callout box.
    const main = screen.getByRole('main')
    const text = visibleText(main)
    expect(text).toContain('Dots are point estimates — no confidence interval is computed')
    expect(text).not.toContain('95%')
    expect(text).toContain(
      'Pick a question to see which other answers tend to go with it, in one country. Things that go together aren’t necessarily cause and effect.',
    )
    expect(screen.getByText(/Associations, not causes: two answers moving together/)).toBeVisible()
    // Nothing of the adjusted model is left on the page (ADR-0018).
    expect(text).not.toMatch(/adjusted|accounting for|model card|standard deviation/i)
    expect(screen.queryByRole('group', { name: 'Model' })).toBeNull()
    // The United States by default (found by its ISO code in meta).
    expect(within(main).getByLabelText('Country')).toHaveValue('22')
    // The ranking floor, in words, with the server's numbers.
    expect(text).toContain('1 measure with fewer than 20 respondents is not ranked.')
    // The correlation type sits in a closed Method disclosure: a real
    // button that names the method in use.
    const method = screen.getByRole('button', { name: 'Method: straight-line correlation' })
    expect(method).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('group', { name: 'Correlation type' })).toBeNull()
    expect(screen.getByText(/how closely two answers follow a line/)).not.toBeVisible()
    fireEvent.click(method)
    expect(method).toHaveAttribute('aria-expanded', 'true')
    const type = screen.getByRole('group', { name: 'Correlation type' })
    expect(within(type).getByLabelText('Straight-line (Pearson)')).toBeChecked()
    expect(
      screen.getByText(
        'Straight-line: how closely two answers follow a line. By rank: how consistently one rises with the other.',
      ),
    ).toBeVisible()
    // Escape closes it and hands focus back to the button.
    fireEvent.keyDown(type, { key: 'Escape' })
    expect(method).toHaveAttribute('aria-expanded', 'false')
    expect(method).toHaveFocus()
    // The wave the measure was not asked in says why, and is described by it.
    const midyear = screen.getByLabelText('Midyear')
    expect(midyear).toBeDisabled()
    expect(midyear).toHaveAccessibleDescription(
      "Midyear isn't available: this question wasn't asked in the midyear survey.",
    )
    // One chart on screen: the matrix waits for its own view, and its
    // request is never made.
    expect(screen.queryByRole('img', { name: /as a matrix/ })).toBeNull()
    const correlates = calls.filter((url) => url.includes('/v1/correlates'))
    expect(correlates).toHaveLength(1)
    expect(correlates[0]).toContain('filter=country_code%3A22')
    expect(correlates[0]).not.toContain('adjusted')
    expect(screen.getByRole('group', { name: 'View' })).toBeInTheDocument()
    expect(screen.getByLabelText('In United States')).toBeChecked()
    // The data table names the measure and its n on every row.
    fireEvent.click(screen.getAllByText('Data table')[0] as HTMLElement)
    const data = screen.getAllByRole('table')[0] as HTMLElement
    expect(within(data).getByRole('columnheader', { name: 'Measure' })).toBeInTheDocument()
    expect(within(data).queryByRole('columnheader', { name: '95% CI' })).toBeNull()
    expect(within(data).getByText('Loneliness')).toBeInTheDocument()
    expect(within(data).getAllByText('54').length).toBeGreaterThan(0)
  })

  test('Across countries: the ranked measures in every country, the chosen one pinned first', async () => {
    const calls = mockFetch(tier)
    const router = await renderAt('/correlates?outcome=HAPPY')
    await screen.findByRole('img', { name: /most strongly associated with it/ })
    fireEvent.click(screen.getByLabelText('Across countries'))
    await waitFor(() => expect(router.state.location.searchStr).toContain('view=countries'))
    const matrix = await screen.findByRole('img', { name: /as a matrix/ })
    // The ranked chart has left the page: one chart at a time.
    expect(screen.queryByRole('img', { name: /most strongly associated with it/ })).toBeNull()
    expect(screen.getByText('Happiness, across countries')).toBeInTheDocument()
    expect(
      screen.getByText(
        'The 2 measures ranked for United States, in every country · Wave 1, 2023 · correlation, −1 to 1',
      ),
    ).toBeInTheDocument()
    const table = within(matrix).getByRole('table')
    // The chosen country first, marked; the rest A–Z.
    const headers = within(table).getAllByRole('columnheader')
    expect(headers.map((th) => th.textContent)).toEqual([
      'Measure ↓ · country →',
      'United States',
      'Testland',
    ])
    expect(headers[1]).toHaveAttribute('data-highlight')
    expect(headers[2]).not.toHaveAttribute('data-highlight')
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((th) => th.textContent),
    ).toEqual(['Loneliness', 'Service attendance'])
    const cells = within(table).getAllByRole('cell')
    // A cell below the ranking floor reads a muted dash; its number is
    // in the tooltip and the data table.
    expect(cells.map((cell) => cell.textContent)).toEqual([
      '−0.40',
      '−0.52',
      '—, too few respondents',
      '+0.31',
    ])
    expect(cells[0]).toHaveAttribute('data-highlight')
    // Tints fit the data: the strongest cell wears the deepest tint.
    expect(cells[1]?.getAttribute('style')).toContain('var(--div-n5)')
    // The tooltip is styled, on hover (never a native title).
    const tipOf = (cell: HTMLElement | undefined) => {
      fireEvent.pointerEnter(cell as HTMLElement)
      const text = within(matrix).getByRole('tooltip').textContent
      fireEvent.pointerLeave(cell as HTMLElement)
      return text
    }
    expect(cells[0]).not.toHaveAttribute('title')
    expect(tipOf(cells[0])).toContain('point estimate')
    expect(cells[2]?.getAttribute('style')).toBeNull()
    expect(cells[2]?.className).toContain('cellMuted')
    expect(tipOf(cells[2])).toContain('Too few respondents to rank (fewer than ')
    expect(tipOf(cells[2])).toContain('+0.05')
    expect(tipOf(cells[2])).not.toContain('n =')
    // The legend, above the scrolling table in plain words: the window's
    // ends around the ramp, the hues, the dash.
    expect(matrix.querySelector('[class*=legendKey]')?.textContent).toBe('−0.52+0.52')
    expect(
      within(matrix).getByText(
        'rust: goes with lower Happiness · teal: goes with higher Happiness',
      ),
    ).toBeInTheDocument()
    expect(within(matrix).getByText('— too few respondents')).toBeInTheDocument()
    expect(within(matrix).queryByText(/deeper the tint/)).toBeNull()
    // The ranked sweep for the country, then its measures across countries.
    const correlates = calls.filter((url) => url.includes('/v1/correlates'))
    expect(correlates).toHaveLength(2)
    expect(correlates[1]).toContain('against=LONELY&against=ATTEND_SVCS&by=country_code')
  })

  test('Compare two: the measure’s average for each answer to the other question, as a binned scatter', async () => {
    const calls = mockFetch(tier)
    await renderAt('/correlates?outcome=HAPPY&view=pair&x=ATTEND_SVCS')
    const figure = await screen.findByRole('img', { name: /Happiness by Service attendance/ })
    expect(screen.getByText('Happiness by Service attendance')).toBeInTheDocument()
    expect(
      screen.getByText(
        'United States · Wave 1, 2023 · average Happiness for each answer to Service attendance · correlation +0.16 (straight-line), 54 people',
      ),
    ).toBeInTheDocument()
    // The answers along the axis, in the server's (aligned) order; one
    // dot per group — never a respondent — in one hue, the thin group
    // hollow; whiskers for the intervals.
    const svg = figure.querySelector('svg') as SVGSVGElement
    const text = svg.textContent ?? ''
    expect(text.indexOf('Never')).toBeLessThan(text.indexOf('Sometimes'))
    expect(text.indexOf('Sometimes')).toBeLessThan(text.indexOf('Weekly'))
    const dots = svg.querySelectorAll('[aria-label="dot"] circle')
    expect(dots).toHaveLength(3)
    // (Plot draws the largest first, so smaller dots sit on top.)
    const fills = [...dots].map((dot) => dot.getAttribute('fill'))
    expect(fills.filter((fill) => fill === 'var(--surface)')).toHaveLength(1)
    expect(fills.filter((fill) => fill === 'var(--div-pos-mark)')).toHaveLength(2)
    expect(figure.innerHTML).not.toMatch(/#[0-9a-f]{6}/i)
    expect(screen.getByText('Larger dot = more people gave that answer')).toBeInTheDocument()
    // The footnote: averages, not people; no causes; the hollow group named.
    const main = visibleText(screen.getByRole('main'))
    expect(main).toContain('Each dot is an average of people’s answers, not individual people.')
    expect(main).toContain('Associations aren’t cause and effect.')
    expect(main).toContain('Fewer than 15 people gave “Never”: its dot is drawn hollow.')
    expect(main).toContain('Lines are 95% confidence intervals')
    expect(screen.getByRole('link', { name: 'How these numbers are made' })).toBeInTheDocument()
    // The x is named: no ranked sweep is needed, and the one request is the pair's.
    expect(calls.some((url) => url.includes('/v1/correlates'))).toBe(false)
    const pair = calls.find((url) => url.includes('/v1/correlations/pair')) as string
    expect(pair).toContain('y=HAPPY&x=ATTEND_SVCS&wave=Y1&filter=country_code%3A22')
    // The data table names the question and its answers, with every n.
    fireEvent.click(screen.getByText('Data table'))
    const data = screen.getAllByRole('table')[0] as HTMLElement
    expect(
      within(data).getByRole('columnheader', { name: 'Service attendance' }),
    ).toBeInTheDocument()
    expect(within(data).getByText('Never')).toBeInTheDocument()
    expect(within(data).getByText('24')).toBeInTheDocument()
  })

  test('Compare two starts from the top-ranked correlate, and Swap exchanges the two', async () => {
    const calls = mockFetch({
      ...tier,
      '/v1/correlations/pair': { ...pairFixture, x: 'LONELY' },
    })
    const router = await renderAt('/correlates?outcome=HAPPY&view=pair')
    await screen.findByRole('img', { name: /Happiness by Loneliness/ })
    // The default is the ranked list's first measure, never written to the URL.
    expect(calls.some((url) => url.includes('/v1/correlates'))).toBe(true)
    expect(calls.find((url) => url.includes('/v1/correlations/pair'))).toContain('x=LONELY')
    expect(router.state.location.searchStr).not.toContain('x=')
    expect(screen.getByLabelText('Compare with')).toHaveValue('LONELY')
    // Swap: the compared question becomes the measure, and back.
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }))
    await waitFor(() =>
      expect(router.state.location.searchStr).toBe('?outcome=LONELY&view=pair&x=HAPPY'),
    )
    // Picking another question to compare with writes it.
    fireEvent.change(screen.getByLabelText('Compare with: topic'), {
      target: { value: 'religion' },
    })
    await waitFor(() => expect(router.state.location.searchStr).toContain('x=ATTEND_SVCS'))
  })

  test('Compare two says why when the two questions cannot be set side by side', async () => {
    mockFetch({
      ...tier,
      '/v1/correlations/pair': new Response(
        JSON.stringify({
          detail: [
            'Secure Flourishing Index and Happiness are built from the same answers, so they go together by construction — compare Happiness with another question',
          ],
        }),
        { status: 422, headers: { 'content-type': 'application/json' } },
      ),
    })
    await renderAt('/correlates?outcome=HAPPY&view=pair&x=sfi')
    expect(await screen.findByText(/built from the same answers/)).toBeInTheDocument()
    // A nominal item cannot be compared with at all — said before asking.
    mockFetch(tier)
    await renderAt('/correlates?outcome=HAPPY&view=pair&x=URBAN_RURAL')
    expect(await screen.findByText(/is a set of categories with no order/)).toBeInTheDocument()
  })

  test('an old link asking for the adjusted model gets the usual notice, and never sends it', async () => {
    const calls = mockFetch(tier)
    await renderAt('/correlates?outcome=HAPPY&adjusted=true')
    expect(
      await screen.findByText(/invalid and were reset to defaults: adjusted/),
    ).toBeInTheDocument()
    const figure = await screen.findByRole('img', { name: /most strongly associated with it/ })
    expect(ruleLines(figure)).toBe(1) // the zero rule; no whiskers
    const correlates = calls.filter((url) => url.includes('/v1/correlates'))
    expect(correlates.length).toBeGreaterThan(0)
    expect(correlates.every((url) => !url.includes('adjusted'))).toBe(true)
  })

  test('choosing the rank correlation asks for it and says so on the button', async () => {
    const calls = mockFetch(tier)
    const router = await renderAt('/correlates?outcome=HAPPY')
    await screen.findByRole('img', { name: /most strongly associated with it/ })
    fireEvent.click(screen.getByRole('button', { name: 'Method: straight-line correlation' }))
    fireEvent.click(screen.getByLabelText('By rank (Spearman)'))
    await waitFor(() => expect(router.state.location.searchStr).toContain('method=spearman'))
    expect(
      await screen.findByRole('button', { name: 'Method: by-rank correlation' }),
    ).toBeInTheDocument()
    await waitFor(() => expect(calls.some((url) => url.includes('method=spearman'))).toBe(true))
  })

  test('countries run A–Z by name in the select and across the matrix', async () => {
    mockFetch({
      ...tier,
      '/data/meta.json': {
        ...testMeta,
        countries: [...testMeta.countries, { code: 5, name: 'Albania', iso3: 'ALB' }],
      },
    })
    await renderAt('/correlates?outcome=HAPPY&view=countries')
    const matrix = await screen.findByRole('img', { name: /as a matrix/ })
    const select = within(screen.getByRole('main')).getByLabelText('Country') as HTMLSelectElement
    expect([...select.options].map((option) => option.text)).toEqual([
      'Albania',
      'Testland',
      'United States',
    ])
    // The chosen country pinned first, then the rest A–Z.
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

  test('a measure with no order says so instead of asking the API', async () => {
    const calls = mockFetch(tier)
    await renderAt('/correlates?outcome=URBAN_RURAL')
    expect(await screen.findByText(/a set of categories with no order/)).toBeInTheDocument()
    expect(calls.some((url) => url.includes('/v1/correlates'))).toBe(false)
  })

  test('a wave the measure was not asked in says so', async () => {
    const calls = mockFetch(tier)
    await renderAt('/correlates?outcome=HAPPY&wave=MY')
    expect(
      await screen.findByText('Not asked in Midyear survey, Nov 2023–Dec 2024'),
    ).toBeInTheDocument()
    expect(calls.some((url) => url.includes('/v1/correlates'))).toBe(false)
  })

  test('choosing a country changes the request; the default country never reaches the URL', async () => {
    const calls = mockFetch({
      ...tier,
      'filter=country_code%3A1': {
        ...rankedPlain,
        meta: { ...rankedPlain.meta, filters: { country_code: [1] } },
      },
    })
    const router = await renderAt('/correlates?outcome=HAPPY')
    await screen.findByRole('img', { name: /most strongly associated with it/ })
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

  test('the tint extent fits the data; the legend and subtitle say so in words', () => {
    expect(tintExtent(acrossPlain.rows)).toBe(0.52)
    expect(tintExtent([])).toBe(1)
    expect(legendEnds(0.52, 'pearson_r')).toEqual(['−0.52', '+0.52'])
    expect(acrossSubtitle(20, 'Japan', 'Y2')).toBe(
      'The 20 measures ranked for Japan, in every country · Wave 2, 2024 · correlation, −1 to 1',
    )
    expect(acrossSubtitle(1, 'Japan', 'Y1')).toContain('The 1 measure ranked for Japan')
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

  test('the ranking floor: the footnote counts, cells below it are known', () => {
    expect(excludedNote({ min_n: 100, n_excluded: 3 })).toBe(
      '3 measures with fewer than 100 respondents are not ranked.',
    )
    expect(excludedNote({ min_n: 100, n_excluded: 1 })).toBe(
      '1 measure with fewer than 100 respondents is not ranked.',
    )
    expect(excludedNote({ min_n: 100, n_excluded: 0 })).toBeUndefined()
    expect(excludedNote({ min_n: null, n_excluded: null })).toBeUndefined()
    expect(belowFloor({ n: 7 }, 100)).toBe(true)
    expect(belowFloor({ n: 100 }, 100)).toBe(false)
    expect(belowFloor({ n: 7 }, null)).toBe(false)
    // Columns past the visible edge of the matrix, for the "N more" hint.
    expect(columnsPastEdge([100, 200, 300, 400], 250)).toBe(2)
    expect(columnsPastEdge([100, 200], 250)).toBe(0)
  })

  test('plain words for the method and the waves', () => {
    expect(statisticPhrase(undefined)).toBe('weighted correlation, −1 to 1')
    expect(statisticPhrase('spearman')).toBe('rank correlation, −1 to 1')
    expect(axisTitle(undefined)).toBe('Weighted correlation (Pearson)')
    expect(axisTitle('spearman')).toBe('Rank correlation (Spearman)')
    expect(methodLabel(undefined)).toBe('Method: straight-line correlation')
    expect(methodLabel('pearson')).toBe('Method: straight-line correlation')
    expect(methodLabel('spearman')).toBe('Method: by-rank correlation')
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
  })

  test('Compare two in words: subtitle, tooltip, hollow groups, shares', () => {
    const correlation = { estimate: -0.31, stat: 'spearman_r', n: 1234 }
    expect(
      pairSubtitle({
        countryName: 'Japan',
        wave: 'Y2',
        y: 'Happiness',
        x: 'Loneliness',
        binary: false,
        binned: false,
        correlation,
        method: 'spearman',
      }),
    ).toBe(
      'Japan · Wave 2, 2024 · average Happiness for each answer to Loneliness · correlation −0.31 (by rank), 1,234 people',
    )
    expect(
      pairSubtitle({
        countryName: 'Japan',
        wave: 'Y1',
        y: 'Volunteered last month',
        x: 'Secure Flourishing Index',
        binary: true,
        binned: true,
        correlation,
        method: undefined,
      }),
    ).toContain(
      'share answering yes to Volunteered last month across the range of Secure Flourishing Index · correlation −0.31 (straight-line)',
    )
    const point = { label: 'Weekly', share: 0.444, row: meanRow(1, 5.37, 24) }
    expect(pairTip(point, { yShort: 'Happiness', binary: false, binned: false })).toBe(
      '44% answered Weekly\nAverage Happiness: 5.37 (95% CI 4.77–5.97)\n24 people',
    )
    const share = {
      ...point,
      row: { ...point.row, stat: 'proportion', estimate: 0.34, ci_lo: 0.3, ci_hi: 0.38 },
    }
    expect(
      pairTip({ ...share, label: '2.5–3.2' }, { yShort: 'x', binary: true, binned: true }),
    ).toBe('44% at 2.5–3.2\nAnswered yes: 34.0% (95% CI 30.0%–38.0%)\n24 people')
    expect(shareText(0.004)).toBe('0.4%')
    expect(shareText(0.4449)).toBe('44%')
    expect(hollowNote([], 100, false)).toBeUndefined()
    expect(hollowNote(['0', '1'], 100, false)).toBe(
      'Fewer than 100 people gave “0” and “1”: their dots are drawn hollow.',
    )
    expect(hollowNote(['9.0 and above'], 100, true)).toBe(
      'Fewer than 100 people are in “9.0 and above”: its dot is drawn hollow.',
    )
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
