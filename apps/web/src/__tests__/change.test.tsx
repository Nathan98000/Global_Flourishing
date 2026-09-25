// The Change view (Phase 5): the same people a year later, rendered from
// one /v1/change envelope. The guard that keeps owner decision 2 from
// eroding lives here: the default output shows no follow-up rate,
// retention percentage or coverage figure, none of the jargon, and
// not the caution sentence that was withdrawn (ADR-0013, revised) —
// the interval and the n carry the uncertainty.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { resetNegativePathCache } from '../api/estimates'
import type { ApiHealth, EstimateRow, VariableDetail, VariableSummary } from '../api/types'
import { ChangeDots, changeScale } from '../charts/ChangeDots'
import { cellTint, transitionGrid, TransitionTable } from '../charts/TransitionTable'
import { formatChange, formatEstimate } from '../format'
import { createAppRouter } from '../router'
import {
  attendVariable,
  happyVariable,
  sfiVariable,
  testMeta,
  testResponse,
  testResponseMeta,
  testRow,
} from '../test-utils/fixtures'
import { changeLevels, orderChangeRows, shareRiseIsBetter, signedLevel } from '../views/changeOrder'

const okHealth: ApiHealth = {
  status: 'ok',
  service: 'flourish-atlas-api',
  version: '0.2.0',
  git_sha: 'abc1234def',
  data: 'ok',
  data_version: 'test.1.0.0',
}

const JARGON = /retention|attrition|panel|longitudinal|cohort|wave pair|coverage/i
/** The caution sentence withdrawn by the owner (ADR-0013, revised): it
 * must not come back in any form. */
const WITHDRAWN_CAUTION =
  /In some countries fewer people answered the second time, so those estimates are less certain\./

/** What a reader sees: textContent minus the <style> blocks Plot embeds
 * in its SVGs (jsdom has no innerText). */
function visibleText(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement
  for (const node of clone.querySelectorAll('style, script')) node.remove()
  return clone.textContent ?? ''
}

const changeRow = (code: number, estimate: number, n: number, extra: Partial<EstimateRow> = {}) =>
  testRow({
    group: { country_code: code },
    stat: 'change',
    estimate,
    ci_lo: estimate - 0.05,
    ci_hi: estimate + 0.05,
    n,
    weight: 'w_l2',
    ...extra,
  })

const happyChange = testResponse(
  [
    changeRow(1, -0.12, 900),
    changeRow(22, 0.3, 1500),
    ...[-2, -1, 0, 1, 2].map((level) =>
      testRow({
        group: { country_code: 1 },
        stat: 'change_distribution',
        level,
        estimate: 0.2,
        ci_lo: 0.15,
        ci_hi: 0.25,
        n: 40,
      }),
    ),
  ],
  { outcome: 'HAPPY', stat: 'change', waves: ['Y1', 'Y2'], weight_key: 'y1_y2', weight: 'w_l2' },
)

const happyDetail: VariableDetail = {
  ...happyVariable,
  value_labels: [],
  missingness: [],
  scoring: null,
  components: [],
}

const attendDetail: VariableDetail = {
  ...attendVariable,
  value_labels: [
    { code: 1, label: 'Weekly', wave: null, country_code: null, is_nonresponse: false },
    { code: 2, label: 'Sometimes', wave: null, country_code: null, is_nonresponse: false },
    { code: 3, label: 'Never', wave: null, country_code: null, is_nonresponse: false },
    { code: 99, label: '(Refused)', wave: null, country_code: null, is_nonresponse: true },
  ],
  missingness: [],
  scoring: null,
  components: [],
}

const transitionCell = (
  code: number,
  from: number,
  to: number,
  estimate: number,
  measure = 'transition_conditional',
) =>
  testRow({
    group: { country_code: code },
    stat: 'transition',
    from_level: from,
    to_level: to,
    measure,
    estimate,
    ci_lo: estimate - 0.02,
    ci_hi: estimate + 0.02,
    n: 30,
  })

/** A categorical item's change: the share answering each level, per country. */
const shareRow = (code: number, level: number, estimate: number, n: number) =>
  testRow({
    group: { country_code: code },
    stat: 'change_share',
    level,
    estimate,
    ci_lo: estimate - 0.01,
    ci_hi: estimate + 0.01,
    n,
    weight: 'w_l2',
  })

const attendChange = testResponse(
  [
    shareRow(1, 1, 0.05, 800),
    shareRow(1, 2, -0.03, 800),
    shareRow(1, 3, -0.02, 800),
    shareRow(22, 1, 0.012, 1800),
    shareRow(22, 2, -0.006, 1800),
    shareRow(22, 3, -0.006, 1800),
    ...[1, 2, 3].flatMap((from) =>
      [1, 2, 3].map((to) => transitionCell(1, from, to, from === to ? 0.6 : 0.2)),
    ),
    transitionCell(1, 1, 1, 0.1, 'transition_joint'),
  ],
  { outcome: 'ATTEND_SVCS', stat: 'change', waves: ['Y1', 'Y2'] },
)

/** A directional yes/no item (the owner's CLOSE_TO: Yes = 1 is better). */
const closeToVariable: VariableSummary = {
  ...attendVariable,
  name: 'CLOSE_TO',
  display_name: 'Someone to count on',
  scale_type: 'binary',
  direction: 'lower_better',
  min: 1,
  max: 2,
}

const closeToDetail: VariableDetail = {
  ...closeToVariable,
  value_labels: [
    { code: 1, label: 'Yes', wave: null, country_code: null, is_nonresponse: false },
    { code: 2, label: 'No', wave: null, country_code: null, is_nonresponse: false },
  ],
  missingness: [],
  scoring: null,
  components: [],
}

const closeToChange = testResponse(
  [shareRow(1, 1, 0.05, 800), shareRow(1, 2, -0.05, 800), shareRow(22, 1, 0.012, 1800)],
  { outcome: 'CLOSE_TO', stat: 'change', waves: ['Y1', 'Y2'] },
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

const tier: Routes = {
  '/data/meta.json': testMeta,
  '/data/variables.json': {
    variables: [sfiVariable, happyVariable, attendVariable, closeToVariable],
  },
  '/data/v1/HAPPY/variable.json': happyDetail,
  '/data/v1/ATTEND_SVCS/variable.json': attendDetail,
  '/data/v1/CLOSE_TO/variable.json': closeToDetail,
  '/v1/change?outcome=CLOSE_TO': closeToChange,
  '/health': okHealth,
  '/v1/change?outcome=HAPPY': happyChange,
  '/v1/change?outcome=ATTEND_SVCS': attendChange,
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

describe('Change view', () => {
  test('default output: no follow-up rate, no coverage figure, no jargon, no caution sentence', async () => {
    const calls = mockFetch(tier)
    await renderAt('/change?outcome=HAPPY')
    const figure = await screen.findByRole('img', { name: /average change among the same people/ })
    expect(figure).toBeInTheDocument()
    const text = visibleText(screen.getByRole('main'))
    // The guard: no percentage other than the interval level, no jargon,
    // and the withdrawn sentence (or anything shaped like it) stays gone.
    const percentages = text.match(/\d+(\.\d+)?\s?%/g) ?? []
    expect(percentages.filter((match) => match !== '95%')).toEqual([])
    expect(text).not.toMatch(JARGON)
    expect(text).not.toMatch(WITHDRAWN_CAUTION)
    expect(text).not.toMatch(/less certain|fewer people answered|follow-up/i)
    // Only the change request reaches the API; the earlier wave's
    // cross-section is no longer fetched for anything.
    expect(calls.filter((url) => url.includes('/v1/change'))).toHaveLength(1)
    expect(calls.some((url) => url.includes('/Y1/mean_by-country_code'))).toBe(false)
    // Plain-words copy, wave into the subtitle, sign on every change;
    // the estimate and its interval are still on the page.
    expect(screen.getAllByText(/How the same people answered a year later/).length).toBeGreaterThan(
      0,
    )
    expect(
      within(figure.closest('figure') as HTMLElement).getByText(/2023 → 2024/),
    ).toBeInTheDocument()
    fireEvent.click(screen.getAllByText('Data table')[0] as HTMLElement)
    const table = screen.getAllByRole('table')[0] as HTMLElement
    expect(within(table).getByText('+0.30')).toBeInTheDocument()
    expect(within(table).getByText('−0.12')).toBeInTheDocument()
    expect(within(table).getByText('[−0.17, −0.07]')).toBeInTheDocument()
    expect(within(table).getByText('1,500')).toBeInTheDocument()
    // The histogram waits for a country choice.
    expect(screen.getByText(/Pick up to four countries/)).toBeInTheDocument()
  })

  test('a chosen country adds the histogram of individual change, zero on the axis', async () => {
    mockFetch(tier)
    await renderAt('/change?outcome=HAPPY&countries=1')
    const bins = await screen.findByRole('img', { name: /change in their own answer/ })
    expect(bins.querySelector('svg')?.textContent).toContain('Change in the answer')
    // The dots chart's axis carries a labelled zero and signed ticks.
    const dots = screen.getByRole('img', { name: /average change among the same people/ })
    const ticks = [...(dots.querySelectorAll('[aria-label="x-axis tick label"] text') ?? [])].map(
      (node) => node.textContent,
    )
    expect(ticks).toContain('0.00')
    expect(ticks.some((tick) => tick?.startsWith('+'))).toBe(true)
  })

  test('a categorical item charts the share change at a chosen level, in percentage points', async () => {
    mockFetch(tier)
    await renderAt('/change?outcome=ATTEND_SVCS')
    const figure = await screen.findByRole('img', {
      name: /change in the share of the same people/,
    })
    const caption = figure.closest('figure') as HTMLElement
    expect(
      within(caption).getByText(
        /Change in share answering “Weekly”, percentage points · 2023 → 2024/,
      ),
    ).toBeInTheDocument()
    // Atlas's control, Atlas's default: the first labelled answer.
    const control = screen.getByRole('group', { name: 'Answer level' })
    expect(within(control).getByLabelText('Weekly')).toBeChecked()
    // No mean of codes anywhere, no histogram of individual change; the
    // value labels are signed percentage points.
    expect(screen.queryByRole('img', { name: /change in their own answer/ })).toBeNull()
    fireEvent.click(within(caption).getByText('Data table'))
    const table = within(caption).getByRole('table')
    expect(within(table).getByText('+5.0 pp')).toBeInTheDocument()
    expect(within(table).getByText('+1.2 pp')).toBeInTheDocument()
    expect(within(table).queryByText('−3.0 pp')).toBeNull() // another level's row
    // The chart's value labels carry the unit too.
    expect(figure.querySelector('svg')?.textContent).toContain('+5.0 pp')
  })

  test('a directional yes/no item says whether a rise in the share is better', async () => {
    mockFetch(tier)
    await renderAt('/change?outcome=CLOSE_TO')
    const figure = await screen.findByRole('img', {
      name: /change in the share of the same people/,
    })
    const caption = figure.closest('figure') as HTMLElement
    // Yes is the better end of a lower_better item: a rise in "Yes" is better…
    expect(
      within(caption).getByText(
        'Change in share answering “Yes”, percentage points · a rise is better · 2023 → 2024',
      ),
    ).toBeInTheDocument()
    // …and a rise in "No", the other end, is worse.
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Answer level' })).getByLabelText('No'),
    )
    expect(
      await within(caption).findByText(
        'Change in share answering “No”, percentage points · a rise is worse · 2023 → 2024',
      ),
    ).toBeInTheDocument()
  })

  test('a categorical item gets the transition heatmap for chosen countries, labels from the codebook', async () => {
    mockFetch(tier)
    await renderAt('/change?outcome=ATTEND_SVCS&countries=1')
    const moves = await screen.findByRole('img', {
      name: /share of the same people giving each later answer/,
    })
    const table = within(moves).getByRole('table')
    // The caption sits above the scrolling table, so a wide matrix never
    // widens the page to fit it; the table is labelled by it.
    expect(within(moves).getByText(/Testland — each row sums to 100%/)).toBeInTheDocument()
    expect(table).toHaveAttribute('aria-labelledby')
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['First answer ↓ · later answer →', 'Weekly', 'Sometimes', 'Never'])
    expect(within(table).getAllByText('60.0%')).toHaveLength(3)
    // Only the conditional measure is charted; the joint cell stays in
    // the data table, in words.
    fireEvent.click(within(moves.closest('figure') as HTMLElement).getByText('Data table'))
    expect(screen.getAllByText('share within the first answer').length).toBeGreaterThan(0)
  })

  test('a measure asked only once says so instead of asking the API', async () => {
    const calls = mockFetch({
      ...tier,
      '/data/variables.json': {
        variables: [
          { ...happyVariable, name: 'LONELY', display_name: 'Loneliness', waves_available: ['Y1'] },
        ],
      },
    })
    await renderAt('/change?outcome=LONELY')
    expect(await screen.findByText('Asked only once')).toBeInTheDocument()
    expect(calls.some((url) => url.includes('/v1/change'))).toBe(false)
  })

  test('one supported comparison reads as text, and the picker lists only measures asked twice', async () => {
    mockFetch({
      ...tier,
      '/data/variables.json': {
        variables: [
          sfiVariable,
          happyVariable,
          attendVariable,
          { ...happyVariable, name: 'LONELY', display_name: 'Loneliness', waves_available: ['Y1'] },
        ],
      },
    })
    await renderAt('/change?outcome=HAPPY')
    await screen.findByRole('img', { name: /average change among the same people/ })
    // No measure spans the midyear survey: no radio group, one sentence.
    expect(screen.queryByRole('group', { name: 'Compare' })).toBeNull()
    expect(
      screen.getByText(
        /The midyear survey asked different questions, so change is measured 2023 → 2024\./,
      ),
    ).toBeInTheDocument()
    // Loneliness (asked once) is not offered; the count follows.
    const measure = screen.getByLabelText('Measure', { exact: true })
    expect(within(measure).queryByRole('option', { name: 'Loneliness' })).toBeNull()
    expect(within(measure).getByRole('option', { name: 'Happiness' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search all 3 measures')).toBeInTheDocument()
    // The prompt sits beside the country control, which reads its state.
    expect(screen.getByText('Countries: all 2')).toBeInTheDocument()
    expect(screen.getByText(/Pick up to four countries/)).toBeInTheDocument()
  })

  test('comparisons reappear when a measure supports them, disabled with a reason where not', async () => {
    mockFetch({
      ...tier,
      '/data/variables.json': {
        variables: [
          sfiVariable,
          happyVariable,
          attendVariable,
          {
            ...happyVariable,
            name: 'BALANCE',
            display_name: 'Life balance',
            waves_available: ['Y1', 'MY', 'Y2'],
          },
        ],
      },
    })
    await renderAt('/change?outcome=HAPPY')
    await screen.findByRole('img', { name: /average change among the same people/ })
    const compare = screen.getByRole('group', { name: 'Compare' })
    const midyear = within(compare).getByLabelText('2023 → Midyear') as HTMLInputElement
    expect(midyear).toBeDisabled()
    expect(midyear.closest('label')).toHaveAttribute(
      'title',
      'Not asked in Midyear survey, Nov 2023–Dec 2024',
    )
    expect(within(compare).getByLabelText('2023 → 2024')).toBeChecked()
  })
})

describe('change chart helpers', () => {
  test('the fitted change window always contains a zero tick', () => {
    const entries = [
      {
        row: changeRow(1, 0.2, 10),
        level: 'a',
        facet: '',
        value: 0.2,
        ci: [0.15, 0.25] as [number, number],
      },
      {
        row: changeRow(2, 0.4, 10),
        level: 'b',
        facet: '',
        value: 0.4,
        ci: [0.35, 0.45] as [number, number],
      },
    ]
    const scale = changeScale(entries)
    expect(scale.domain[0]).toBeLessThanOrEqual(0)
    expect(scale.ticks).toContain(0)
    expect(scale.domain[1]).toBeGreaterThanOrEqual(0.45)
  })

  test('ChangeDots draws the zero rule in ink and a signed value per row', () => {
    const rows = [changeRow(22, 0.3, 1500), changeRow(1, -0.12, 200)]
    const { container } = render(
      <ChangeDots
        rows={rows}
        meta={testMeta}
        color="var(--sfi-happiness)"
        countryDomain={['United States', 'Testland']}
      />,
    )
    const svg = container.querySelector('svg')
    expect(svg?.querySelectorAll('[aria-label="rule"]').length).toBeGreaterThanOrEqual(2)
    expect(svg?.textContent).toContain('+0.30')
    expect(svg?.textContent).toContain('−0.12')
    expect(svg?.innerHTML).toContain('var(--sfi-happiness)')
    expect(svg?.innerHTML).not.toMatch(/#[0-9a-f]{6}/i)
  })

  test('orderChangeRows keeps legs together under the 2023 → 2024 order', () => {
    const rows = [
      changeRow(1, 0.1, 10, { leg: 'y1_my' }),
      changeRow(1, 0.5, 10, { leg: 'y1_y2' }),
      changeRow(22, 0.2, 10, { leg: 'y1_my' }),
      changeRow(22, 0.9, 10, { leg: 'y1_y2' }),
    ]
    const ordered = orderChangeRows(rows, testMeta, 'change', 'desc', [], ['y1_my', 'y1_y2'])
    expect(ordered.countryDomain).toEqual(['United States', 'Testland'])
    expect(ordered.rows.map((row) => [row.group['country_code'], row.leg])).toEqual([
      [22, 'y1_my'],
      [22, 'y1_y2'],
      [1, 'y1_my'],
      [1, 'y1_y2'],
    ])
    expect(changeLevels(happyVariable)).toHaveLength(21)
    expect(changeLevels({ min: null, max: null })).toEqual([])
    // Signed bucket labels wear a true minus.
    expect(signedLevel(-3)).toBe('−3')
    expect(signedLevel(2)).toBe('+2')
  })

  test('whether a rise in a share is better comes from the coded ends of a directional item', () => {
    // CLOSE_TO (Yes = 1 is better): a rise in Yes is better, in No worse.
    expect(shareRiseIsBetter(closeToVariable, 1)).toBe(true)
    expect(shareRiseIsBetter(closeToVariable, 2)).toBe(false)
    // HEALTH_PROB (No = 2 is better): a rise in Yes is worse.
    expect(shareRiseIsBetter({ direction: 'higher_better', min: 1, max: 2 }, 1)).toBe(false)
    // A middle level of an ordinal item, an undirected item, no level: no note.
    expect(shareRiseIsBetter({ direction: 'higher_better', min: 1, max: 3 }, 2)).toBeUndefined()
    expect(shareRiseIsBetter(attendVariable, 1)).toBeUndefined()
    expect(shareRiseIsBetter(closeToVariable, undefined)).toBeUndefined()
    expect(signedLevel(0)).toBe('0')
  })

  test('formatting: changes are signed, transition and change bins are shares', () => {
    expect(formatChange(0.3)).toBe('+0.30')
    expect(formatChange(-0.12)).toBe('−0.12')
    expect(formatChange(0)).toBe('0.00')
    expect(formatEstimate(0.3, 'change')).toBe('+0.30')
    expect(formatEstimate(0.25, 'change_distribution')).toBe('25.0%')
    expect(formatEstimate(0.6, 'transition')).toBe('60.0%')
    // A share change is signed and in percentage points, never "−0.0".
    expect(formatEstimate(0.05, 'change_share')).toBe('+5.0 pp')
    expect(formatEstimate(-0.031, 'change_share')).toBe('−3.1 pp')
    expect(formatEstimate(-0.0001, 'change_share')).toBe('0.0 pp')
  })

  test('TransitionTable: a k × k grid, token-only tints, every cell with its n', () => {
    const rows = [1, 2].flatMap((from) =>
      [1, 2].map((to) => transitionCell(1, from, to, from === to ? 0.7 : 0.3)),
    )
    const grid = transitionGrid(rows)
    expect(grid.levels).toEqual([1, 2])
    expect(grid.cells.size).toBe(4)
    expect(cellTint(null)).toBe('transparent')
    expect(cellTint(0)).toBe('color-mix(in srgb, var(--accent) 6%, transparent)')
    expect(cellTint(1)).toBe('color-mix(in srgb, var(--accent) 50%, transparent)')
    render(
      <TransitionTable
        rows={rows}
        levelLabel={(level) => (level === 1 ? 'Yes' : 'No')}
        caption="Testland — each row sums to 100%"
      />,
    )
    expect(screen.getAllByText('70.0%')).toHaveLength(2)
    expect(screen.getAllByText('30.0%')).toHaveLength(2)
    // The interval rides in the (styled) tooltip; the n lives in the
    // data table.
    expect(screen.queryAllByText(/n = 30/)).toHaveLength(0)
    const cells = screen.getAllByRole('cell')
    expect(cells).toHaveLength(4)
    for (const cell of cells) {
      expect(cell).not.toHaveAttribute('title')
      fireEvent.pointerEnter(cell)
      expect(screen.getByRole('tooltip').textContent).toMatch(/later said “(Yes|No)”\n95% CI \[/)
      fireEvent.pointerLeave(cell)
    }
    expect(screen.getByRole('rowheader', { name: 'Yes' })).toBeInTheDocument()
  })

  test('a three-point response facets by leg with its legs in words', () => {
    const rows = [
      changeRow(1, 0.1, 10, { leg: 'y1_my' }),
      changeRow(1, 0.2, 10, { leg: 'my_y2' }),
      changeRow(1, 0.3, 10, { leg: 'y1_y2' }),
    ]
    const { container } = render(
      <ChangeDots
        rows={rows}
        meta={testMeta}
        color="var(--series-1)"
        countryDomain={['Testland']}
        legs={['y1_my', 'my_y2', 'y1_y2']}
      />,
    )
    const text = container.querySelector('svg')?.textContent ?? ''
    expect(text).toContain('2023 → Midyear')
    expect(text).toContain('Midyear → 2024')
    expect(text).toContain('2023 → 2024')
    expect(text).not.toMatch(JARGON)
    expect(testResponseMeta().stat).toBe('mean')
  })
})
