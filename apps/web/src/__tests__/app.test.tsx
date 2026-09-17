// The shell end to end: static-first boot, honest banners, the Atlas
// table from the static tier, invalid-param notices, 404.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { resetNegativePathCache } from '../api/estimates'
import type { ApiHealth } from '../api/types'
import { createAppRouter } from '../router'
import { sfiVariable, testMeta, testResponse, testRow } from '../test-utils/fixtures'

const okHealth: ApiHealth = {
  status: 'ok',
  service: 'flourish-atlas-api',
  version: '0.2.0',
  git_sha: 'abc1234def',
  data: 'ok',
  data_version: 'test.1.0.0',
}

const sfiByCountry = testResponse(
  [
    testRow({ group: { country_code: 1 }, estimate: 6.9, ci_lo: 6.8, ci_hi: 7.0 }),
    testRow({ group: { country_code: 22 }, estimate: 7.4, ci_lo: 7.3, ci_hi: 7.5 }),
  ],
  { outcome: 'sfi' },
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

const staticTier: Routes = {
  '/data/meta.json': testMeta,
  '/data/variables.json': { variables: [sfiVariable] },
  '/data/v1/sfi/Y1/mean_by-country_code.json': sfiByCountry,
  '/health': okHealth,
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

test('the shell renders nav, DOI citation and the live data version', async () => {
  mockFetch(staticTier)
  await renderAt('/')
  const nav = await screen.findByRole('navigation', { name: 'Main' })
  for (const label of ['Atlas', 'Breakdowns', 'Codebook', 'Methods']) {
    expect(nav).toHaveTextContent(label)
  }
  expect(screen.getByRole('link', { name: /Global Flourishing Study/ })).toHaveAttribute(
    'href',
    'https://doi.org/10.17605/OSF.IO/3JTZ8',
  )
  expect(await screen.findByText(/data version: test\.1\.0\.0/)).toBeInTheDocument()
  expect(await screen.findByText(/API: ok · v0\.2\.0 · sha abc1234/)).toBeInTheDocument()
})

test('the Atlas renders from the static tier and says so', async () => {
  const calls = mockFetch(staticTier)
  await renderAt('/')
  expect(await screen.findByText('United States')).toBeInTheDocument()
  expect(screen.getByText('served from precomputed files')).toBeInTheDocument()
  expect(screen.getByText(/weighted \(w_c1\)/)).toBeInTheDocument()
  expect(calls.some((url) => url.includes('/v1/aggregate'))).toBe(false)
})

test('with the API down the Atlas still renders, with an honest banner', async () => {
  mockFetch({ ...staticTier, '/health': new TypeError('fetch failed') })
  await renderAt('/')
  expect(await screen.findByText('United States')).toBeInTheDocument()
  expect(screen.getByText(/showing precomputed views/)).toBeInTheDocument()
  expect(screen.getByText(/API unreachable/)).toBeInTheDocument()
})

test('an API without a data build is its own banner', async () => {
  mockFetch({ ...staticTier, '/health': { ...okHealth, data: 'absent', data_version: null } })
  await renderAt('/')
  expect(await screen.findByText('United States')).toBeInTheDocument()
  expect(screen.getByText(/precomputed views work/)).toBeInTheDocument()
})

test('with no data source at all the shell renders honestly', async () => {
  mockFetch({ '/health': new TypeError('down') })
  await renderAt('/')
  expect(await screen.findByText(/No data source is reachable/)).toBeInTheDocument()
  expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
})

test('invalid search params degrade to defaults with a visible notice', async () => {
  mockFetch(staticTier)
  await renderAt('/?wave=Y9&view=pie')
  expect(
    await screen.findByText(/invalid and were reset to defaults: wave, view/),
  ).toBeInTheDocument()
  // The view still renders the default query, not a crash.
  expect(await screen.findByText('United States')).toBeInTheDocument()
})

test('unknown routes render the not-found page', async () => {
  mockFetch(staticTier)
  await renderAt('/nowhere')
  expect(await screen.findByText('Page not found')).toBeInTheDocument()
})
