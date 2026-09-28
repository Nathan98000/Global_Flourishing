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
  CorrelationsResponse,
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
  axisEnds,
  belowFloor,
  countriesByName,
  defaultCountry,
  excludedNote,
  heatCells,
  acrossSubtitle,
  hollowNote,
  legendEnds,
  methodLabel,
  overlapNote,
  pairSubtitle,
  pairTip,
  pinnedFirst,
  rankedSubtitle,
  rankedTip,
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
  test('a first visit lands on Compare two with the default pair, one chart and no causes', async () => {
    const calls = mockFetch(tier)
    await renderAt('/correlates')
    await screen.findByRole('img', {
      name: /Feelings about household income by Life evaluation today/,
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
    // Every row is a real button (label and dot alike).
    const rowButtons = within(figure).getAllByRole('button')
    expect(rowButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Loneliness, −0.52: see it beside Happiness',
      'Service attendance, +0.31: see it beside Happiness',
    ])
    const text = visibleText(screen.getByRole('main'))
    expect(text).toContain('Dots are point estimates — no confidence interval is computed')
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
    expect(within(data).getByRole('columnheader', { name: 'Measure' })).toBeInTheDocument()
    expect(within(data).getByText('Loneliness')).toBeInTheDocument()
    expect(within(data).getAllByText('54').length).toBeGreaterThan(0)
  })

  test('Find related in every country: the ranked questions across countries, the chosen one pinned first', async () => {
    const calls = mockFetch(tier)
    const router = await renderAt('/correlates?view=related&outcome=HAPPY')
    await screen.findByRole('group', { name: /most strongly associated with it/ })
    fireEvent.click(screen.getByLabelText('In every country'))
    await waitFor(() => expect(router.state.location.searchStr).toContain('scope=all'))
    const matrix = await screen.findByRole('img', { name: /as a matrix/ })
    // The ranked chart has left the page: one chart at a time.
    expect(screen.queryByRole('group', { name: /most strongly associated with it/ })).toBeNull()
    expect(screen.getByText('Happiness, across countries')).toBeInTheDocument()
    const table = within(matrix).getByRole('table')
    const headers = within(table).getAllByRole('columnheader')
    expect(headers.map((th) => th.textContent)).toEqual([
      'Measure ↓ · country →',
      'United States',
      'Testland',
    ])
    expect(headers[1]).toHaveAttribute('data-highlight')
    const correlates = calls.filter((url) => url.includes('/v1/correlates'))
    expect(correlates).toHaveLength(2)
    expect(correlates[1]).toContain('against=LONELY&against=ATTEND_SVCS&by=country_code')
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
      await screen.findByRole('img', { name: /Happiness by Service attendance/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'First question: Service attendance' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Second question: Happiness' })).toBeVisible()
  })

  test('Compare two: the second question’s average for each answer to the first', async () => {
    const calls = mockFetch(tier)
    await renderAt('/correlates?a=ATTEND_SVCS&b=HAPPY')
    const figure = await screen.findByRole('img', { name: /Happiness by Service attendance/ })
    // The answers along the axis, in the server's (aligned) order.
    const svg = figure.querySelector('svg') as SVGSVGElement
    const text = svg.textContent ?? ''
    expect(text.indexOf('Never')).toBeLessThan(text.indexOf('Sometimes'))
    expect(text.indexOf('Sometimes')).toBeLessThan(text.indexOf('Weekly'))
    const main = visibleText(screen.getByRole('main'))
    expect(main).toContain('Each dot is an average of people’s answers, not individual people.')
    expect(main).not.toMatch(/cause/i)
    expect(screen.getByRole('link', { name: 'How these numbers are made' })).toBeInTheDocument()
    const pair = calls.find((url) => url.includes('/v1/correlations/pair')) as string
    expect(pair).toContain('y=HAPPY&x=ATTEND_SVCS&wave=Y1&filter=country_code%3A22')
  })

  test('Compare two: pick either question, and Swap exchanges the two', async () => {
    mockFetch(tier)
    const router = await renderAt('/correlates')
    await screen.findByRole('img', { name: /by Life evaluation today/ })
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
      await screen.findByRole('img', { name: /Service attendance by Happiness/ }),
    ).toBeInTheDocument()
  })

  test('state carries across views: Find related’s question seeds Compare two, and back', async () => {
    mockFetch(tier)
    const router = await renderAt('/correlates?a=HAPPY&b=LONELY')
    await screen.findByRole('img', { name: /Loneliness by Happiness/ })
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

  test('the footnote says which overlapping questions the ranking left out', async () => {
    mockFetch({
      ...tier,
      'filter=country_code%3A22': {
        ...rankedPlain,
        meta: { ...rankedPlain.meta, dropped_overlap: { HAPPY_ITEM: 'sfi', LONELY_ITEM: 'sfi' } },
      },
    })
    await renderAt('/correlates?view=related&outcome=HAPPY')
    expect(
      await screen.findByText(
        /Secure Flourishing Index is shown; its individual questions are left out\./,
      ),
    ).toBeInTheDocument()
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

  test('Compare several: a lower-triangle table; a cell opens Compare two, column first', async () => {
    mockFetch(tier)
    const router = await renderAt('/correlates?view=matrix&vars=HAPPY,LONELY,ATTEND_SVCS')
    const figure = await screen.findByRole('group', { name: /Correlations among 3 questions/ })
    const chips = within(screen.getByRole('list', { name: 'Questions in this table' }))
    expect(chips.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '1 · Happiness×',
      '2 · Loneliness×',
      '3 · Service attendance×',
    ])
    const table = within(figure).getByRole('table')
    const cells = within(table).getAllByRole('cell')
    expect(cells.map((cell) => cell.textContent)).toEqual([
      '',
      '',
      '',
      '−0.52',
      '',
      '',
      '·, built from the same answers',
      '—, too few respondents',
      '',
    ])
    fireEvent.click(
      within(table).getByRole('button', {
        name: 'Loneliness and Happiness, −0.52: see the two questions together',
      }),
    )
    await waitFor(() =>
      expect(router.state.location.searchStr).toBe(
        '?a=HAPPY&b=LONELY&vars=HAPPY%2CLONELY%2CATTEND_SVCS',
      ),
    )
  })

  test('Compare several: add a question, remove one; two at least, ten at most', async () => {
    mockFetch(tier)
    const router = await renderAt('/correlates?view=matrix&vars=HAPPY,LONELY,ATTEND_SVCS')
    await screen.findByRole('group', { name: /Correlations among 3 questions/ })
    fireEvent.change(screen.getByLabelText('Add a question'), { target: { value: 'secure' } })
    fireEvent.click(await screen.findByRole('button', { name: /Secure Flourishing Index/ }))
    await waitFor(() =>
      expect(router.state.location.searchStr).toContain('vars=HAPPY%2CLONELY%2CATTEND_SVCS%2Csfi'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove Loneliness' }))
    await waitFor(() =>
      expect(router.state.location.searchStr).toContain('vars=HAPPY%2CATTEND_SVCS%2Csfi'),
    )
    // At two, nothing more can go.
    const two = await renderAt('/correlates?view=matrix&vars=HAPPY,LONELY')
    await waitFor(() => expect(two.state.location.searchStr).toContain('vars='))
    const removers = await screen.findAllByRole('button', { name: /^Remove / })
    expect(removers.slice(-2).every((button) => (button as HTMLButtonElement).disabled)).toBe(true)
  })

  test('Compare several: a linked question not asked at the wave is left out, and named', async () => {
    mockFetch(tier)
    // LONELY is asked at Y1 only.
    await renderAt('/correlates?wave=Y2&view=matrix&vars=HAPPY,LONELY,ATTEND_SVCS')
    expect(
      await screen.findByText('Left out, not asked in Wave 2, 2024: Loneliness.'),
    ).toBeInTheDocument()
    const chips = within(screen.getByRole('list', { name: 'Questions in this table' }))
    expect(chips.getAllByRole('listitem')).toHaveLength(2)
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

  test('choosing the rank correlation asks for it and says so on the button', async () => {
    const calls = mockFetch(tier)
    const router = await renderAt('/correlates?view=related&outcome=HAPPY')
    await screen.findByRole('group', { name: /most strongly associated with it/ })
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
    await renderAt('/correlates?view=related&outcome=HAPPY&scope=all')
    const matrix = await screen.findByRole('img', { name: /as a matrix/ })
    const select = within(screen.getByRole('main')).getByLabelText('Country') as HTMLSelectElement
    expect([...select.options].map((option) => option.text)).toEqual([
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

  test('a wave the questions were not asked in is unavailable, and the line under the row says why', async () => {
    const calls = mockFetch(tier)
    await renderAt('/correlates?view=related&outcome=HAPPY&wave=MY')
    expect(await screen.findByText(/wasn't asked in Midyear survey/)).toBeInTheDocument()
    expect(calls.some((url) => url.includes('/v1/correlates'))).toBe(false)
    const midyear = screen.getByLabelText('Midyear')
    expect(midyear).toBeDisabled()
    expect(midyear).toHaveAccessibleDescription(
      "Midyear isn't available: this question wasn't asked in the midyear survey.",
    )
    // Compare two: the pair's waves.
    await renderAt('/correlates?a=HAPPY&b=LONELY')
    await screen.findByRole('img', { name: /Loneliness by Happiness/ })
    expect(screen.getAllByLabelText('2024').at(-1)).toHaveAccessibleDescription(
      "Midyear and 2024 aren't available: the two questions were both asked only in Wave 1.",
    )
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
    expect(statisticPhrase(undefined)).toBe('correlation, −1 to 1')
    expect(statisticPhrase('spearman')).toBe('correlation by rank, −1 to 1')
    expect(rankedSubtitle('Japan', undefined, 'Y2')).toBe(
      'Japan · Wave 2, 2024 · correlation, −1 to 1',
    )
    expect(axisEnds('Happiness')).toEqual([
      '← goes with lower Happiness',
      'goes with higher Happiness →',
    ])
    expect(rankedTip({ estimate: 0.412, stat: 'pearson_r', n: 1234 }, 'Gratitude')).toBe(
      '+0.41 · Gratitude\n1,234 people answered both',
    )
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

  test('the overlap footnote is built from what the server left out', () => {
    const byName = {
      phq2_score: { display_name: 'PHQ-2 depression score', is_derived: true, scale_type: 'count' },
      gad2_score: { display_name: 'GAD-2 anxiety score', is_derived: true, scale_type: 'count' },
      phq2_positive: {
        display_name: 'PHQ-2 screen positive',
        is_derived: true,
        scale_type: 'binary',
      },
      gad2_positive: {
        display_name: 'GAD-2 screen positive',
        is_derived: true,
        scale_type: 'binary',
      },
      DEPRESSED: {
        display_name: 'Feeling down or depressed',
        is_derived: false,
        scale_type: 'ordinal',
      },
      sfi: { display_name: 'Secure Flourishing Index', is_derived: true, scale_type: 'scale_0_10' },
      sfi_meaning: {
        display_name: 'SFI: meaning & purpose',
        is_derived: true,
        scale_type: 'scale_0_10',
      },
    }
    expect(
      overlapNote(
        {
          DEPRESSED: 'phq2_score',
          phq2_positive: 'phq2_score',
          FEEL_ANXIOUS: 'gad2_score',
          gad2_positive: 'gad2_score',
        },
        byName,
      ),
    ).toBe(
      'PHQ-2 depression score and GAD-2 anxiety score are shown; their individual questions and screen-positive flags are left out.',
    )
    expect(overlapNote({ sfi_meaning: 'sfi', HAPPY: 'sfi' }, byName)).toBe(
      'Secure Flourishing Index is shown; its individual questions and domain scores are left out.',
    )
    expect(overlapNote({}, byName)).toBeUndefined()
    expect(overlapNote(null, byName)).toBeUndefined()
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
