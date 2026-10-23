// The Codebook list (H16, H18): one h1 on the page (the wordmark), the
// list's title an h2; each "Chart it →" named by its question; and its
// count says how it meets the question picker's.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { ApiHealth } from '../api/types'
import { createAppRouter } from '../router'
import { happyVariable, sfiVariable, testMeta } from '../test-utils/fixtures'

const okHealth: ApiHealth = {
  status: 'ok',
  service: 'flourish-atlas-api',
  version: '0.2.0',
  git_sha: null,
  data: 'ok',
  data_version: 'test.1.0.0',
}

// A catalog of three: two chartable, one not.
const notChartable = { ...happyVariable, name: 'INCOME', display_name: 'Income', servable: false }
const routes: Record<string, unknown> = {
  '/data/meta.json': testMeta,
  '/data/variables.json': { variables: [sfiVariable, happyVariable, notChartable] },
  '/health': okHealth,
}

afterEach(() => vi.unstubAllGlobals())

async function renderCodebook() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const hit = Object.entries(routes).find(([needle]) => String(input).includes(needle))
      return hit
        ? new Response(JSON.stringify(hit[1]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : new Response('x', { status: 404 })
    }),
  )
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  const router = createAppRouter(createMemoryHistory({ initialEntries: ['/codebook'] }))
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  await router.load()
}

test('the list is an h2 under the one h1, the wordmark', async () => {
  await renderCodebook()
  expect(await screen.findByRole('heading', { level: 2, name: 'Codebook' })).toBeInTheDocument()
  expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([
    'Flourish Atlas',
  ])
})

test('each "Chart it →" is named by its question, its visible words first', async () => {
  await renderCodebook()
  const link = await screen.findByRole('link', { name: 'Chart it: Happiness' })
  expect(link).toHaveTextContent('Chart it →')
  expect(link).toHaveAttribute('href', '/?outcome=HAPPY')
  // A question that can't be charted has no such link.
  expect(screen.queryByRole('link', { name: 'Chart it: Income' })).toBeNull()
  const row = link.closest('tr') as HTMLElement
  expect(within(row).getByRole('link', { name: 'Happiness' })).toHaveAttribute(
    'href',
    '/codebook/HAPPY',
  )
})

test('its count says how many of its questions the picker can chart', async () => {
  await renderCodebook()
  expect(await screen.findByText('3 questions, 2 of them chartable')).toHaveAttribute(
    'role',
    'status',
  )
})
