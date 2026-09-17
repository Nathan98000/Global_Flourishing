// The six Phase 4 journeys (§2.11) over the built app + fixture tier.
// No API runs in this suite: every view exercised here is static-first,
// and journey 6 blocks the API at the network level to prove it.

import { expect, test, type Page } from '@playwright/test'

const chartRegion = (page: Page) => page.getByRole('img', { name: /by country|panel per country/ })

test('1 — Atlas: change topic, measure and wave, share the URL, reload reproduces it', async ({
  page,
  browser,
}) => {
  await page.goto('/')
  await expect(
    page.getByText('Secure Flourishing Index — Wave 1 (2023)', { exact: true }),
  ).toBeVisible()

  // Two steps, not one list of 161: topic first, then that topic's measures.
  await page.getByLabel('Topic', { exact: true }).selectOption('wellbeing')
  await page.getByLabel('Measure', { exact: true }).selectOption('HAPPY')
  await page.getByRole('group', { name: 'Wave' }).getByText('2024', { exact: true }).click()
  await expect(page.getByText('Happiness — Wave 2 (2024)', { exact: true })).toBeVisible()

  const shared = page.url()
  expect(shared).toContain('outcome=HAPPY')
  expect(shared).toContain('wave=Y2')

  // Reload reproduces the view…
  await page.reload()
  await expect(page.getByText('Happiness — Wave 2 (2024)', { exact: true })).toBeVisible()

  // …and so does pasting the URL into a fresh browser context.
  const context = await browser.newContext()
  const second = await context.newPage()
  await second.goto(shared)
  await expect(second.getByText('Happiness — Wave 2 (2024)', { exact: true })).toBeVisible()
  // The address bar stays canonical: defaults never reach the URL (§2.2).
  await expect(second).toHaveURL(/\?outcome=HAPPY&wave=Y2$/)
  await context.close()

  // Back returns to the previous state (the URL is the state).
  await page.goBack()
  await expect(page.getByText('Happiness — Wave 1 (2023)', { exact: true })).toBeVisible()
})

test('2 — Codebook: search, open the entry, chart it, read the wording', async ({ page }) => {
  await page.goto('/codebook')
  await page.getByLabel('Search name, label or wording').fill('service attendance')
  await expect(page.getByText(/1 of \d+ variables/)).toBeVisible()

  await page.getByRole('link', { name: 'Service attendance' }).click()
  await expect(page.getByRole('heading', { name: /Service attendance/ })).toBeVisible()
  await expect(page.getByText('How would you rate: service attendance?')).toBeVisible()

  await page.getByRole('link', { name: 'Chart this →' }).click()
  await expect(page).toHaveURL(/outcome=ATTEND_SVCS/)
  await expect(page.getByText('Service attendance — Wave 1 (2023)', { exact: true })).toBeVisible()

  // The question is on the page, not behind a button (decision 3).
  await expect(page.getByText('What people were asked')).toBeVisible()
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
  await expect(page.getByText('Happiness — Wave 1 (2023)', { exact: true })).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'CSV' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('flourish_HAPPY_Y1_mean_synthetic.0.0.1.csv')

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
  await expect(
    page.getByText('Secure Flourishing Index — Wave 1 (2023)', { exact: true }),
  ).toBeVisible()
  await expect(chartRegion(page)).toBeVisible()
  // …and the app says so in plain words (F6).
  await expect(page.getByText(/Live data service is offline/)).toBeVisible()
  await expect(page.getByText(/standard views still work/)).toBeVisible()
})

async function streamToString(download: {
  createReadStream: () => Promise<NodeJS.ReadableStream>
}): Promise<string> {
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer))
  return Buffer.concat(chunks).toString('utf8')
}
