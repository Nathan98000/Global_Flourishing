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
import { shareLabel, shareTint } from '../charts/CrossTab'
import { DIVERGING_RAMP, SEQUENTIAL_RAMP, divergingTint, signMark, tipText } from '../charts/theme'
import { HeatTable, columnsPastEdge, intervalText } from '../charts/TransitionTable'
import { pairToCsv } from '../export/csv'
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
  fewPeople,
  defaultCountry,
  heatCells,
  acrossSubtitle,
  legendEnds,
  overlapNote,
  pairAxisTitle,
  pairBarTip,
  pairCellTip,
  pinnedFirst,
  rankedSubtitle,
  rankedTip,
  starred,
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
    expect(screen.getByText('Goes with a higher Happiness')).toBeInTheDocument()
    expect(screen.getByText('Goes with a lower Happiness')).toBeInTheDocument()
    expect(svgText).toContain('← goes with a lower Happiness')
    expect(svgText).toContain('goes with a higher Happiness →')
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
    expect(text).toContain('Dots are point estimates — no confidence interval is computed')
    // The footnote carries the overlap sentence only: not how many went unranked.
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
    expect(screen.getByText('What goes with Happiness, in every country')).toBeInTheDocument()
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
      '+0.05*, few people behind this estimate',
      '+0.31',
    ])
    expect(cells[2]).toHaveAttribute('data-flagged')
    expect(cells[2]?.getAttribute('style')).toContain('var(--div-')
    fireEvent.pointerEnter(cells[2] as HTMLElement)
    const tip = within(matrix).getByRole('tooltip').textContent ?? ''
    expect(tip).toContain('+0.05')
    expect(tip).toContain('Few people gave these answers, so this estimate is less reliable.')
    expect(tip).not.toMatch(/n =|people answered|Too few/)
    fireEvent.pointerLeave(cells[2] as HTMLElement)
    expect(
      within(matrix).getByText('* few people behind this estimate — less reliable'),
    ).toBeInTheDocument()
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
    expect(
      screen.getByText('Service attendance and Feelings about household income'),
    ).toBeInTheDocument()
    expect(screen.getByText('United States · Wave 1, 2023')).toBeInTheDocument()
    // The header row: the correlation strip, and where.
    expect(screen.getByText('Correlation')).toBeInTheDocument()
    expect(screen.getByText('+0.31')).toBeInTheDocument()
    expect(screen.getByLabelText('In United States')).toBeChecked()
    expect(screen.getByLabelText('In every country')).not.toBeChecked()
    // The legend: fixed bins, and the asterisk.
    expect(screen.getByText('Share of each column')).toBeInTheDocument()
    expect(
      screen.getByText('* few people behind this estimate — less reliable'),
    ).toBeInTheDocument()
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
    // The footnote says how to read it; no causes.
    const main = visibleText(screen.getByRole('main'))
    expect(main).toContain(
      'Each column is the people who gave that answer to Service attendance; the shading shows how they answered Feelings about household income, adding to 100% down the column.',
    )
    expect(main).toContain('Hover a cell for its 95% confidence interval')
    expect(main).not.toMatch(/cause/i)
    expect(screen.getByRole('link', { name: 'How these numbers are made' })).toBeInTheDocument()
    // The data table names both questions' answers, with every n.
    fireEvent.click(screen.getByText('Data table'))
    const data = screen.getAllByRole('table')[0] as HTMLElement
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
    const calls = mockFetch(tier)
    const router = await renderAt('/correlates?a=ATTEND_SVCS&b=INCOME_FEELINGS')
    await screen.findByRole('img', {
      name: /Service attendance and Feelings about household income in/,
    })
    fireEvent.click(screen.getByLabelText('In every country'))
    await waitFor(() => expect(router.state.location.searchStr).toContain('scope=all'))
    const figure = await screen.findByRole('img', {
      name: /their correlation in each of 2 countries/,
    })
    // Only this chart: the grid has left.
    expect(screen.queryByText('Share of each column')).toBeNull()
    expect(
      screen.getByText('Every country · Wave 1, 2023 · correlation, −1 to 1'),
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
    // The strip still reads the chosen country's correlation.
    const strip = screen.getByText('Correlation').parentElement as HTMLElement
    expect(within(strip).getByText('+0.31')).toBeInTheDocument()
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
    // but one — by short name, with no numbers anywhere; headers angled.
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((th) => th.textContent),
    ).toEqual(['Loneliness', 'Service attendance'])
    const headers = within(table).getAllByRole('columnheader')
    expect(headers.slice(1).map((th) => th.textContent)).toEqual(['Happiness', 'Loneliness'])
    expect(table).toHaveAttribute('data-angled')
    const cells = within(table).getAllByRole('cell')
    expect(cells.map((cell) => cell.textContent)).toEqual([
      '−0.52',
      '',
      '·, built from the same answers',
      '+0.20*, few people behind this estimate',
    ])
    // The tint is on a fixed −1 to 1: −0.52 is the middle rust step, not the deepest.
    expect(cells[0]?.getAttribute('style')).toContain('var(--div-n3)')
    // One line of legend: the ramp's ends, the asterisk, the dot — no numbers of questions.
    const legend = figure.querySelector('[class*=legendRow]') as HTMLElement
    expect(legend.textContent).toBe(
      '−1+1* few people behind this estimate· built from the same answers',
    )
    // The tooltip: the value, the row with the column; flagged, the sentence.
    const lonely = within(table).getByRole('button', {
      name: 'Loneliness with Happiness, −0.52: see the two questions together',
    })
    fireEvent.focus(lonely)
    expect(within(figure).getByRole('tooltip')).toHaveTextContent(
      /^−0\.52 · Loneliness with Happiness$/,
    )
    fireEvent.blur(lonely)
    expect(screen.getByText('Select a cell to see the two questions together.')).toBeVisible()
    // A cell opens Compare two: the column first, the row second.
    fireEvent.click(lonely)
    await waitFor(() =>
      expect(router.state.location.searchStr).toBe(
        '?a=HAPPY&b=LONELY&vars=HAPPY%2CLONELY%2CATTEND_SVCS',
      ),
    )
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
          .slice(1)
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
    const note = screen.getByText(
      "Midyear and 2024 aren't available: the two questions were both asked only in Wave 1.",
    )
    expect(wave).not.toContainElement(note)
    expect(note.previousElementSibling).toContainElement(type)
    expect(within(wave).getByLabelText('2024')).toHaveAccessibleDescription(note.textContent ?? '')
    expect(within(wave).getByLabelText('2023')).not.toHaveAccessibleDescription()
    // "What's the difference?" opens a note in plain words; Escape closes it.
    const info = screen.getByRole('button', { name: 'What’s the difference?' })
    expect(info).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(info)
    expect(
      screen.getByText('Straight-line (Pearson): how closely two answers follow a straight line.'),
    ).toBeVisible()
    expect(
      screen.getByText('By rank (Spearman): how consistently one rises with the other.'),
    ).toBeVisible()
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
    await screen.findByRole('img', { name: /Happiness and Loneliness in/ })
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
      'The 20 questions ranked for Japan, in every country · Wave 2, 2024 · correlation, −1 to 1',
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
    expect(fewPeople({ estimate: 0.1, n: 7 }, 100)).toBe(true)
    expect(fewPeople({ estimate: null, n: 7 }, 100)).toBe(false)
    expect(fewPeople({ estimate: 0.1, n: 700 }, 100)).toBe(false)
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
    // correlation few people are behind says so in a sentence.
    expect(rankedTip({ estimate: 0.412, stat: 'pearson_r' }, 'Gratitude')).toBe('+0.41 · Gratitude')
    expect(rankedTip({ estimate: 0.412, stat: 'pearson_r' }, 'Gratitude', true)).toBe(
      '+0.41 · Gratitude\nFew people gave these answers, so this estimate is less reliable.',
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
    const tip = {
      aLevel: '3',
      aShort: 'Life evaluation today',
      bLevel: 'Getting by on present income',
      bShort: 'Feelings about household income',
      share: 0.184,
      interval: '95% CI [15.0%, 21.8%]',
      flagged: false,
    }
    expect(pairCellTip(tip)).toBe(
      'Of people who answered 3 to Life evaluation today, 18% answered Getting by on present income to Feelings about household income.\n95% CI [15.0%, 21.8%]',
    )
    expect(pairCellTip({ ...tip, share: 0.004, flagged: true })).toBe(
      'Of people who answered 3 to Life evaluation today, <1% answered Getting by on present income to Feelings about household income.\n95% CI [15.0%, 21.8%]\nFew people gave these answers, so this estimate is less reliable.',
    )
    expect(pairCellTip({ ...tip, share: null })).toBe(
      'Nobody here answered 3 to Life evaluation today.',
    )
    expect(
      pairBarTip({
        level: '8',
        short: 'Life evaluation today',
        share: 0.21,
        interval: undefined,
        flagged: false,
      }),
    ).toBe('21% answered 8 to Life evaluation today.')
    // Shares: whole percents, "<1%" for a sliver, never "0%" above zero.
    expect(shareLabel(0.57)).toBe('57%')
    expect(shareLabel(0.004)).toBe('<1%')
    expect(shareLabel(0)).toBe('0%')
    // Fixed bins at 0/5/10/20/30/45/60%, onto the seven ramp tokens.
    expect([0, 0.049, 0.05, 0.1, 0.2, 0.3, 0.45, 0.6, 1].map(shareTint)).toEqual([
      SEQUENTIAL_RAMP[0],
      SEQUENTIAL_RAMP[0],
      SEQUENTIAL_RAMP[1],
      SEQUENTIAL_RAMP[2],
      SEQUENTIAL_RAMP[3],
      SEQUENTIAL_RAMP[4],
      SEQUENTIAL_RAMP[5],
      SEQUENTIAL_RAMP[6],
      SEQUENTIAL_RAMP[6],
    ])
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
