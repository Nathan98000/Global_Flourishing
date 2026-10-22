// The six Phase 4 journeys (§2.11) over the built app + fixture tier,
// plus the Phase 5 launch-checklist journeys, the Correlates journey
// (its three views, ADR-0019) and the phone-width rule (journeys 11 and
// 12: no page scrolls sideways). No API runs in this suite: every Phase 4 view is static-first
// (journey 6 blocks the API at the network level to prove it), and the
// API-only Phase 5/6 views are served their real synthetic responses back
// through route interception from public/data/_fixtures (written by
// `make web-fixtures`).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page, type Route } from '@playwright/test'

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

/** A fixture `make web-fixtures` wrote, whatever its shape. */
function jsonFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', '_fixtures', name), 'utf8'))
}

function apiFixture(name: string): { meta: Record<string, unknown>; rows: FixtureRow[] } {
  return jsonFixture(name) as { meta: Record<string, unknown>; rows: FixtureRow[] }
}

/** A file of the static tier `make web-fixtures` wrote, by its path under
 * public/data — what the app itself fetches from /data. */
function tierFile(path: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', path), 'utf8'))
}

/** Serve the live-API routes from fixtures: health says the data is up. */
async function serveApi(page: Page, routes: Record<string, unknown>) {
  await page.route(`${API}/health`, (route) => route.fulfill({ json: okHealth }))
  for (const [path, body] of Object.entries(routes)) {
    await page.route(`${API}${path}**`, (route) => route.fulfill({ json: body }))
  }
}

const JARGON = /retention|attrition|panel|longitudinal|cohort|wave pair|coverage/i

// The Atlas's ranked chart and Segments' panels are groups, their rows
// read by keyboard (ADR-0032, ADR-0033).
const chartRegion = (page: Page) =>
  page.getByRole('group', { name: /by country|panel per country/ })
// The chart title is the measure alone since §7 (the wave rides last in
// the subtitle), so title assertions scope to the figure's caption — the
// bare measure name also labels the question picker's button.
const caption = (page: Page) => page.locator('figcaption')

test('1 — Atlas: change the question through the picker and the year, share the URL, reload reproduces it', async ({
  page,
  browser,
}) => {
  await page.goto('/')
  await expect(caption(page).getByText('Secure Flourishing Index', { exact: true })).toBeVisible()
  // The subtitle carries the rest, wave last (§7).
  await expect(
    caption(page).getByText('Mean score, 0–10 · 2023 · all countries · highest first', {
      exact: true,
    }),
  ).toBeVisible()

  // One question picker (ADR-0029): the question bar's button opens the
  // panel — browse a topic, pick a question — and a pick closes it.
  await page.getByRole('button', { name: 'Question: Secure Flourishing Index' }).click()
  const picker = page.getByRole('dialog', { name: 'Question' })
  await picker.getByRole('option', { name: /^Wellbeing/ }).click()
  await picker
    .getByRole('listbox', { name: 'Wellbeing questions' })
    .getByRole('option', { name: /^Happiness/ })
    .click()
  await expect(picker).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Question: Happiness' })).toBeVisible()
  await page.getByRole('group', { name: 'Year' }).getByText('2024', { exact: true }).click()
  await expect(caption(page).getByText('Happiness', { exact: true })).toBeVisible()
  await expect(caption(page).getByText(/· 2024/)).toBeVisible()

  const shared = page.url()
  expect(shared).toContain('outcome=HAPPY')
  expect(shared).toContain('wave=Y2')

  // Reload reproduces the view…
  await page.reload()
  await expect(caption(page).getByText('Happiness', { exact: true })).toBeVisible()
  await expect(caption(page).getByText(/· 2024/)).toBeVisible()

  // …and so does pasting the URL into a fresh browser context.
  const context = await browser.newContext()
  const second = await context.newPage()
  await second.goto(shared)
  await expect(caption(second).getByText('Happiness', { exact: true })).toBeVisible()
  await expect(caption(second).getByText(/· 2024/)).toBeVisible()
  // The address bar stays canonical: defaults never reach the URL (§2.2).
  await expect(second).toHaveURL(/\?outcome=HAPPY&wave=Y2$/)
  await context.close()

  // Back returns to the previous state (the URL is the state).
  await page.goBack()
  await expect(caption(page).getByText(/· 2023/)).toBeVisible()
  await expect(caption(page).getByText('Happiness', { exact: true })).toBeVisible()

  // A control moved: the URL changes, the page stays put (ADR-0016) — and
  // the country popover stays open while several countries are ticked in
  // a row.
  // (The question bar is one row now, and no band stands above the page
  // offline (H6): the fixture page scrolls less.)
  await page.evaluate('window.scrollTo(0, 50)')
  const scrolled = await page.evaluate<number>('window.scrollY')
  expect(scrolled).toBeGreaterThan(30)
  // The control's own <details> — not the "More options" fold that wraps
  // it at phone width.
  const countries = page.locator('details', {
    has: page.locator('summary', { hasText: /countr/ }),
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
  await expect(trigger).toHaveText('Countries: All countries')
  await trigger.click()
  await expect(countries).toHaveAttribute('open', '')
  await insideColumn()
  // "All countries" first; "Choose countries" brings the ticks (F20).
  await expect(countries.getByRole('radio', { name: 'All countries' })).toBeChecked()
  await expect(countries.getByRole('checkbox')).toHaveCount(0)
  await countries.getByRole('radio', { name: 'Choose countries' }).check()
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

  // At phone width the countries live in the options sheet, in place —
  // the two chosen still ticked (every country of the fixture's two, so
  // "all countries") — and the sheet stays inside the page.
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByText('Mean · all countries · highest first')).toBeVisible()
  await page.getByRole('button', { name: 'Options' }).click()
  const sheet = page.getByRole('dialog', { name: 'Chart options' })
  await expect(sheet.getByRole('radio', { name: 'Choose countries' })).toBeChecked()
  await expect(sheet.getByRole('checkbox', { checked: true })).toHaveCount(2)
  const sheetBox = await sheet.boundingBox()
  expect(sheetBox!.x).toBeGreaterThanOrEqual(0)
  expect(sheetBox!.x + sheetBox!.width).toBeLessThanOrEqual(390)
})

test('2 — Codebook: reached from Methods, search, open the entry, chart it, read the wording', async ({
  page,
}) => {
  // The Codebook is not in the nav; Methods links to it, and stays the
  // nav's current item while it is open (ADR-0021).
  await page.goto('/methods')
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link', { name: 'Codebook' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Browse the Codebook →' }).click()
  await expect(page).toHaveURL(/\/codebook$/)
  await expect(nav.getByRole('link', { name: 'Methods' })).toHaveAttribute('data-status', 'active')
  await page.getByLabel('Search name, label or wording').fill('service attendance')
  await expect(page.getByText(/1 of \d+ questions/)).toBeVisible()

  await page.getByRole('link', { name: 'Service attendance' }).click()
  await expect(page.getByRole('heading', { name: /Service attendance/ })).toBeVisible()
  await expect(page.getByText('How would you rate: service attendance?')).toBeVisible()

  await page.getByRole('link', { name: 'Chart this →' }).click()
  await expect(page).toHaveURL(/outcome=ATTEND_SVCS/)
  await expect(caption(page).getByText('Service attendance', { exact: true })).toBeVisible()
  await expect(caption(page).getByText(/· 2023/)).toBeVisible()

  // The question is on the page, not behind a button (decision 3), and
  // since §9 the sentence stands alone — no mini-label above it.
  await expect(page.getByText('What people were asked')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'The exact question and answers →' })).toBeVisible()
  // The wording under the chart's header (the question bar's button
  // shows the name alone, G13).
  await expect(
    page.locator('figure').getByText('How would you rate: service attendance?'),
  ).toBeVisible()
})

test('3 — a small cell renders hollow with its hover card, which says few people are behind it — not a gap', async ({
  page,
}) => {
  // Synthetic by-cells sit at ~27 people: under the old 50/100 rule they
  // were withheld; since ADR-0011 every cell is shown, and under 30 people
  // it is drawn hollow, its card saying so (ADR-0031). The page shows the
  // chart alone (ADR-0022): no data table, each dot's card its numbers.
  await page.goto('/segments?outcome=HAPPY&by=gender')
  await expect(chartRegion(page)).toBeVisible()
  await expect(chartRegion(page).getByText(/withheld/)).toHaveCount(0)
  await expect(page.getByText('Data table', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('cell')).toHaveCount(0)

  // A thin dot's hover card (a hollow dot, ADR-0031): the country first,
  // set apart, then the level by its breakdown, the mean, its CI, how many
  // people it rests on, and that few people do.
  await chartRegion(page).locator('svg circle[fill="var(--surface)"]').first().hover()
  const tip = chartRegion(page).locator('g[aria-label="tip"] text')
  await expect(tip).toContainText('Gender:')
  await expect(tip).toContainText('Mean:')
  await expect(tip).toContainText(/95% CI: (\[.+\]|none)/)
  await expect(tip).toContainText(/Based on \d[\d,]* (person|people)/)
  await expect(tip).toContainText('Few people — treat with care')
  await expect(tip).not.toContainText(/average|likely range/i)
  // The key says what the hollow dot means.
  await expect(page.locator('main figure').getByText('* fewer than 30 people')).toBeVisible()
  await expect(tip.locator(':scope > tspan').first()).toHaveAttribute('font-weight', '600')
})

test('4 — CSV export downloads from the chart header’s Download menu with the # meta header lines', async ({
  page,
}) => {
  // The CSV is built from the chart's own rows on every tier (G8),
  // byte-compatible with /v1/export.csv (unit-tested against a real
  // server response).
  await page.goto('/?outcome=HAPPY')
  await expect(caption(page).getByText('Happiness', { exact: true })).toBeVisible()
  await expect(caption(page).getByText(/· 2023/)).toBeVisible()

  // One "Download" in the chart's header (ADR-0029): CSV, then PNG.
  await page.getByRole('button', { name: 'Download', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download CSV' }).click()
  const download = await downloadPromise
  // The name in words (ADR-0016): display name, view, wave — no code, no version.
  expect(download.suggestedFilename()).toBe('flourish-atlas_happiness_by-country_2023.csv')

  const body = await streamToString(download)
  expect(body).toContain('# data_version: synthetic.0.0.1')
  expect(body).toContain('# outcome: HAPPY')
  expect(body).toContain('# suppression: none (all cells shown); n<30 flagged')
  // Each country's code, then its name (G8).
  expect(body.split('\n').find((line) => !line.startsWith('#'))).toContain(
    'country_code,country,stat,estimate',
  )
})

test('5 — one light theme, whatever the OS prefers', async ({ page }) => {
  // There is no dark mode (ADR-0023): an OS that prefers dark still gets
  // the warm paper page, and the header has no theme switch.
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await expect(caption(page).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Switch to (dark|light)/ })).toHaveCount(0)
  expect(await page.evaluate<string>('getComputedStyle(document.body).backgroundColor')).toBe(
    'rgb(246, 244, 238)',
  )
  expect(
    await page.evaluate<string>('getComputedStyle(document.documentElement).colorScheme'),
  ).toBe('light')
})

test('6 — with the API blocked at the network level, the Atlas still renders, nothing moves, and the nav says which pages need the service', async ({
  page,
}) => {
  await page.route('http://localhost:8080/**', (route) => route.abort())
  // Every layout shift the page makes, as Lighthouse counts them.
  await page.addInitScript(`
    window.__layoutShift = 0
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__layoutShift += entry.value
      }
    }).observe({ type: 'layout-shift', buffered: true })
  `)

  await page.goto('/')
  // The chart renders from the static tier…
  await expect(caption(page).getByText('Secure Flourishing Index', { exact: true })).toBeVisible()
  await expect(caption(page).getByText(/· 2023/)).toBeVisible()
  await expect(chartRegion(page)).toBeVisible()
  // …and once the health check has failed twice (H6), the nav marks the
  // pages that need the live service, the reason in each link's name.
  const nav = page.getByRole('navigation', { name: 'Main' })
  for (const name of ['Change', 'Correlates', 'US States']) {
    await expect(
      nav.getByRole('link', { name: `${name} — needs the live data service, offline right now` }),
    ).toBeVisible()
  }
  await expect(nav.getByRole('link', { name: 'Segments', exact: true })).toBeVisible()
  // Nothing is inserted above the page: the page never moves for it.
  expect(await page.evaluate('document.querySelector("main").previousElementSibling.tagName')).toBe(
    'HEADER',
  )
  await expect(page.getByText(/Some views need the live data service/)).toHaveCount(0)
  await expect(page.getByText(/filters (and medians )?are unavailable/)).toHaveCount(0)
  // Median keeps its own reason, in its line held from the first failed
  // check — the chart drawn meanwhile does not move down for it.
  await expect(page.getByText('Median — needs the live data service.')).toBeVisible()
  expect(await page.evaluate<number>('window.__layoutShift')).toBeLessThan(0.1)

  // A median link offline shows the mean, says why, and blames no one:
  // Median is unavailable, with its reason in view.
  await page.goto('/?stat=median')
  await expect(
    page.getByText(
      'The live data service is offline, so medians can’t be shown right now — showing the mean.',
    ),
  ).toBeVisible()
  await expect(page.getByText(/This link asked for something/)).toHaveCount(0)
  await expect(caption(page).getByText(/^Mean score, 0–10/)).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Median' })).toBeDisabled()
  await expect(page.getByText('Median — needs the live data service.')).toBeVisible()
  // A page that needs the service says so itself, once, with what still
  // works.
  await nav.getByRole('link', { name: /^Change — / }).click()
  await expect(page).toHaveURL(/\/change$/)
  await expect(
    page.getByText(/This view needs the live data service, which is offline right now/),
  ).toBeVisible()
  await expect(page.getByText(/Some views need/)).toHaveCount(0)
})

test('7 — Change with a country where fewer people answered again: the interval and n carry it, no sentence, no rate', async ({
  page,
}) => {
  // The synthetic Testland keeps two thirds of its first-wave group;
  // shrink its follow-up group to a fifth — fixture rows, never real
  // data. The view must show its estimate and interval like any other
  // country's: no caution sentence (withdrawn — ADR-0013, revised), no
  // rate, no jargon; the n rides in the CSV (and the screen-reader table).
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
  const figure = page.getByRole('group', { name: /mean change among the same people/ })
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
  // No retention or coverage percentage anywhere on the page (and no
  // footnote under the chart since ADR-0024).
  expect((text.match(/\d+(\.\d+)?\s?%/g) ?? []).filter((match) => match !== '95%')).toEqual([])
  expect(await figure.innerText()).not.toMatch(/%/)

  // The estimate still appears; no data table (ADR-0022): Testland's
  // card gives its mean change, its CI and its ten pairs.
  await expect(figure.getByText(/^[+−]\d\.\d\d$/).first()).toBeVisible()
  await expect(page.getByText('Data table', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('cell')).toHaveCount(0)
  const row = await figure
    .locator('[aria-label="y-axis tick label"] text', { hasText: 'Testland' })
    .boundingBox()
  await page.mouse.move(row!.x + row!.width + 120, row!.y + row!.height / 2)
  const tip = figure.locator('g[aria-label="tip"] text')
  await expect(tip).toContainText('Testland')
  await expect(tip).toContainText(/Mean change: [+−]\d\.\d\d/)
  await expect(tip).toContainText(/95% CI: \[[+−]\d\.\d\d, [+−]\d\.\d\d\]/)
  await expect(tip).toContainText('Based on 10 people who answered both times')
  await page.mouse.move(0, 0)

  // The URL is the state; the order is by value only, and the value
  // label over the column reverses it (ADR-0029).
  await page.getByRole('button', { name: 'Mean change, highest first' }).click()
  await expect(page).toHaveURL(/outcome=HAPPY&dir=asc$/)
  await expect(page.getByRole('button', { name: 'Mean change, lowest first' })).toBeVisible()
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
  const matrix = page.getByRole('group', {
    name: /How important people rate 1 item in each of 2 countries, as a matrix/,
  })
  await expect(matrix).toBeVisible()
  await expect(matrix.getByRole('rowheader', { name: 'United States' })).toBeVisible()
  // Its labels sort it (ADR-0026): no drop-down, no order buttons. It
  // opens sorted by its first column, highest first; that label again
  // reverses the order. The corner names the rows and never sorts
  // (ADR-0029).
  await expect(page.getByLabel(/Sort countries by/)).toHaveCount(0)
  const head = matrix.locator('thead th').nth(1)
  await expect(head).toHaveAttribute('aria-sort', 'descending')
  await head.getByRole('button').click()
  await expect(page).toHaveURL(/\/what-matters\?dir=asc$/)
  await head.getByRole('button').click()
  await expect(page).toHaveURL(/\/what-matters$/)
  await expect(matrix.locator('thead th').first().getByRole('button')).toHaveCount(0)
  await expect(page.locator('figure')).toHaveCount(1)
  // A switcher, not anchors; the crossings section is gone.
  await expect(page.getByRole('navigation', { name: 'On this page' })).toHaveCount(0)
  await expect(page.getByText(/Two things that travel together/)).toHaveCount(0)

  const text = await page.locator('main').innerText()
  expect(text).not.toMatch(JARGON)
  expect(text).not.toMatch(/midyear_type|standalone|combined/i)

  // No data table (ADR-0022): a cell's card carries its mean, CI and n.
  await expect(page.getByText('Data table', { exact: true })).toHaveCount(0)
  await matrix.getByRole('cell').first().hover()
  const card = page.getByRole('tooltip')
  await expect(card).toContainText('Mean:')
  await expect(card).toContainText(/95% CI: \[/)
  await expect(card).toContainText(/Based on \d[\d,]* (person|people)/)

  // Within a country: the tab opens on the United States's own ranking,
  // one list, most important first (F16: the tab writes by=none).
  await views.getByText('Within a country', { exact: true }).click()
  await expect(page).toHaveURL(/\/what-matters\?view=within&by=none$/)
  await expect(
    page.getByRole('group', {
      name: /^United States: how important people rate 1 item, most important first/,
    }),
  ).toBeVisible()
  await expect(
    caption(page).getByText('United States: what matters most', { exact: true }),
  ).toBeVisible()
  await expect(page.getByLabel('Split by').locator('option:checked')).toHaveText(
    'Nothing — one ranked list',
  )
  await expect(page.locator('figure')).toHaveCount(1)
  // Split by age band: its bands as the matrix's rows, alone on screen —
  // the bare link's own default.
  await page.getByLabel('Split by').selectOption('age_band')
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
  const question = page.getByRole('group', { name: /Daily social media time/ })
  await expect(question).toBeVisible()
  // Rounded bars render as paths in Plot's "bar" mark group.
  await expect(question.locator('[aria-label="bar"] > *').first()).toBeVisible()
  await expect(page.locator('figure')).toHaveCount(1)
  expect(await page.locator('main').innerText()).not.toMatch(JARGON)
})

test('9 — US States: opens on the chart beside one US figure, finds a state, and the map loads its own topology chunk', async ({
  page,
}) => {
  await serveApi(page, {
    '/v1/states': apiFixture('states-HAPPY-Y1.json'),
    // The whole US on the state weight, which the states are read against.
    '/v1/aggregate': apiFixture('states-HAPPY-Y1-overall.json'),
  })
  await page.goto('/states?outcome=HAPPY')
  await expect(caption(page).getByText('Happiness', { exact: true })).toBeVisible()
  // The chart by default (ADR-0030): each state's interval; the subtitle
  // carries the state in the controls' words (ADR-0029).
  const chart = page.getByRole('group', { name: /Happiness by US state/ })
  await expect(chart).toBeVisible()
  await expect(page.getByRole('group', { name: 'View' }).getByLabel('Chart')).toBeChecked()
  await expect(page.locator('figcaption').getByText(/· 2023 · highest first$/)).toBeVisible()
  // One US figure (F14): "United States overall", its CI and n above the
  // chart and on its line; the national weight's figure in a fold.
  await expect(page.getByText(/^United States overall:/)).toBeVisible()
  await expect(page.getByText(/US overall \(state weights\)/)).toHaveCount(0)
  const fold = page.locator('details', { hasText: 'Why two US figures?' })
  await expect(fold.getByText(/the United States overall is/)).toBeHidden()
  await fold.getByText('Why two US figures?').click()
  await expect(
    fold.getByText(/the United States overall is .* based on [\d,]+ people\./),
  ).toBeVisible()
  await expect(page.getByText('Data table', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('cell')).toHaveCount(0)
  // No line under the chart (ADR-0024).
  await expect(page.getByText(/weighted so each/)).toHaveCount(0)
  // Adjusted weights are unavailable in 2023, with the reason in view.
  await expect(page.getByLabel(/Adjust for who answered in each state/)).toBeDisabled()
  await expect(
    page.getByText(/Not available for 2023: the study adjusted its state figures/),
  ).toBeVisible()
  // The US figure's label sits above the chart, clear of every row,
  // value and tick.
  const LABEL = 'United States overall'
  const box = await chart.locator('svg text', { hasText: LABEL }).boundingBox()
  expect(box).not.toBeNull()
  const overlaps: string[] = []
  for (const other of await chart.locator('svg text, svg circle, svg rect').all()) {
    const text = (await other.textContent()) ?? ''
    const area = await other.boundingBox()
    if (text === LABEL || !box || !area) continue
    const clear =
      area.x + area.width <= box.x ||
      area.x >= box.x + box.width ||
      area.y + area.height <= box.y ||
      area.y >= box.y + box.height
    if (!clear) overlaps.push(text || 'a mark')
  }
  expect(overlaps).toEqual([])
  // Find a state (F1): its row picked out, its card held open — the URL
  // unchanged.
  const find = page.getByLabel('Find a state')
  const someState = (await find.locator('option').nth(1).textContent()) ?? ''
  await find.selectOption({ index: 1 })
  await expect(chart.locator('g[aria-label="tip"]', { hasText: someState })).toBeVisible()
  await expect(page).toHaveURL(/\/states\?outcome=HAPPY$/)
  // The map, one click away: its own topology arrives as a lazy asset,
  // never in the initial route; the found state outlined, its card open.
  await page.getByRole('group', { name: 'View' }).getByText('Map', { exact: true }).click()
  await expect(page).toHaveURL(/outcome=HAPPY&view=map$/)
  const map = page.getByRole('img', { name: /Happiness by US state/ })
  await expect(map.locator('svg path').first()).toBeVisible()
  await expect(page.getByText('no estimate', { exact: true })).toBeVisible()
  await expect(
    page.getByText(/Smaller states rest on fewer people — the Chart shows each state’s 95% CI/),
  ).toBeVisible()
  await expect(map.locator('g[aria-label="tip"]', { hasText: someState })).toBeVisible()
  await expect(map.locator('[stroke="var(--ink)"]').first()).toBeAttached()

  // On a phone the found state's card stays inside the page (G5).
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/states?outcome=HAPPY')
  await page.getByRole('button', { name: 'Options' }).click()
  const sheet = page.getByRole('dialog', { name: 'Chart options' })
  const lastState =
    (await sheet.getByLabel('Find a state').locator('option').last().textContent()) ?? ''
  await sheet.getByLabel('Find a state').selectOption({ label: lastState })
  await sheet.getByRole('button', { name: 'Done' }).click()
  const card = page
    .getByRole('group', { name: /Happiness by US state/ })
    .locator('g[aria-label="tip"]', { hasText: lastState })
  await expect(card).toBeVisible()
  const cardBox = (await card.boundingBox())!
  expect(cardBox.x).toBeGreaterThanOrEqual(0)
  expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(390)

  // With reduced motion, the page moves at once — once the sheet has
  // closed, never under it (H4): the found state's row is on the screen.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/states?outcome=HAPPY')
  await page.getByRole('button', { name: 'Options' }).click()
  await sheet.getByLabel('Find a state').selectOption({ label: lastState })
  await sheet.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('button', { name: 'Options' })).toBeFocused()
  const row = page
    .getByRole('group', { name: /Happiness by US state/ })
    .getByRole('listitem', { name: new RegExp(`^${lastState}, `) })
  await expect
    .poll(async () => {
      const rowBox = await row.boundingBox()
      return rowBox !== null && rowBox.y >= 0 && rowBox.y + rowBox.height <= 844
    })
    .toBe(true)
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
  /** A question one country asked, of a release of three: too few for an
   * All countries list (ADR-0020's coverage rule). */
  scarce: { name: string; display_name: string; asked: number; of: number }
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

/** Compare two's answers, each from the synthetic response made for it. */
function servePairs(page: Page) {
  return page.route(`${API}/v1/correlations/pair**`, (route) => {
    const url = new URL(route.request().url())
    return route.fulfill(
      fixtureOr404(
        `correlations-pair-${url.searchParams.get('y')}-${url.searchParams.get('x')}${scopeOf(url)}.json`,
      ),
    )
  })
}

/** Every Correlates request — Find related's lists, Compare two's pairs,
 * Compare several's tables — answered by the synthetic response made
 * for it. */
async function serveCorrelates(page: Page) {
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
  await servePairs(page)
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
}

/** The tooltip of a Compare two grid's first cell, its lines as one: the
 * pointer goes to the cell (its share label sits on top of it) and the
 * chart draws the tip. */
async function cellTip(chart: Locator): Promise<string> {
  await chart.locator('svg g[aria-label="rect"]').nth(1).locator('rect').first().hover({
    force: true,
  })
  const lines = await chart.locator('svg g[aria-label="tip"] text tspan').allTextContents()
  // (Plot starts each line with a zero-width space.)
  return lines.map((line) => line.replace(/\u200b/g, '')).join(' ')
}

test('10 — Correlates by task: Compare two and its picker, Swap, country by country and its average, Compare several, Find related, old links, All countries and the question too few countries asked, Midyear through the note, the phone line', async ({
  page,
}) => {
  // Every request is answered by the synthetic response made for it,
  // named from the request's own parameters; scripts/web_fixtures.py
  // plans the path and writes it down (journey-10.json).
  const plan = JSON.parse(
    readFileSync(join(process.cwd(), 'public', 'data', '_fixtures', 'journey-10.json'), 'utf8'),
  ) as JourneyPlan
  await page.route(`${API}/health`, (route) => route.fulfill({ json: okHealth }))
  await serveCorrelates(page)
  const views = page.getByRole('group', { name: 'View' })

  // A first visit lands on Compare two with the default pair, on All
  // countries as every page does (ADR-0029)…
  await page.goto('/correlates')
  await expect(views.getByLabel('Compare two')).toBeChecked()
  await expect(page.getByLabel('Where')).toHaveValue('all')
  await expect(
    page.getByRole('img', { name: /Feelings about household income, averaged over 2 countries/ }),
  ).toBeVisible()
  // …and Where picks one country — as the old Country select wrote it —
  // for the grid: one SVG, shares in its cells.
  await page.getByLabel('Where').selectOption({ label: 'United States' })
  await expect(page).toHaveURL(/\/correlates\?country=22$/)
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
  // A cell's tooltip: its column, then its share and the row's answer in
  // the answer's own words.
  await expect
    .poll(() => cellTip(grid))
    .toMatch(
      /^Life evaluation today: \d+ (<1|\d+)% — \D.* on present income( 95% CI: \[.+\])? [\d,]+ (person|people) in the sample gave both answers$/,
    )
  // The strip names its scope; where is chosen under the shared row.
  await expect(page.getByText('United States:', { exact: true })).toBeVisible()
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
  await expect(page).toHaveURL(new RegExp(`\\?a=${plan.picked.name}&country=22$`))
  await expect(
    caption(page).getByText(`${plan.picked.display_name} and Feelings about household income`, {
      exact: true,
    }),
  ).toBeVisible()

  // Swap.
  await page.getByRole('button', { name: 'Swap' }).click()
  await expect(page).toHaveURL(new RegExp(`\\?a=INCOME_FEELINGS&b=${plan.picked.name}&country=22$`))
  await expect(
    caption(page).getByText(`Feelings about household income and ${plan.picked.display_name}`, {
      exact: true,
    }),
  ).toBeVisible()
  // The rows are numbers now, so a cell's tooltip names their question.
  const swapped = page.getByRole('img', {
    name: new RegExp(`^Feelings about household income and ${plan.picked.display_name} in`),
  })
  await expect
    .poll(() => cellTip(swapped))
    .toMatch(
      new RegExp(
        `^Feelings about household income: \\D.* (<1|\\d+)% answered \\d+ on ${plan.picked.display_name}( 95% CI: \\[.+\\])? [\\d,]+ (person|people) in the sample gave both answers$`,
      ),
    )

  // Each country side by side: one dot per country, the grid gone, and
  // the All countries average as a labelled rule — the chosen country
  // still picked out; then back. Where writes what the old toggle wrote.
  await page.getByLabel('Where').selectOption('each')
  await expect(page).toHaveURL(/scope=all&country=22$/)
  const everyCountry = page.getByRole('group', { name: /their correlation in each of 2 countries/ })
  await expect(everyCountry).toBeVisible()
  await expect(everyCountry).toHaveAttribute(
    'aria-label',
    /A dashed line marks the All countries average, [+−]?\d\.\d\d\*?\./,
  )
  await expect(
    everyCountry
      .locator('svg text')
      .filter({ hasText: /^All countries [+−]?\d\.\d\d/ })
      .first(),
  ).toBeVisible()
  expect(await everyCountry.innerHTML()).toContain('var(--control-selected)')
  await expect(page.getByText('Share of each column (columns add to 100%)')).toBeHidden()
  await page.getByLabel('Where').selectOption({ label: 'United States' })
  await expect(page).not.toHaveURL(/scope=/)
  await expect(page).toHaveURL(/country=22$/)

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
  // Similar together: the server's order, the first column first. Seven
  // questions: numbered columns (review M7), each heading named for its
  // question, over an empty corner that is no heading at all.
  await page.getByText('Similar together', { exact: true }).click()
  await expect(page).toHaveURL(/order=similar/)
  const firstColumn = table.getByRole('columnheader').first()
  await expect(firstColumn).toHaveText('1')
  await expect(firstColumn).toHaveAccessibleName(
    plan.order[0] === 'INCOME_FEELINGS' ? 'Feelings about household income' : /./,
  )
  await expect(table.getByRole('rowheader').first()).toHaveText(/^1\. /)
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
  await page.goto('/correlates?view=ranked&outcome=HAPPY&country=22')
  await expect(views.getByLabel('Find related')).toBeChecked()
  await expect(
    page.getByRole('group', { name: /^Happiness: the \d+ questions most strongly associated/ }),
  ).toBeVisible()
  await page.goto('/correlates?view=countries&outcome=HAPPY&country=22')
  await expect(views.getByLabel('Find related')).toBeChecked()
  await expect(page.getByLabel('Where')).toHaveValue('each')
  const matrix = page.getByRole('img', { name: /as a matrix/ })
  await expect(matrix).toBeVisible()
  await expect(matrix.getByRole('columnheader').nth(1)).toHaveText('United States')
  expect(await page.locator('main').innerText()).not.toMatch(JARGON)

  // All countries (ADR-0020): every view averages the countries.
  await page.goto('/correlates?country=all')
  await expect(page.getByText('All countries (average of 2) · 2023', { exact: true })).toBeVisible()
  const where = page.getByLabel('Where')
  await expect(where).toHaveValue('all')
  await expect(
    page.getByRole('img', {
      name: /Feelings about household income, averaged over 2 countries/,
    }),
  ).toBeVisible()
  // Each country side by side: every country, none picked out; the strip
  // reads the average.
  await where.selectOption('each')
  const pooledAcross = page.getByRole('group', { name: /their correlation in each of 2 countries/ })
  await expect(pooledAcross).toBeVisible()
  expect(await pooledAcross.innerHTML()).not.toContain('var(--control-selected)')
  await expect(page.getByText('All countries:', { exact: true })).toBeVisible()
  await expect(
    pooledAcross
      .locator('svg text')
      .filter({ hasText: /^All countries [+−]?\d\.\d\d/ })
      .first(),
  ).toBeVisible()
  await where.selectOption('all')
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

  // A question asked in fewer than half the countries has no All countries
  // list (ADR-0020): the page says so in the list's place, under either
  // scope, and a country's own list is a choice away. One country of this
  // tier's two is half, so this stop is served a release of three
  // (scripts/web_fixtures.py): its meta in place of meta.json, and its
  // answer for the question.
  const { scarce } = plan
  const threeCountries = (route: Route) =>
    route.fulfill({ json: jsonFixture('coverage-meta.json') })
  const noList = (route: Route) => {
    const url = new URL(route.request().url())
    return url.searchParams.get('outcome') === scarce.name && url.searchParams.get('pooled')
      ? route.fulfill({
          json: jsonFixture(`coverage-correlates-${scarce.name}-Y1-all-ranked.json`),
        })
      : route.fallback()
  }
  await page.route('**/data/meta.json', threeCountries)
  await page.route(`${API}/v1/correlates**`, noList)
  await page.goto(`/correlates?view=related&outcome=${scarce.name}&country=all`)
  const emptyState = page.getByText(
    `${scarce.display_name} was asked in ${scarce.asked} of ${scarce.of} countries. All countries lists include only questions asked in at least half of them — choose a country to see what goes with it.`,
    { exact: true },
  )
  await expect(emptyState).toBeVisible()
  await expect(emptyState.locator('em')).toHaveText(scarce.display_name)
  await expect(page.locator('main figure')).toHaveCount(0)
  await where.selectOption('each')
  await expect(page).toHaveURL(/scope=all/)
  await expect(emptyState).toBeVisible()
  await where.selectOption('all')
  await expect(page).not.toHaveURL(/scope=/)
  await where.selectOption({ label: 'Testland' })
  await expect(
    page.getByRole('group', {
      name: new RegExp(
        `^${scarce.display_name}: the \\d+ questions most strongly associated with it in Testland`,
      ),
    }),
  ).toBeVisible()
  await expect(emptyState).toBeHidden()
  await page.unroute('**/data/meta.json', threeCountries)
  await page.unroute(`${API}/v1/correlates**`, noList)

  // Midyear from the chip: the midyear question beside the same people's
  // 2023 answers, then 2024's; back at 2023 the default returns — and the
  // line under the row says each time what changed on its own.
  await page.goto('/correlates?country=22')
  const wave = page.getByRole('group', { name: 'Year' })
  await wave.getByText('Midyear', { exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`\\?a=${plan.midyear.name}&wave=MY&country=22$`))
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
  await expect(page).toHaveURL(/\/correlates\?country=22$/)
  await expect(
    page.getByText(
      `${plan.midyear.display_name} was asked only in the midyear survey, so Life evaluation today took its place.`,
    ),
  ).toBeVisible()

  // Midyear from the picker: a midyear question picked at 2023 takes the
  // page to Midyear.
  await page.goto('/correlates?view=related&outcome=HAPPY&country=22')
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
  // Find related's note is plural, and its choice of year works the same.
  await expect(page.getByText(/^The other questions use the same people’s/)).toBeVisible()
  await page.getByRole('combobox', { name: 'Year of the other answers' }).selectOption('Y2')
  await expect(page).toHaveURL(/other=Y2/)
  await expect(
    caption(page).getByText(
      'United States · Midyear survey, with 2024 answers from the same people',
      { exact: false },
    ),
  ).toBeVisible()

  // A phone: Year and Where stay in view; one line says how the chart
  // is drawn, and Options opens the sheet with the correlation type.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/correlates?country=22')
  await expect(page.getByRole('group', { name: 'Year' })).toBeVisible()
  await expect(page.getByLabel('Where')).toHaveValue('22')
  // The line names only what Options holds (G12).
  await expect(page.getByText('Measured as: straight-line', { exact: true })).toBeVisible()
  const options = page.getByRole('button', { name: 'Options' })
  await options.click()
  const sheet = page.getByRole('dialog', { name: 'Chart options' })
  await sheet.getByText('By rank', { exact: true }).click()
  await expect(page).toHaveURL(/country=22&method=spearman$/)
  await sheet.getByRole('button', { name: 'Done' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(options).toBeFocused()
  // No sideways scroll at phone width.
  expect(
    await page.evaluate<boolean>(
      'document.documentElement.scrollWidth <= document.documentElement.clientWidth',
    ),
  ).toBe(true)
})

// A phone's widths, down to the narrowest still in use, under two fonts:
// the platform's own and a wider one. Linux's system font is wider than
// macOS's, which is how the nav pushed the page sideways on the CI runner
// and nowhere else (30 Sept). Verdana stands in for it where it is
// installed (macOS, Windows); elsewhere the stack falls through to the
// platform's own sans — on the runner, already the wide case.
const PHONE_WIDTHS = [320, 360, 375, 390]
const PHONE_FONTS = [
  { name: 'the platform’s font', css: null },
  { name: 'a wider font', css: ':root { --font-sans: Verdana, sans-serif }' },
]
/** The least the phone nav leaves between two items (AppShell.module.css). */
const NAV_LEAST_GAP = 2
// The pages journey 11 holds the rule on, each with what shows it has
// rendered: a chart; the Codebook has none — a table wider than a
// phone, which scrolls in a box of its own, found by its last column's
// header: only a screen reader meets it, and it once widened the page
// from inside that box (30 Sept); Methods, its first diagram.
const PHONE_PAGES: { path: string; rendered: (page: Page) => Locator }[] = [
  { path: '/', rendered: (page) => page.locator('main figure').first() },
  { path: '/correlates', rendered: (page) => page.locator('main figure').first() },
  { path: '/codebook', rendered: (page) => page.getByRole('columnheader', { name: 'Chartable' }) },
  { path: '/methods', rendered: (page) => page.locator('[data-figure] svg').first() },
]

/** How far the page can scroll sideways, in px — never less than none.
 * Where the page keeps room for a classic scrollbar (scrollbar-gutter,
 * styles.css) and Playwright hides the bar — the Linux runner — its
 * scrollWidth is 15px short of its clientWidth when nothing overflows. */
function sideways(page: Page): Promise<number> {
  return page.evaluate<number>(
    'Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)',
  )
}

test('11 — a phone never scrolls sideways: the Atlas, Correlates, the Codebook and Methods from 320 to 390 px, in a wider font too, the options sheet open; the nav keeps one row where its items fit — all seven on a tablet — and "More" opens inside the page', async ({
  page,
}) => {
  // Thirty-two page loads, "More" (and the options sheet) opened on each:
  // about half a second apiece on the CI runner, so three times the
  // default allowance.
  test.setTimeout(90_000)
  await page.route(`${API}/health`, (route) => route.fulfill({ json: okHealth }))
  await servePairs(page)
  // Every width and font is tried, so one run names every one that fails.
  const softly = expect.configure({ soft: true })
  const nav = page.getByRole('navigation', { name: 'Main' })
  const panel = nav.locator('details > div')
  const column = page.locator('main')

  // A tablet held upright shows all seven pages on one row; a phone folds
  // three into "More" (F8).
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.goto('/')
  await expect(nav.getByRole('link')).toHaveCount(7)
  await expect(nav.getByText('More', { exact: true })).toHaveCount(0)
  const tabletRows = new Set(
    (await Promise.all((await nav.getByRole('link').all()).map((link) => link.boundingBox()))).map(
      (box) => Math.round(box!.y),
    ),
  )
  softly(tabletRows.size, 'rows of nav at 768 px').toBe(1)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(nav.getByText('More', { exact: true })).toBeVisible()

  for (const { path, rendered } of PHONE_PAGES) {
    for (const font of PHONE_FONTS) {
      for (const width of PHONE_WIDTHS) {
        const where = `${path} at ${width}px in ${font.name}`
        await page.setViewportSize({ width, height: 844 })
        await page.goto(path)
        await expect(rendered(page)).toBeVisible()
        if (font.css) await page.addStyleTag({ content: font.css })
        softly(await sideways(page), `${where}: px of sideways scroll`).toBe(0)

        // The row gives up its spacing before it wraps: one row wherever
        // its items fit the page column with the least space between them.
        const room = (await column.boundingBox())!.width
        const items = await Promise.all(
          (await nav.locator(':scope > a, :scope > details').all()).map((item) =>
            item.boundingBox(),
          ),
        )
        const needed =
          items.reduce((sum, box) => sum + box!.width, 0) + NAV_LEAST_GAP * (items.length - 1)
        if (needed <= room - 0.5) {
          const rows = new Set(items.map((box) => Math.round(box!.y))).size
          softly(rows, `${where}: rows of nav, its items fitting one`).toBe(1)
        }

        // "More" opens inside the page column — hung from its right edge,
        // or moved over where the row has wrapped it to the left.
        await nav.getByText('More', { exact: true }).click()
        await expect(nav.getByRole('link', { name: 'Methods' })).toBeVisible()
        await softly
          .poll(
            async () => {
              const [box, within] = await Promise.all([panel.boundingBox(), column.boundingBox()])
              if (!box || !within) return Infinity
              return Math.max(within.x - box.x, box.x + box.width - (within.x + within.width))
            },
            {
              message: `${where}: px of the "More" panel outside the page column`,
              timeout: 1_000,
            },
          )
          .toBeLessThanOrEqual(1)
        softly(await sideways(page), `${where}, "More" open: px of sideways scroll`).toBe(0)

        // The chart pages' options sheet (ADR-0029), open: still none.
        const options = page.getByRole('button', { name: 'Options' })
        if ((await options.count()) > 0) {
          await page.keyboard.press('Escape')
          await options.click()
          await expect(page.getByRole('dialog', { name: 'Chart options' })).toBeVisible()
          softly(await sideways(page), `${where}, options open: px of sideways scroll`).toBe(0)
        }
      }
    }
  }
})

// The longest things in a release, which a phone is too narrow for. A
// table cannot be narrower than its longest label, and some have nowhere
// to break: words joined by slashes, as country-specific answers are.
const UNBREAKABLE_LABEL = 'Single/Separated/Divorced/Widowed/Unmarried/Unpartnered'
// A select is as wide as its longest option: an answer a sentence long,
// or a question named as long.
const LONG_ANSWER =
  'Every week, or more often than that, at a church, a mosque, a temple, a shrine or another place of worship or prayer'
const LONG_NAME = 'Marital status, or the living arrangement nearest to one, when interviewed'

test('12 — nor does a phone scroll sideways for the longest label, answer or name: a codebook entry, Segments and Change with their options sheets open, from 320 to 390 px in both fonts — Change on a phone turned on its side too', async ({
  page,
}) => {
  await page.route(`${API}/health`, (route) => route.fulfill({ json: okHealth }))
  await page.route(`${API}/v1/change**`, (route) =>
    route.fulfill({ json: apiFixture('change-ATTEND_SVCS-Y1-Y2.json') }),
  )
  // Fixture rows made too wide for a phone — never real data. The Marital
  // status entry's first label has nowhere to break, and its name in the
  // catalog is a sentence; Service attendance's first answer is one too,
  // in a list long enough (more than six) to be a select at every width.
  const entry = tierFile('v1/MARITAL_STATUS/variable.json') as {
    value_labels: { label: string }[]
  }
  entry.value_labels = entry.value_labels.map((row, index) =>
    index === 0 ? { ...row, label: UNBREAKABLE_LABEL } : row,
  )
  await page.route('**/data/v1/MARITAL_STATUS/variable.json', (route) =>
    route.fulfill({ json: entry }),
  )
  const catalog = tierFile('variables.json') as {
    variables: { name: string; display_name: string }[]
  }
  catalog.variables = catalog.variables.map((variable) =>
    variable.name === 'MARITAL_STATUS' ? { ...variable, display_name: LONG_NAME } : variable,
  )
  await page.route('**/data/variables.json', (route) => route.fulfill({ json: catalog }))
  const answers = tierFile('v1/ATTEND_SVCS/variable.json') as {
    value_labels: { code: number; label: string; is_nonresponse: boolean }[]
  }
  const [first, ...rest] = answers.value_labels
  answers.value_labels = [
    { ...first!, label: LONG_ANSWER },
    ...rest,
    ...[4, 5, 6, 7].map((code) => ({ ...first!, code, label: `Answer ${code}` })),
  ]
  await page.route('**/data/v1/ATTEND_SVCS/variable.json', (route) =>
    route.fulfill({ json: answers }),
  )
  const softly = expect.configure({ soft: true })
  // Each stop with what shows it has rendered, whether its options sheet
  // opens before it is measured, and its widths where a phone's are not
  // all.
  const stops: {
    path: string
    rendered: Locator
    open?: boolean
    unfold?: Locator
    widths?: number[]
  }[] = [
    // The entry's value labels scroll in a box of their own, in the fold
    // "For the technically minded" (G7).
    {
      path: '/codebook/MARITAL_STATUS',
      rendered: page.getByRole('cell', { name: UNBREAKABLE_LABEL }),
      unfold: page.getByText('For the technically minded'),
    },
    // Segments' second split ("then by") lists every categorical question
    // by name, in the question bar; its options sheet holds the order and
    // the countries.
    {
      path: '/segments',
      rendered: page.locator('main figure').first(),
      open: true,
    },
    // Change's answer level is a select in the options sheet on a phone —
    // and in the chart's toolbar on a phone turned on its side (680 px),
    // where the toolbar wraps rather than stacks.
    {
      path: '/change?outcome=ATTEND_SVCS',
      rendered: page.locator('main figure').first(),
      open: true,
      widths: [...PHONE_WIDTHS, 680],
    },
  ]
  for (const { path, rendered, open, unfold, widths = PHONE_WIDTHS } of stops) {
    for (const font of PHONE_FONTS) {
      for (const width of widths) {
        const where = `${path} at ${width}px in ${font.name}`
        await page.setViewportSize({ width, height: 844 })
        await page.goto(path)
        if (unfold) await unfold.click()
        await expect(rendered).toBeVisible()
        if (font.css) await page.addStyleTag({ content: font.css })
        const options = page.getByRole('button', { name: 'Options' })
        if (open && (await options.count()) > 0) {
          await options.click()
          await expect(page.getByRole('dialog', { name: 'Chart options' })).toBeVisible()
        }
        softly(await sideways(page), `${where}: px of sideways scroll`).toBe(0)
      }
    }
  }
})

test('13 — a phone: the chart on the first screen; pick a question, reverse the order, choose Distribution in Options, reload — the same view', async ({
  page,
}) => {
  // The live service up, as a visitor would have it.
  await page.route(`${API}/health`, (route) => route.fulfill({ json: okHealth }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('main figure').first()).toBeVisible()
  // The chart starts on the first screen (G3): its first dot about 600 px
  // down (594 on the real data on macOS, 757 before), held at 640 so the
  // Linux runner's wider font has room — eight rows still in view.
  const firstDot = page.locator('main figure [data-chart] svg circle').first()
  await expect(firstDot).toBeVisible()
  expect((await firstDot.boundingBox())!.y).toBeLessThanOrEqual(640)
  // The question bar: the question and the year; the picker is a sheet.
  await page.getByRole('button', { name: 'Question: Secure Flourishing Index' }).click()
  const picker = page.getByRole('dialog', { name: 'Question' })
  await picker.getByRole('searchbox').fill('happi')
  await picker
    .getByRole('listbox', { name: 'Search results' })
    .getByRole('option', { name: 'Happiness', exact: true })
    .click()
  await expect(page).toHaveURL(/\?outcome=HAPPY$/)
  // The value label reverses the order: a 44 px target on a phone.
  const value = page.getByRole('button', { name: 'Mean, highest first' })
  expect((await value.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await value.click()
  await expect(page).toHaveURL(/\?outcome=HAPPY&dir=asc$/)
  // Options: the sheet takes focus; Distribution; Done gives it back.
  const options = page.getByRole('button', { name: 'Options' })
  await options.click()
  const sheet = page.getByRole('dialog', { name: 'Chart options' })
  await expect(sheet.getByRole('radio', { name: 'Mean' })).toBeFocused()
  // The chart's links wait at the sheet's foot (G3).
  await expect(sheet.getByRole('link', { name: 'How to read this chart' })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Download CSV' })).toBeVisible()
  await sheet.getByText('Distribution', { exact: true }).click()
  await expect(page).toHaveURL(/\?outcome=HAPPY&stat=distribution&dir=asc$/)
  await sheet.getByRole('button', { name: 'Done' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(options).toBeFocused()
  const line = page.getByText(/^Distribution · /)
  await expect(line).toBeVisible()
  const said = await line.textContent()
  // Reload: the same view, from the URL alone.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Question: Happiness' })).toBeVisible()
  await expect(page.getByText(said ?? '', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Options' }).click()
  await expect(
    page
      .getByRole('dialog', { name: 'Chart options' })
      .getByRole('radio', { name: 'Distribution' }),
  ).toBeChecked()
})

test('14 — a keyboard reads a chart row by row: one tab stop, ↑ ↓ Home End, each row’s card with its 95% CI and n; Find a state’s row first', async ({
  page,
}) => {
  // The live service up, as a visitor would have it.
  await page.route(`${API}/health`, (route) => route.fulfill({ json: okHealth }))
  await page.goto('/')
  const chart = page.getByRole('group', { name: /by country/ })
  const rows = chart.getByRole('listitem')
  await expect(rows.first()).toBeAttached()
  const count = await rows.count()
  expect(count).toBeGreaterThanOrEqual(2)
  // The pointer is unchanged: a dot's hover card is Plot's own.
  await chart.locator('svg circle').first().hover()
  await expect(chart.locator('g[aria-label="tip"]')).toContainText(/95% CI: \[.+\]/)
  await page.mouse.move(0, 0)

  // Into the chart from its value label: one stop, on the first row,
  // its card open beside it and read out as its description.
  await page.getByRole('button', { name: 'Mean, highest first' }).focus()
  await page.keyboard.press('Tab')
  await expect(rows.first()).toBeFocused()
  const card = chart.getByRole('tooltip')
  await expect(card).toBeVisible()
  // A row is named with its value — "Indonesia, 8.10" (H3) — and its
  // card names the country: the name up to its first comma.
  const fullName = async (index: number) => (await rows.nth(index).getAttribute('aria-label')) ?? ''
  const name = async (index: number) => (await fullName(index)).split(',')[0] ?? ''
  expect(await fullName(0)).toMatch(/^[^,]+, \d+\.\d\d(, few people)?$/)
  await expect(card).toContainText(await name(0))
  await expect(card).toContainText('Mean:')
  await expect(card).toContainText(/95% CI: \[.+\]/)
  await expect(card).toContainText(/Based on \d[\d,]* (person|people)/)
  await expect(rows.first()).toHaveAccessibleDescription(/Mean: .*95% CI: \[.+\]/)
  const rowBox = (await rows.first().boundingBox())!
  const cardBox = (await card.boundingBox())!
  const chartBox = (await chart.boundingBox())!
  expect(cardBox.y).toBeLessThan(rowBox.y + rowBox.height)
  expect(cardBox.y + cardBox.height).toBeGreaterThan(rowBox.y)
  expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(chartBox.x + chartBox.width + 1)
  // ↓ ↑ move between rows, Home and End to the ends; the card follows.
  await page.keyboard.press('ArrowDown')
  await expect(rows.nth(1)).toBeFocused()
  await expect(card).toContainText(await name(1))
  await page.keyboard.press('End')
  await expect(rows.nth(count - 1)).toBeFocused()
  await expect(card).toContainText(await name(count - 1))
  await page.keyboard.press('ArrowUp')
  await expect(rows.nth(count - 2)).toBeFocused()
  await page.keyboard.press('Home')
  await expect(rows.first()).toBeFocused()
  // Escape closes the card; focus stays on the row.
  await page.keyboard.press('Escape')
  await expect(card).toBeHidden()
  await expect(rows.first()).toBeFocused()
  // One tab stop: Tab leaves the chart, Shift+Tab comes back to the row
  // last read.
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Tab')
  await expect(chart.locator(':focus')).toHaveCount(0)
  await page.keyboard.press('Shift+Tab')
  await expect(rows.nth(1)).toBeFocused()
  await expect(card).toContainText(await name(1))

  // US States: a found state holds the tab stop, and its pinned card
  // steps aside while the row's own card is open.
  await serveApi(page, {
    '/v1/states': apiFixture('states-HAPPY-Y1.json'),
    '/v1/aggregate': apiFixture('states-HAPPY-Y1-overall.json'),
  })
  await page.goto('/states?outcome=HAPPY')
  const states = page.getByRole('group', { name: /Happiness by US state/ })
  await expect(states.getByRole('listitem').first()).toBeAttached()
  const find = page.getByLabel('Find a state')
  const someState = (await find.locator('option').nth(2).textContent()) ?? ''
  await find.selectOption({ label: someState })
  const pinned = states.locator('g[aria-label="tip"]', { hasText: someState })
  await expect(pinned).toBeVisible()
  await page.getByRole('button', { name: 'Mean, highest first' }).focus()
  await page.keyboard.press('Tab')
  await expect(
    states.getByRole('listitem', { name: new RegExp(`^${someState}, \\d`) }),
  ).toBeFocused()
  await expect(states.getByRole('tooltip')).toContainText(someState)
  await expect(pinned).toBeHidden()
  await page.keyboard.press('ArrowDown')
  await expect(pinned).toBeVisible()
  await expect(states.getByRole('tooltip')).not.toContainText(someState)

  // Change reads the same way (H2, ADR-0033): each country named with its
  // change, its card on focus.
  await serveApi(page, { '/v1/change': apiFixture('change-HAPPY-Y1-Y2.json') })
  await page.goto('/change?outcome=HAPPY')
  const change = page.getByRole('group', { name: /mean change among the same people/ })
  const changeRows = change.getByRole('listitem')
  await expect(changeRows.first()).toBeAttached()
  expect(await changeRows.first().getAttribute('aria-label')).toMatch(/^[^,]+, [+−]\d+\.\d\d/)
  await page.getByRole('button', { name: /Mean change, highest first/ }).focus()
  await page.keyboard.press('Tab')
  await expect(changeRows.first()).toBeFocused()
  await expect(change.getByRole('tooltip')).toContainText(/95% CI: \[.+\]/)
  await page.keyboard.press('ArrowDown')
  await expect(changeRows.nth(1)).toBeFocused()

  // Segments by gender: one tab stop for every panel; ↑ ↓ within a
  // country, Page Down to the next; the card names the country and group.
  await page.goto('/segments?outcome=HAPPY&by=gender')
  const segments = page.getByRole('group', { name: /panel per country/ })
  const panels = segments.getByRole('list')
  await expect(panels.first()).toBeAttached()
  expect(await panels.count()).toBeGreaterThanOrEqual(2)
  const firstCountry = (await panels.first().getAttribute('aria-label')) ?? ''
  const secondCountry = (await panels.nth(1).getAttribute('aria-label')) ?? ''
  // Into the chart from the link just above it (the question's wording).
  await page.getByRole('link', { name: /The exact question and answers/ }).focus()
  await page.keyboard.press('Tab')
  await expect(panels.first().getByRole('listitem').first()).toBeFocused()
  const segmentCard = segments.getByRole('tooltip')
  await expect(segmentCard).toContainText(firstCountry)
  await expect(segmentCard).toContainText('Gender:')
  await expect(segmentCard).toContainText(/95% CI: (\[.+\]|none)/)
  await page.keyboard.press('ArrowDown')
  await expect(panels.first().getByRole('listitem').nth(1)).toBeFocused()
  await page.keyboard.press('PageDown')
  await expect(panels.nth(1).getByRole('listitem').nth(1)).toBeFocused()
  await expect(segmentCard).toContainText(secondCountry)
})

async function streamToString(download: {
  createReadStream: () => Promise<NodeJS.ReadableStream>
}): Promise<string> {
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer))
  return Buffer.concat(chunks).toString('utf8')
}

/** The controls on the screen (and in an open dialog) shorter than a
 * finger's 44 px: buttons, selects, fold summaries, text fields, and the
 * labels a radio or checkbox is chosen by — not links in running text,
 * not a chart's marks. In-page code, as a string (the e2e files are
 * type-checked without the DOM library). */
const SMALL_CONTROLS = `(() => {
  const scope = document.querySelector('[role="dialog"]') ?? document.querySelector('main')
  const controls = scope.querySelectorAll(
    'button, select, summary, input[type="search"], input[type="text"],' +
      ' label:has(> input[type="radio"]), label:has(> input[type="checkbox"])',
  )
  const small = []
  for (const control of controls) {
    if (control.closest('svg, [hidden], .visually-hidden')) continue
    const fold = control.closest('details')
    if (fold && !fold.open && control.tagName !== 'SUMMARY') continue
    const box = control.getBoundingClientRect()
    if (box.width <= 1 || box.height <= 1) continue
    if (box.height < 43.5) {
      const name = (control.getAttribute('aria-label') || control.textContent || control.tagName)
        .trim()
        .replace(/\\s+/g, ' ')
        .slice(0, 40)
      small.push(control.tagName.toLowerCase() + ' "' + name + '" ' + Math.round(box.height))
    }
  }
  return small
})()`

test('15 — on a phone every control is a finger’s target: 44 px tall at 390 px, the options sheets open too — in Chromium and WebKit', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await serveApi(page, {
    '/v1/states': apiFixture('states-HAPPY-Y1.json'),
    '/v1/aggregate': apiFixture('states-HAPPY-Y1-overall.json'),
    '/v1/change': apiFixture('change-HAPPY-Y1-Y2.json'),
  })
  await serveCorrelates(page)
  await page.setViewportSize({ width: 390, height: 844 })
  const softly = expect.configure({ soft: true })
  const pages: [string, (page: Page) => Locator][] = [
    ['/', (page) => page.locator('main figure').first()],
    ['/change?outcome=HAPPY', (page) => page.locator('main figure').first()],
    ['/states?outcome=HAPPY', (page) => page.locator('main figure').first()],
    ['/segments?outcome=HAPPY&by=gender', (page) => page.locator('main figure').first()],
    ['/what-matters', (page) => page.locator('main figure').first()],
    ['/what-matters?view=within', (page) => page.locator('main figure').first()],
    ['/what-matters?view=questions', (page) => page.locator('main figure').first()],
    ['/correlates', (page) => page.locator('main figure').first()],
    ['/correlates?view=matrix', (page) => page.locator('main figure').first()],
    ['/correlates?view=related', (page) => page.locator('main figure').first()],
    ['/codebook', (page) => page.getByRole('columnheader', { name: 'Chartable' })],
    ['/codebook/HAPPY', (page) => page.getByRole('heading', { level: 2 }).first()],
    ['/methods', (page) => page.locator('[data-figure] svg').first()],
  ]
  for (const [path, rendered] of pages) {
    await page.goto(path)
    await expect(rendered(page)).toBeVisible()
    softly(await page.evaluate<string[]>(SMALL_CONTROLS), `${path}: controls under 44 px`).toEqual(
      [],
    )
    const options = page.getByRole('button', { name: 'Options' })
    if ((await options.count()) > 0) {
      await options.click()
      await expect(page.getByRole('dialog', { name: 'Chart options' })).toBeVisible()
      softly(
        await page.evaluate<string[]>(SMALL_CONTROLS),
        `${path}, options open: controls under 44 px`,
      ).toEqual([])
      await page.keyboard.press('Escape')
    }
  }
})
