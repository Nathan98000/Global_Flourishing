// The six Phase 4 journeys (§2.11) over the built app + fixture tier,
// plus the Phase 5 launch-checklist journeys and the Phase 6 Correlates
// journey. No API runs in this suite: every Phase 4 view is static-first
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
  const countries = page.locator('details', {
    has: page.locator('summary', { hasText: /^Countries:/ }),
  })
  await countries.locator('summary').click()
  await expect(countries).toHaveAttribute('open', '')
  const boxes = countries.getByRole('checkbox')
  await boxes.nth(0).check()
  await boxes.nth(1).check()
  await expect(page).toHaveURL(/countries=1(%2C|,)22/)
  expect(Math.abs((await page.evaluate<number>('window.scrollY')) - scrolled)).toBeLessThan(4)
  await expect(countries).toHaveAttribute('open', '')
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
  await page.goto('/breakdowns?outcome=HAPPY&by=gender')
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

test('8 — What Matters with a combined-midyear country: the matrix, the split by age, no jargon', async ({
  page,
}) => {
  // The synthetic release administers the midyear survey both ways in
  // every country (half its midyear respondents answered inside the Wave
  // 2 interview), so the United States stands for a combined-midyear
  // country here; its midyear answers are ordinary cross-sections on the
  // midyear weight, and the view must show them without a word about
  // administration modes. The synthetic midyear family holds one
  // importance item and no chartable item.
  await page.route(`${API}/health`, (route) => route.fulfill({ json: okHealth }))
  await page.goto('/what-matters?country=22')

  await expect(
    caption(page).first().getByText('What matters most, by country', { exact: true }),
  ).toBeVisible()
  await expect(
    caption(page)
      .first()
      .getByText(/Midyear survey, Nov 2023–Dec 2024/),
  ).toBeVisible()
  // One matrix: countries down, the importance items across.
  const matrix = page.getByRole('img', {
    name: /How important people rate 1 things .* as a matrix/,
  })
  await expect(matrix).toBeVisible()
  await expect(matrix.getByRole('rowheader', { name: 'United States' })).toBeVisible()
  await expect(
    page.getByRole('img', {
      name: /United States: how important people rate 1 things, one panel per age band/,
    }),
  ).toBeVisible()
  // Three anchors under the lede; the crossings section is gone.
  await expect(
    page.getByRole('navigation', { name: 'On this page' }).getByRole('link'),
  ).toHaveCount(3)
  await expect(page.getByText(/Two things that travel together/)).toHaveCount(0)

  const text = await page.locator('main').innerText()
  expect(text).not.toMatch(JARGON)
  expect(text).not.toMatch(/midyear_type|standalone|combined/i)

  // The n rides on every row of the data table.
  await page.getByText('Data table', { exact: true }).first().click()
  const table = page.locator('details').first().getByRole('table')
  await expect(table.getByRole('columnheader', { name: 'n', exact: true })).toBeVisible()
  await expect(table.getByRole('columnheader', { name: 'Measure' })).toBeVisible()

  // The URL is the state: the split column round-trips.
  await page.getByLabel('Split by').selectOption('gender')
  await expect(page).toHaveURL(/country=22&by=gender$/)
  await expect(page.getByRole('img', { name: /one panel per gender/ })).toBeVisible()
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

test('10 — Correlates: pick an outcome, read the ranked list, switch to adjusted, open the model card', async ({
  page,
}) => {
  // The view makes two requests per state — the ranked list for one
  // country and its measures across countries — plain or adjusted; the
  // fixture is chosen from the request's own parameters.
  await page.route(`${API}/health`, (route) => route.fulfill({ json: okHealth }))
  await page.route(`${API}/v1/correlates**`, (route) => {
    const url = new URL(route.request().url())
    const outcome = url.searchParams.get('outcome') === 'HAPPY' ? 'HAPPY' : 'sfi'
    const shape = url.searchParams.getAll('by').includes('country_code') ? 'across' : 'ranked'
    const adjusted = url.searchParams.get('adjusted') === 'true' ? '-adjusted' : ''
    return route.fulfill({ json: apiFixture(`correlates-${outcome}-Y1-${shape}${adjusted}.json`) })
  })

  await page.goto('/correlates')
  await expect(
    caption(page).first().getByText('What travels with Secure Flourishing Index', { exact: true }),
  ).toBeVisible()
  // The caveat is a sentence in the deck, not a box.
  await expect(page.getByText(/These are associations, not causes/)).toBeVisible()

  // Pick an outcome: topic first, then its measure.
  await page.getByLabel('Topic', { exact: true }).selectOption('wellbeing')
  await page.getByLabel('Measure', { exact: true }).selectOption('HAPPY')
  await expect(
    caption(page).first().getByText('What travels with Happiness', { exact: true }),
  ).toBeVisible()
  await expect(page).toHaveURL(/outcome=HAPPY$/)

  // Read the ranked list: measures named from the catalog, signed values,
  // no interval drawn or described — a correlation is a point estimate.
  const ranked = page.getByRole('img', {
    name: /most strongly associated with it in United States/,
  })
  await expect(ranked).toBeVisible()
  await expect(ranked.getByText('Loneliness', { exact: true })).toBeVisible()
  await expect(ranked.getByText(/^[+−]\d\.\d\d$/).first()).toBeVisible()
  await expect(page.getByText(/Dots are point estimates/).first()).toBeVisible()
  expect(await page.locator('main').innerText()).not.toContain('95%')
  // The same measures across every country, as a tinted matrix.
  const matrix = page.getByRole('img', { name: /as a matrix/ })
  await expect(matrix).toBeVisible()
  await expect(matrix.getByRole('columnheader', { name: 'Testland' })).toBeVisible()
  await expect(matrix.getByRole('rowheader', { name: 'Loneliness' })).toBeVisible()

  // Switch to adjusted: intervals appear, the control set is spelled out,
  // and the figure links to the model card.
  await page
    .getByRole('group', { name: 'Model' })
    .getByText('Adjusted difference', { exact: true })
    .click()
  await expect(page).toHaveURL(/outcome=HAPPY&adjusted=true$/)
  await expect(page.getByText(/Lines are 95% confidence intervals/).first()).toBeVisible()
  await expect(page.getByText(/The model holds age band, gender/).first()).toBeVisible()
  await page.getByRole('link', { name: 'Read the model card' }).first().click()
  await expect(page).toHaveURL(/\/model-cards#continuous$/)
  await expect(page.getByRole('heading', { name: 'Model card: continuous outcomes' })).toBeVisible()
  await expect(page.getByText(/No causal claim/).first()).toBeVisible()
})

async function streamToString(download: {
  createReadStream: () => Promise<NodeJS.ReadableStream>
}): Promise<string> {
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer))
  return Buffer.concat(chunks).toString('utf8')
}
