// Codebook and Methods: search semantics, why-not copy, and the rendered
// METHODS.md carrying its own headings (the file is the source, §2.8).

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import methodsSource from '../../../../docs/METHODS.md?raw'
import type { VariableDetail } from '../api/types'
import { createAppRouter } from '../router'
import { filterVariables } from '../views/CodebookView'
import { whyNotChartable } from '../views/CodebookDetailView'
import { attendVariable, happyVariable, sfiVariable, testMeta } from '../test-utils/fixtures'

afterEach(() => vi.unstubAllGlobals())

describe('filterVariables', () => {
  const list = [happyVariable, attendVariable, sfiVariable]

  test('searches name, display name, label and wording', () => {
    expect(filterVariables(list, { q: 'attend' }).map((v) => v.name)).toEqual(['ATTEND_SVCS'])
    expect(filterVariables(list, { q: 'flourishing' }).map((v) => v.name)).toEqual(['sfi'])
    // wording match ("How would you rate: happiness?")
    expect(filterVariables(list, { q: 'how would you rate' }).map((v) => v.name)).toContain('HAPPY')
  })

  test('family, wave and scale filters combine', () => {
    expect(filterVariables(list, { q: '', family: 'derived' }).map((v) => v.name)).toEqual(['sfi'])
    expect(filterVariables(list, { q: '', wave: 'MY' })).toEqual([])
    expect(filterVariables(list, { q: '', scale: 'ordinal' }).map((v) => v.name)).toEqual([
      'ATTEND_SVCS',
    ])
  })
})

describe('whyNotChartable', () => {
  const base: VariableDetail = {
    ...happyVariable,
    value_labels: [],
    missingness: [],
    scoring: null,
    components: [],
  }

  test('country-specific items say why they wait', () => {
    const detail = { ...base, servable: false, is_country_specific: true }
    expect(whyNotChartable(detail)).toContain('Country-specific')
  })

  test('non-substantive scales say so', () => {
    const detail = { ...base, servable: false, scale_type: 'string' }
    expect(whyNotChartable(detail)).toContain('“string”')
  })
})

describe('Methods view', () => {
  test('renders METHODS.md itself — its headings are on the page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes('/data/meta.json')
          ? new Response(JSON.stringify(testMeta), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          : new Response('x', { status: 404 }),
      ),
    )
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    const router = createAppRouter(createMemoryHistory({ initialEntries: ['/methods'] }))
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
    await router.load()

    // Every H2 of the source document renders as a heading.
    const sourceHeadings = [...methodsSource.matchAll(/^## (.+)$/gm)].map((match) =>
      (match[1] ?? '').trim(),
    )
    expect(sourceHeadings.length).toBeGreaterThan(5)
    for (const heading of sourceHeadings) {
      expect(await screen.findByRole('heading', { name: heading }), heading).toBeInTheDocument()
    }
    // The serving policy comes from meta, not hard-coded copy: with the
    // ADR-0011 zeros, the page says every cell is shown.
    expect(await screen.findByText(/Every cell is shown, however small/)).toBeInTheDocument()
    expect(screen.getByText(/Associations, not causes\./)).toBeInTheDocument()
  })
})
