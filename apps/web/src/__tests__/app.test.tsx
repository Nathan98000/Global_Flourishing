import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { ApiHealth } from '../api/health'
import { createAppRouter } from '../router'

const okHealth: ApiHealth = {
  status: 'ok',
  service: 'flourish-atlas-api',
  version: '0.1.0',
  git_sha: 'abc1234def',
  data_version: null,
}

function mockFetchOk() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(okHealth) }),
  )
}

function mockFetchDown() {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

async function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }))
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  await router.load()
}

test('root layout renders nav and the DOI footer with a data-version slot', async () => {
  mockFetchOk()
  await renderAt('/')
  expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  const doiLink = screen.getByRole('link', { name: /Global Flourishing Study/ })
  expect(doiLink).toHaveAttribute('href', 'https://doi.org/10.17605/OSF.IO/3JTZ8')
  expect(screen.getByText(/data version:/)).toBeInTheDocument()
})

test('index shows the API status line when the API is up', async () => {
  mockFetchOk()
  await renderAt('/')
  expect(await screen.findByText('API: ok · v0.1.0 · sha abc1234')).toBeInTheDocument()
  // Cloud Run reserves /healthz on *.run.app, so the hook must probe /health.
  expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/health$/))
})

test('index shows "API unreachable" when the fetch fails', async () => {
  mockFetchDown()
  await renderAt('/')
  expect(await screen.findByText('API unreachable')).toBeInTheDocument()
})

test('methods route renders', async () => {
  mockFetchOk()
  await renderAt('/methods')
  expect(await screen.findByRole('heading', { name: 'Methods' })).toBeInTheDocument()
  expect(screen.getByText(/Associations, not causes/)).toBeInTheDocument()
})
