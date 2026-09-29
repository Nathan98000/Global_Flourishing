// The six Phase 4 journeys (§2.11) over the built app + fixture tier,
// plus the Phase 5 launch-checklist journeys and the Correlates journey
// (its three views, ADR-0019). No API runs in this suite: every Phase 4 view is static-first
// (journey 6 blocks the API at the network level to prove it), and the
// API-only Phase 5/6 views are served their real synthetic responses back
// through route interception from public/data/_fixtures (written by
// `make web-fixtures`).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const API = 'http://localhost:8080'

const okHealth = {
  status: 'ok',
  service: 'flourish-atlas-api',
  version: '0.2.0',
  git_sha: 'abc1234def',
  data: 'ok',
  data_version: 'synthetic.0.0.1',
}

interface FixtureRow {
  stat: string
  n: number
  group: Record<string, string | number | boolean | null>
}

function apiFixture(name: string): { meta: Record<string, unknown>; rows: FixtureRow[] } {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'public', 'data', '_fixtures', name), 'utf8'),
  ) as { meta: Record<string, unknown>; rows: FixtureRow[] }
}

/** Serve the live-API routes from fixtures: health says the data is up. */
async function serveApi(page: Page, routes: Record<string, unknown>) {
  await page.route(`${API}/health`, (route) => route.fulfill({ json: okHealth }))
  for (const [path, body] of Object.entries(routes)) {
    await page.route(`${API}${path}**`, (route) => route.fulfill({ json: body }))
  }
}

const JARGON = /retention|attrition|panel|longitudinal|cohort|wave pair|coverage/i

const chartRegion = (page: Page) => page.getByRole('img', { name: /by country|panel per country/ })
// The chart title is the measure alone since §7 (the wave rides last in
// the subtitle), so title assertions scope to the figure's caption — the
// bare measure name also labels an <option> in the Measure select.
const caption = (page: Page) => page.locator('figcaption')

test('1 — Atlas: change topic, measure and wave, share the URL, reload reproduces it', async ({
  page,
  browser,
}) => {
  await page.goto('/')
  await expect(caption(page).getByText('Secure Flourishing Index', { exact: true })).toBeVisible()
  // The subtitle carries the rest, wave last (§7).
  await expect(
    caption(page).getByText('Average score, 0–10 · Wave 1, 2023', {
      exact: true,
    }),
  ).toBeVisible()

  // Two steps, not one list of 161: topic first, then that topic's measures.
  await page.getByLabel('Topic', { exact: true }).selectOption('wellbeing')
  await page.getByLabel('Measure', { exact: true }).selectOption('HAPPY')
  await page.getByRole('group', { name: 'Wave' }).getByText('2024', { exact: true }).click()
  await expect(caption(page).getByText('Happiness', { exact: true })).toBeVisible()
  await expect(caption(page).getByText(/Wave 2, 2024/)).toBeVisible()

  const shared = page.url()
  expect(shared).toContain('outcome=HAPPY')
  expect(shared).toContain('wave=Y2')

  // Reload reproduces the view…
  await page.reload()
  await expect(caption(page).getByText('Happiness', { exact: true })).toBeVisible()
  await expect(caption(page).getByText(/Wave 2, 2024/)).toBeVisible()

  // …and so does pasting the URL into a fresh browser context.
  const context = await browser.newContext()
  const second = await context.newPage()
  await second.goto(shared)
  await expect(caption(second).getByText('Happiness', { exact: true })).toBeVisible()
  await expect(caption(second).getByText(/Wave 2, 2024/)).toBeVisible()
  // The address bar stays canonical: defaults never reach the URL (§2.2).
  await expect(second).toHaveURL(/\?outcome=HAPPY&wave=Y2$/)
  await context.close()

  // Back returns to the previous state (the URL is the state).
  await page.goBack()
  await expect(caption(page).getByText(/Wave 1, 2023/)).toBeVisible()
  await expect(caption(page).getByText('Happiness', { exact: true })).toBeVisible()

  // A control moved: the URL changes, the page stays put (ADR-0016) — and
  // the country popover stays open while several countries are ticked in
  // a row.
  await page.evaluate('window.scrollTo(0, 240)')
  const scrolled = await page.evaluate<number>('window.scrollY')
  expect(scrolled).toBeGreaterThan(200)
  // The control's own <details> — not the "More options" fold that wraps
  // it at phone width.
  const countries = page.locator('details', {
    has: page.locator('summary', { hasText: /All \d+|selected|Choose up to/ }),
    hasNot: page.locator('summary', { hasText: 'More options' }),
  })
  const trigger = countries.locator('summary')
  const panel = countries.locator(':scope > div').first()
  const insideColumn = async () => {
    const column = await page.locator('main').boundingBox()
    const box = await panel.boundingBox()
    expect(box).not.toBeNull()
    expect(column).not.toBeNull()
    expect(box!.x + box!.width).toBeLessThanOrEqual(column!.x + column!.width + 1)
    expect(box!.x).toBeGreaterThanOrEqual(column!.x - 1)
  }
  // The trigger keeps its place and size across a selection change — a
  // label above it and a minimum width (25 Sept fix) — and the open
  // panel stays inside the page column.
  const before = await trigger.boundingBox()
  await trigger.click()
  await expect(countries).toHaveAttribute('open', '')
  await insideColumn()
  const boxes = countries.getByRole('checkbox')
  await boxes.nth(0).check()
  await expect(page).toHaveURL(/countries=1$/)
  const after = await trigger.boundingBox()
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(after![key] - before![key])).toBeLessThanOrEqual(2)
  }
  await boxes.nth(1).check()
  await expect(page).toHaveURL(/countries=1(%2C|,)22/)
  expect(Math.abs((await page.evaluate<number>('window.scrollY')) - scrolled)).toBeLessThan(4)
  await expect(countries).toHaveAttribute('open', '')

  // At phone width the control lives in the "More options" fold; its open
  // panel still stays inside the column.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByText('More options — chart, sort, countries').click()
  await trigger.click()
  await expect(countries).toHaveAttribute('open', '')
  await insideColumn()
})

test('2 — Codebook: search, open the entry, chart it, read the wording', async ({ page }) => {
  await page.goto('/codebook')
  await page.getByLabel('Search name, label or wording').fill('service attendance')
  await expect(page.getByText(/1 of \d+ questions/)).toBeVisible()

  await page.getByRole('link', { name: 'Service attendance' }).click()
  await expect(page.getByRole('heading', { name: /Service attendance/ })).toBeVisible()
  await expect(page.getByText('How would you rate: service attendance?')).toBeVisible()

  await page.getByRole('link', { name: 'Chart this →' }).click()
  await expect(page).toHaveURL(/outcome=ATTEND_SVCS/)
  await expect(caption(page).getByText('Service attendance', { exact: true })).toBeVisible()
  await expect(caption(page).getByText(/Wave 1, 2023/)).toBeVisible()

  // The question is on the page, not behind a button (decision 3), and
  // since §9 the sentence stands alone — no mini-label above it.
  await expect(page.getByText('What people were asked')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Answer codes & details →' })).toBeVisible()
  await expect(page.getByText('How would you rate: service attendance?')).toBeVisible()
})

test('3 — a small cell renders with its n and no flag, not a gap', async ({ page }) => {
  // Synthetic by-cells sit at ~27 people: under the old 50/100 rule they
  // were withheld; since ADR-0011 every cell is shown, with its n in the
  // data table so a reader can see what the number rests on.
  await page.goto('/segments?outcome=HAPPY&by=gender')
  await expect(chartRegion(page)).toBeVisible()
  await expect(chartRegion(page).getByText(/withheld/)).toHaveCount(0)

  await page.getByText('Data table', { exact: true }).click()
  const table = page.getByRole('table')
  await expect(table.getByText(/withheld|†/)).toHaveCount(0)
  // Every row carries an estimate and its n (the small cells included).
  const cells = await table.locator('tbody tr').count()
  expect(cells).toBeGreaterThan(0)
})

test('4 — CSV export downloads with the # meta header lines', async ({ page }) => {
  // With no API running, this exercises the client-side fallback, which
  // is byte-compatible with /v1/export.csv (unit-tested against a real
  // server response).
  await page.goto('/?outcome=HAPPY')
  await expect(caption(page).getByText('Happiness', { exact: true })).toBeVisible()
  await expect(caption(page).getByText(/Wave 1, 2023/)).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'CSV' }).click()
  const download = await downloadPromise
  // The name in words (ADR-0016): display name, view, wave — no code, no version.
  expect(download.suggestedFilename()).toBe('flourish-atlas_happiness_by-country_2023.csv')

  const body = await streamToString(download)
  expect(body).toContain('# data_version: synthetic.0.0.1')
  expect(body).toContain('# outcome: HAPPY')
  expect(body).toContain('# suppression: none (all cells shown)')
  expect(body.split('\n').find((line) => !line.startsWith('#'))).toContain(
    'country_code,stat,estimate',
  )
})

test('5 — dark mode toggles and survives a reload', async ({ page }) => {
  await page.goto('/')
  const html = page.locator('html')
  await expect(html).not.toHaveAttribute('data-theme', 'dark')

  // The button names its action (F15).
  await page.getByRole('button', { name: 'Switch to dark' }).click()
  await expect(html).toHaveAttribute('data-theme', 'dark')

  await page.reload()
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('button', { name: 'Switch to light' })).toBeVisible()

  await page.getByRole('button', { name: 'Switch to light' }).click()
  await expect(html).toHaveAttribute('data-theme', 'light')
})

test('6 — with the API blocked at the network level, the Atlas still renders and says so', async ({
  page,
}) => {
  await page.route('http://localhost:8080/**', (route) => route.abort())

  await page.goto('/')
  // The chart renders from the static tier…
  await expect(caption(page).getByText('Secure Flourishing Index', { exact: true })).toBeVisible()
  await expect(caption(page).getByText(/Wave 1, 2023/)).toBeVisible()
  await expect(chartRegion(page)).toBeVisible()
  // …and the app says so in plain words (F6).
  await expect(page.getByText(/Live data service is offline/)).toBeVisible()
  await expect(page.getByText(/standard views still work/)).toBeVisible()
})

test('7 — Change with a country where fewer people answered again: the interval and n carry it, no sentence, no rate', async ({
  page,
}) => {
  // The synthetic Testland keeps two thirds of its first-wave group;
  // shrink its follow-up group to a fifth — fixture rows, never real
  // data. The view must show its estimate and interval like any other
  // country's: no caution sentence (withdrawn — ADR-0013, revised), no
  // rate, no jargon; the n rides in the data table.
  const change = apiFixture('change-HAPPY-Y1-Y2.json')
  for (const row of change.rows) {
    if (row.stat === 'change' && row.group['country_code'] === 1) row.n = 10
  }
  await serveApi(page, { '/v1/change': change })

  await page.goto('/change?outcome=HAPPY')
  await expect(caption(page).first().getByText('Happiness', { exact: true })).toBeVisible()
  await expect(
    caption(page)
      .first()
      .getByText(/2023 → 2024/),
  ).toBeVisible()
  const figure = page.getByRole('img', { name: /average change among the same people/ })
  await expect(figure).toBeVisible()

  // The withdrawn sentence is absent, and nothing shaped like it.
  await expect(
    page.getByText(
      'In some countries fewer people answered the second time, so those estimates are less certain.',
    ),
  ).toHaveCount(0)
  const text = await page.locator('main').innerText()
  expect(text).not.toMatch(/less certain|fewer people answered|follow-up/i)
  expect(text).not.toMatch(JARGON)
  // No retention or coverage percentage: the only "%" on the page is the
  // interval level in the footnote.
  expect((text.match(/\d+(\.\d+)?\s?%/g) ?? []).filter((match) => match !== '95%')).toEqual([])
  expect(await figure.innerText()).not.toMatch(/%/)

  // The estimate and its interval still appear, and the n is one click
  // away on every table row.
  await expect(figure.getByText(/^[+−]\d\.\d\d$/).first()).toBeVisible()
  await page.getByText('Data table', { exact: true }).first().click()
  const table = page.getByRole('table').first()
  await expect(table.getByRole('columnheader', { name: 'Estimate' })).toBeVisible()
  await expect(table.getByRole('columnheader', { name: '95% CI' })).toBeVisible()
  await expect(table.getByRole('columnheader', { name: 'n', exact: true })).toBeVisible()
  await expect(table.getByText('10', { exact: true })).toBeVisible()
  await expect(table.getByText(/^\[[+−]\d\.\d\d, [+−]\d\.\d\d\]$/).first()).toBeVisible()

  // The URL is the state.
  await page.getByRole('group', { name: 'Sort' }).getByText('A–Z', { exact: true }).click()
  await expect(page).toHaveURL(/outcome=HAPPY&sort=name$/)
})

test('8 — What Matters with a combined-midyear country: one view at a time — the matrix, the split, the other questions — no jargon', async ({
  page,
}) => {
  // The synthetic release administers the midyear survey both ways in
  // every country (half its midyear respondents answered inside the Wave
  // 2 interview), so the United States stands for a combined-midyear
  // country here; its midyear answers are ordinary cross-sections on the
  // midyear weight, and the view must show them without a word about
  // administration modes.
  await page.route(`${API}/health`, (route) => route.fulfill({ json: okHealth }))
  await page.goto('/what-matters')
  const views = page.getByRole('group', { name: 'View' })

  // By country, the default: the matrix alone — countries down, the
  // importance items across.
  await expect(
    caption(page).getByText('What matters most, by country', { exact: true }),
  ).toBeVisible()
  await expect(caption(page).getByText(/Midyear survey, Nov 2023–Dec 2024/)).toBeVisible()
  const matrix = page.getByRole('img', {
    name: /How important people rate 1 item in each of 2 countries, as a matrix/,
  })
  await expect(matrix).toBeVisible()
  await expect(matrix.getByRole('rowheader', { name: 'United States' })).toBeVisible()
  await expect(page.locator('figure')).toHaveCount(1)
  // A switcher, not anchors; the crossings section is gone.
  await expect(page.getByRole('navigation', { name: 'On this page' })).toHaveCount(0)
  await expect(page.getByText(/Two things that travel together/)).toHaveCount(0)

  const text = await page.locator('main').innerText()
  expect(text).not.toMatch(JARGON)
  expect(text).not.toMatch(/midyear_type|standalone|combined/i)

  // The n rides on every row of the data table.
  await page.getByText('Data table', { exact: true }).click()
  const table = page.locator('details').first().getByRole('table')
  await expect(table.getByRole('columnheader', { name: 'n', exact: true })).toBeVisible()
  await expect(table.getByRole('columnheader', { name: 'Measure' })).toBeVisible()

  // Within a country: the United States unless another is chosen, its
  // age bands as the matrix's rows, alone on screen.
  await views.getByText('Within a country', { exact: true }).click()
  await expect(page).toHaveURL(/\/what-matters\?view=within$/)
  const split = page.getByRole('img', {
    name: /United States: how important people rate 1 item, as a matrix: a row per age band/,
  })
  await expect(split).toBeVisible()
  await expect(split.getByRole('rowheader').first()).toBeVisible()
  await expect(caption(page).getByText('United States by age band', { exact: true })).toBeVisible()
  await expect(page.locator('figure')).toHaveCount(1)
  // The URL is the state: the split column round-trips.
  await page.getByLabel('Split by').selectOption('gender')
  await expect(page).toHaveURL(/view=within&by=gender$/)
  await expect(page.getByRole('img', { name: /a row per gender/ })).toBeVisible()

  // Other questions: one question's bar chart, alone on screen — the
  // synthetic family's one chartable item, Daily social media time.
  await views.getByText('Other questions', { exact: true }).click()
  const question = page.getByRole('img', { name: /Daily social media time/ })
  await expect(question).toBeVisible()
  // Rounded bars render as paths in Plot's "bar" mark group.
  await expect(question.locator('[aria-label="bar"] > *').first()).toBeVisible()
  await expect(page.locator('figure')).toHaveCount(1)
  expect(await page.locator('main').innerText()).not.toMatch(JARGON)
})

test('9 — US States: the map on state weights loads its own topology chunk, beside the national figure', async ({
  page,
}) => {
  await serveApi(page, {
    '/v1/states': apiFixture('states-HAPPY-Y1.json'),
    // The whole US on the state weight, which the states are read against.
    '/v1/aggregate': apiFixture('states-HAPPY-Y1-overall.json'),
  })
  await page.goto('/states?outcome=HAPPY')
  await expect(caption(page).getByText('Happiness', { exact: true })).toBeVisible()
  await expect(caption(page).getByText(/state weights · Wave 1, 2023/)).toBeVisible()
  await expect(page.getByText(/US overall \(state weights\)/).first()).toBeVisible()
  await expect(page.getByText(/On the national weight, the US overall figure is/)).toBeVisible()
  // The map's own topology arrives as a lazy asset, never in the initial route.
  const figure = page.getByRole('img', { name: /Happiness by US state/ })
  await expect(figure).toBeVisible()
  await expect(figure.locator('svg path').first()).toBeVisible()
  await expect(page.getByText('no estimate', { exact: true })).toBeVisible()
  // Adjusted weights are unavailable on Wave 1, with the reason.
  await expect(page.getByLabel(/Adjusted state weights/)).toBeDisabled()
  await expect(page.getByText(/no adjusted state weight for Wave 1, 2023/)).toBeVisible()
  // The chart view and the table carry the server's state codes.
  await page.getByRole('group', { name: 'View' }).getByText('Chart', { exact: true }).click()
  await expect(page).toHaveURL(/outcome=HAPPY&view=bars$/)
  await page.getByText('Data table', { exact: true }).click()
  const table = page.getByRole('table')
  await expect(table.getByRole('columnheader', { name: 'State' })).toBeVisible()
  await expect(table.getByText('California', { exact: true })).toBeVisible()
  await expect(page.getByText(/weighted so each state's sample/).first()).toBeVisible()
})

/** A fixture by name, or a 404 the page will show — never a silent stand-in. */
function fixtureOr404(name: string) {
  try {
    return { json: apiFixture(name) }
  } catch {
    return { status: 404, json: { detail: `no fixture ${name}` } }
  }
}

interface JourneyPlan {
  picked: { name: string; display_name: string }
  default: string[]
  added: { name: string; display_name: string }[]
  kept: string[]
  order: string[]
  /** The table's first cell: its column (Compare two's first question) and row. */
  cell: { name: string; display_name: string }[]
  related: { name: string; display_name: string }
  /** Compare several's default table, every country averaged (ADR-0020). */
  pooled_default: string[]
  /** The midyear question the page brings in at Midyear (ADR-0020). */
  midyear: { name: string; display_name: string }
}

/** Where and when a request is taken, as scripts/web_fixtures.py names
 * its fixture: the wave when not Wave 1, the other answers' wave, and
 * "all" when every country is averaged (ADR-0020). */
function scopeOf(url: URL, withWave = true): string {
  const wave = url.searchParams.get('wave') ?? 'Y1'
  return [
    withWave && wave !== 'Y1' ? wave : null,
    url.searchParams.get('other_wave'),
    url.searchParams.get('pooled') ? 'all' : null,
  ]
    .filter(Boolean)
    .map((part) => `-${part}`)
    .join('')
}

test('10 — Correlates by task: Compare two and its picker, Swap, country by country, Compare several, Find related, old links, All countries, Midyear', async ({
  page,
}) => {
  // Every request is answered by the synthetic response made for it,
  // named from the request's own parameters; scripts/web_fixtures.py
  // plans the path and writes it down (journey-10.json).
  const plan = JSON.parse(
    readFileSync(join(process.cwd(), 'public', 'data', '_fixtures', 'journey-10.json'), 'utf8'),
  ) as JourneyPlan
  await page.route(`${API}/health`, (route) => route.fulfill({ json: okHealth }))
  await page.route(`${API}/v1/correlates**`, (route) => {
    const url = new URL(route.request().url())
    const outcome = url.searchParams.get('outcome')
    const wave = url.searchParams.get('wave') ?? 'Y1'
    const against = url.searchParams.getAll('against')
    const shape = url.searchParams.getAll('by').includes('country_code') ? 'across' : 'ranked'
    const one = against.length === 1 ? `-${against[0]}` : ''
    return route.fulfill(
      fixtureOr404(`correlates-${outcome}-${wave}${scopeOf(url, false)}-${shape}${one}.json`),
    )
  })
  await page.route(`${API}/v1/correlations/pair**`, (route) => {
    const url = new URL(route.request().url())
    return route.fulfill(
      fixtureOr404(
        `correlations-pair-${url.searchParams.get('y')}-${url.searchParams.get('x')}${scopeOf(url)}.json`,
      ),
    )
  })
  await page.route(
    (url) => url.pathname === '/v1/correlations',
    (route) => {
      const url = new URL(route.request().url())
      return route.fulfill(
        fixtureOr404(
          `correlations-table-${url.searchParams.getAll('vars').join('-')}${scopeOf(url)}.json`,
        ),
      )
    },
  )
  const views = page.getByRole('group', { name: 'View' })

  // A first visit lands on Compare two with the default pair: the grid,
  // one SVG, shares in its cells.
  await page.goto('/correlates')
  await expect(views.getByLabel('Compare two')).toBeChecked()
  await expect(
    caption(page).getByText('Life evaluation today and Feelings about household income', {
      exact: true,
    }),
  ).toBeVisible()
  const grid = page.getByRole('img', {
    name: /^Life evaluation today and Feelings about household income in United States/,
  })
  await expect(grid.locator('svg')).toHaveCount(1)
  await expect(
    grid
      .locator('svg text')
      .filter({ hasText: /^\d+%\*?$/ })
      .first(),
  ).toBeVisible()
  await expect(page.getByText('Correlation', { exact: true })).toBeVisible()
  expect(await page.locator('main').innerText()).not.toMatch(/cause/i)

  // The picker: browse a topic, then search, then pick.
  await page.getByRole('button', { name: 'First question: Life evaluation today' }).click()
  const picker = page.getByRole('dialog', { name: 'First question' })
  await expect(picker.getByRole('searchbox')).toBeFocused()
  await picker.getByRole('option', { name: /^Religion & spirituality/ }).click()
  await expect(
    picker
      .getByRole('listbox', { name: 'Religion & spirituality questions' })
      .getByRole('option', { name: 'Service attendance', exact: true }),
  ).toBeVisible()
  await picker.getByRole('searchbox').fill('happi')
  await picker
    .getByRole('listbox', { name: 'Search results' })
    .getByRole('option', { name: plan.picked.display_name, exact: true })
    .click()
  await expect(picker).toBeHidden()
  await expect(page).toHaveURL(new RegExp(`\\?a=${plan.picked.name}$`))
  await expect(
    caption(page).getByText(`${plan.picked.display_name} and Feelings about household income`, {
      exact: true,
    }),
  ).toBeVisible()

  // Swap.
  await page.getByRole('button', { name: 'Swap' }).click()
  await expect(page).toHaveURL(new RegExp(`\\?a=INCOME_FEELINGS&b=${plan.picked.name}$`))
  await expect(
    caption(page).getByText(`Feelings about household income and ${plan.picked.display_name}`, {
      exact: true,
    }),
  ).toBeVisible()

  // Country by country: one dot per country, the grid gone; then back.
  await page.getByText('Country by country', { exact: true }).click()
  await expect(page).toHaveURL(/scope=all/)
  await expect(
    page.getByRole('img', { name: /their correlation in each of 2 countries/ }),
  ).toBeVisible()
  await expect(page.getByText('Share of each column (columns add to 100%)')).toBeHidden()
  await page.getByText('In United States', { exact: true }).click()
  await expect(page).not.toHaveURL(/scope=/)

  // Compare several: the pair and the first question's top four.
  await views.getByText('Compare several', { exact: true }).click()
  await expect(
    page.getByRole('list', { name: `Questions in the table · ${plan.default.length} of 10` }),
  ).toBeVisible()
  // Add two with the multi-select picker.
  await page.getByRole('button', { name: 'Add questions' }).click()
  const adding = page.getByRole('dialog', { name: 'Add questions' })
  for (const question of plan.added) {
    await adding.getByRole('searchbox').fill(question.display_name.slice(0, 7).toLowerCase())
    await adding.getByRole('option', { name: question.display_name, exact: true }).click()
  }
  await expect(
    adding.getByText(`2 selected · room for ${8 - plan.default.length} more`),
  ).toBeVisible()
  await adding.getByRole('button', { name: 'Add 2 to the table' }).click()
  await expect(
    page.getByRole('list', { name: `Questions in the table · ${plan.default.length + 2} of 10` }),
  ).toBeVisible()
  // Remove one.
  await page.getByRole('button', { name: `Remove ${plan.added[0]?.display_name}` }).click()
  const table = page.getByRole('group', {
    name: `Correlations among ${plan.kept.length} questions`,
  })
  await expect(table.getByRole('table')).toBeVisible()
  // Similar together: the server's order, the first column first.
  await page.getByText('Similar together', { exact: true }).click()
  await expect(page).toHaveURL(/order=similar/)
  await expect(table.getByRole('columnheader').nth(1)).toHaveText(
    plan.order[0] === 'INCOME_FEELINGS' ? 'Feelings about household income' : /./,
  )
  // Select a cell: Compare two, the column first and the row second (a
  // second question that is the first's default stays out of the URL).
  const [column, row] = plan.cell
  await table
    .getByRole('button', { name: /: see the two questions together$/ })
    .first()
    .click()
  await expect(views.getByLabel('Compare two')).toBeChecked()
  await expect(page).toHaveURL(new RegExp(`\\?a=${column?.name}&`))
  await expect(
    caption(page).getByText(`${column?.display_name} and ${row?.display_name}`, { exact: true }),
  ).toBeVisible()

  // Find related: that first question's strongest correlates; a row
  // opens Compare two.
  await views.getByText('Find related', { exact: true }).click()
  const ranked = page.getByRole('group', {
    name: /questions most strongly associated with it in United States/,
  })
  await expect(ranked).toBeVisible()
  await expect(ranked.getByText(/^[+−]\d\.\d\d\*?$/).first()).toBeVisible()
  await ranked.getByRole('button', { name: new RegExp(`^${plan.related.display_name}, `) }).click()
  await expect(views.getByLabel('Compare two')).toBeChecked()
  await expect(page).toHaveURL(new RegExp(`\\?a=${column?.name}`))
  await expect(
    caption(page).getByText(`${column?.display_name} and ${plan.related.display_name}`, {
      exact: true,
    }),
  ).toBeVisible()

  // Old links land on the right view.
  await page.goto('/correlates?view=ranked&outcome=HAPPY')
  await expect(views.getByLabel('Find related')).toBeChecked()
  await expect(
    page.getByRole('group', { name: /^Happiness: the \d+ questions most strongly associated/ }),
  ).toBeVisible()
  await page.goto('/correlates?view=countries&outcome=HAPPY')
  await expect(views.getByLabel('Find related')).toBeChecked()
  await expect(page.getByLabel('Country by country')).toBeChecked()
  const matrix = page.getByRole('img', { name: /as a matrix/ })
  await expect(matrix).toBeVisible()
  await expect(matrix.getByRole('columnheader').nth(1)).toHaveText('United States')
  expect(await page.locator('main').innerText()).not.toMatch(JARGON)

  // All countries (ADR-0020): every view averages the countries.
  await page.goto('/correlates?country=all')
  await expect(
    page.getByText('All countries (average of 2) · Wave 1, 2023', { exact: true }),
  ).toBeVisible()
  const where = page.getByRole('group', { name: 'Where' })
  await expect(where.getByLabel('All countries', { exact: true })).toBeChecked()
  await expect(
    page.getByRole('img', {
      name: /Feelings about household income, averaged over 2 countries/,
    }),
  ).toBeVisible()
  // Country by country: every country, none picked out; the strip reads the average.
  await where.getByText('Country by country', { exact: true }).click()
  const pooledAcross = page.getByRole('img', { name: /their correlation in each of 2 countries/ })
  await expect(pooledAcross).toBeVisible()
  expect(await pooledAcross.innerHTML()).not.toContain('var(--control-selected)')
  await expect(page.getByText('Correlation', { exact: true })).toBeVisible()
  await where.getByText('All countries', { exact: true }).click()
  await views.getByText('Compare several', { exact: true }).click()
  await expect(
    page.getByRole('group', {
      name: new RegExp(
        `^Correlations among ${plan.pooled_default.length} questions averaged over 2 countries`,
      ),
    }),
  ).toBeVisible()
  await views.getByText('Find related', { exact: true }).click()
  await expect(
    page.getByRole('group', {
      name: /questions most strongly associated with it in all countries \(their average\)/,
    }),
  ).toBeVisible()

  // Midyear from the chip: the midyear question beside the same people's
  // 2023 answers, then 2024's; back at 2023 the default returns — and the
  // line under the row says each time what changed on its own.
  await page.goto('/correlates')
  const wave = page.getByRole('group', { name: 'Wave' })
  await wave.getByText('Midyear', { exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`\\?a=${plan.midyear.name}&wave=MY$`))
  await expect(
    page.getByText(
      `${plan.midyear.display_name}, from the midyear survey, took the place of Life evaluation today.`,
    ),
  ).toBeVisible()
  await expect(
    page.getByText('United States · Midyear survey, with 2023 answers from the same people', {
      exact: true,
    }),
  ).toBeVisible()
  // The year of the other answers is chosen in the note's own sentence,
  // worded for the country on screen (the synthetic US took the midyear
  // survey both ways).
  const other = page.getByRole('combobox', { name: 'Year of the other answers' })
  await expect(page.getByText(/^The other question uses the same people’s/)).toContainText(
    'answers, usually given 8–12 months earlier.',
  )
  await other.selectOption('Y2')
  await expect(page).toHaveURL(/other=Y2/)
  await expect(page.getByText(/^The other question uses the same people’s/)).toContainText(
    'answers, from the same interview for some people, about six months later for others.',
  )
  await expect(
    page.getByText('United States · Midyear survey, with 2024 answers from the same people', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByRole('img', {
      name: new RegExp(`^${plan.midyear.display_name} and Feelings about household income in`),
    }),
  ).toBeVisible()
  await wave.getByText('2023', { exact: true }).click()
  await expect(page).toHaveURL(/\/correlates$/)
  await expect(
    page.getByText(
      `${plan.midyear.display_name} was asked only in the midyear survey, so Life evaluation today took its place.`,
    ),
  ).toBeVisible()

  // Midyear from the picker: a midyear question picked at 2023 takes the
  // page to Midyear.
  await page.goto('/correlates?view=related&outcome=HAPPY')
  await page.getByRole('button', { name: 'Question: Happiness' }).click()
  const questionPicker = page.getByRole('dialog', { name: 'Question' })
  await questionPicker.getByRole('searchbox').fill('social')
  await questionPicker
    .getByRole('option', { name: `${plan.midyear.display_name}, Midyear`, exact: true })
    .click()
  await expect(page).toHaveURL(new RegExp(`outcome=${plan.midyear.name}&wave=MY`))
  await expect(
    page.getByText(
      `${plan.midyear.display_name} is a midyear question, so the page switched to Midyear.`,
    ),
  ).toBeVisible()
  await expect(
    page.getByRole('group', {
      name: new RegExp(
        `^${plan.midyear.display_name}: the \\d+ questions most strongly associated`,
      ),
    }),
  ).toBeVisible()
})

async function streamToString(download: {
  createReadStream: () => Promise<NodeJS.ReadableStream>
}): Promise<string> {
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer))
  return Buffer.concat(chunks).toString('utf8')
}
