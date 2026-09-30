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
import { renderMethods } from '../views/MethodsView'
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

describe('renderMethods', () => {
  const headingIds = (html: string) =>
    [...html.matchAll(/<h\d id="([^"]*)">/g)].map((match) => match[1] ?? '')

  test('a heading takes the id GitHub gives it', () => {
    const source = [
      '## All countries: the average of the countries',
      '## Subgroups (domain estimation)',
      '## Change — Y1 to Y2',
      '## The `w_r2` weight',
      '## Türkiye’s sample',
    ].join('\n\n')
    expect(headingIds(renderMethods(source))).toEqual([
      'all-countries-the-average-of-the-countries',
      'subgroups-domain-estimation',
      'change--y1-to-y2',
      'the-w_r2-weight',
      'türkiyes-sample',
    ])
  })

  test('a repeated heading is numbered, and each parse counts afresh', () => {
    const source = ['## Data', '## Data', '## Data 1', '## Data'].join('\n\n')
    const unique = ['data', 'data-1', 'data-1-1', 'data-2']
    expect(headingIds(renderMethods(source))).toEqual(unique)
    // A second visit to the page parses again: the same ids, no -1s.
    expect(headingIds(renderMethods(source))).toEqual(unique)
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
    // Every link to one of the document's own sections finds its heading:
    // the ids are GitHub's, so the same links work there and here.
    const sectionLinks = [...methodsSource.matchAll(/\]\(#([^)\s]+)\)/g)].map(
      (match) => match[1] ?? '',
    )
    expect(sectionLinks.length).toBeGreaterThan(0)
    for (const id of sectionLinks) {
      expect(document.getElementById(id), id).toBeInstanceOf(HTMLHeadingElement)
    }
    // Every table of the source renders inside a box of its own, which
    // scrolls sideways where a phone is too narrow for the table — the
    // page never does (journey 11 holds the widths).
    const sourceTables = methodsSource.match(/^\|(?:\s*:?-+:?\s*\|)+\s*$/gm) ?? []
    expect(sourceTables.length).toBeGreaterThan(0)
    const tables = screen.getAllByRole('table')
    expect(tables).toHaveLength(sourceTables.length)
    for (const table of tables) {
      expect(table.parentElement?.className).toContain('tableScroll')
    }
    // The serving policy comes from meta, not hard-coded copy: with the
    // ADR-0011 zeros, the page says every cell is shown.
    expect(await screen.findByText(/Every cell is shown, however small/)).toBeInTheDocument()
    expect(screen.getByText(/Associations, not causes\./)).toBeInTheDocument()
  })
})
