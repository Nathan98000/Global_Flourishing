// Codebook and Methods: search semantics, why-not copy, and the rendered
// METHODS.md carrying its own headings (the file is the source, §2.8).

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import methodsSource from '../../../../docs/METHODS.md?raw'
import type { VariableDetail, WeightSpec } from '../api/types'
import { createAppRouter } from '../router'
import { filterVariables } from '../views/CodebookView'
import { whyNotChartable } from '../views/CodebookDetailView'
import { renderMethods } from '../views/MethodsView'
import {
  eligibleWords,
  isMethodsFigure,
  methodsParts,
  methodsSections,
} from '../views/methods/document'
import { MethodsFigure } from '../views/methods/MethodsFigures'
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
    // The Codebook is reached from here, not the nav (ADR-0021).
    expect(screen.getByRole('link', { name: 'Browse the Codebook →' })).toHaveAttribute(
      'href',
      '/codebook',
    )
    // The contents list names every section and lands on its heading.
    const contents = screen.getByRole('navigation', { name: 'On this page' })
    const entries = within(contents).getAllByRole('link')
    expect(entries.map((link) => link.textContent)).toEqual(sourceHeadings.map(plainHeading))
    for (const link of entries) {
      const id = link.getAttribute('href')?.slice(1) ?? ''
      expect(document.getElementById(id), id).toBeInstanceOf(HTMLHeadingElement)
    }
    // Every diagram the document asks for is on the page.
    const marks = [...methodsSource.matchAll(/<!--\s*figure:\s*([a-z-]+)\s*-->/g)].map(
      (match) => match[1],
    )
    expect(
      [...document.querySelectorAll('[data-figure]')].map((node) =>
        node.getAttribute('data-figure'),
      ),
    ).toEqual(marks)
  })
})

/** A heading's words without its Markdown (the contents list's text). */
function plainHeading(heading: string): string {
  return heading.replace(/`/g, '').replace(/\*\*/g, '')
}

describe('Methods diagrams', () => {
  test('every figure mark names a diagram and sits between blocks, never inside one', () => {
    const marks = [...methodsSource.matchAll(/<!--\s*figure:\s*([a-z-]+)\s*-->/g)].map(
      (match) => match[1] ?? '',
    )
    expect(marks.length).toBeGreaterThanOrEqual(5)
    for (const mark of marks) expect(isMethodsFigure(mark), mark).toBe(true)
    const parts = methodsParts(renderMethods(methodsSource))
    expect(parts.flatMap((part) => ('figure' in part ? [part.figure] : []))).toEqual(marks)
    // The page is cut at the marks: each run must open and close its own
    // lists, folds and tables, or the browser would mend them wrongly.
    for (const part of parts) {
      if (!('html' in part)) continue
      for (const tag of ['details', 'ul', 'ol', 'table']) {
        const opened = part.html.match(new RegExp(`<${tag}[\\s>]`, 'g'))?.length ?? 0
        const closed = part.html.match(new RegExp(`</${tag}>`, 'g'))?.length ?? 0
        expect(closed, tag).toBe(opened)
      }
    }
    // A mark naming no diagram is dropped, not rendered as text.
    expect(methodsParts('<p>a</p><!-- figure: nonsense --><p>b</p>')).toEqual([
      { html: '<p>a</p>' },
      { html: '<p>b</p>' },
    ])
  })

  test('the contents list is the H2s, markup stripped', () => {
    expect(
      methodsSections(renderMethods('## The `w_r2` weight\n\ntext\n\n### Not listed\n\n## Data')),
    ).toEqual([
      { id: 'the-w_r2-weight', title: 'The w_r2 weight' },
      { id: 'data', title: 'Data' },
    ])
  })

  test('the weights diagram is drawn from the served table, global rules only', () => {
    const spec = (overrides: Partial<WeightSpec>): WeightSpec => ({
      key: 'y1',
      kind: 'cross_section',
      scope: 'global',
      waves: ['Y1'],
      weight: 'w_c1',
      is_default: true,
      rationale: 'Why this weight.',
      requires_retained_y2: false,
      requires_has_midyear: false,
      requires_midyear_type_1: false,
      state_column: null,
      ...overrides,
    })
    const table = [
      spec({}),
      spec({
        key: 'my_y2',
        kind: 'paired_change',
        waves: ['MY', 'Y2'],
        weight: 'w_l1m2',
        requires_retained_y2: true,
        requires_has_midyear: true,
        requires_midyear_type_1: true,
      }),
      spec({ key: 'us_state:y1', scope: 'us_state', weight: 'w_state_c1' }),
    ]
    render(<MethodsFigure name="waves" meta={{ ...testMeta, weight_table: table }} />)
    const drawing = screen.getByRole('img')
    expect(drawing.getAttribute('aria-label')).toContain('Y1 uses w_c1')
    expect(drawing.getAttribute('aria-label')).toContain('MY to Y2 uses w_l1m2')
    const text = drawing.textContent ?? ''
    expect(text).toContain('everyone')
    expect(text).toContain('in Wave 2 and a standalone midyear')
    expect(text).not.toContain('w_state_c1')
    // No table, no diagram (never an empty frame).
    const { container } = render(<MethodsFigure name="waves" meta={testMeta} />)
    expect(container.querySelector('figure')).toBeNull()
  })

  test('who a rule counts, in words, from its flags', () => {
    const flags = (retained: boolean, midyear: boolean, standalone: boolean) => ({
      requires_retained_y2: retained,
      requires_has_midyear: midyear,
      requires_midyear_type_1: standalone,
    })
    expect(eligibleWords(flags(false, false, false))).toBe('everyone')
    expect(eligibleWords(flags(true, false, false))).toBe('in Wave 2')
    expect(eligibleWords(flags(false, true, false))).toBe('in the midyear')
    expect(eligibleWords(flags(true, true, false))).toBe('in Wave 2 and the midyear')
    expect(eligibleWords(flags(true, true, true))).toBe('in Wave 2 and a standalone midyear')
  })

  test('every diagram draws in tokens only, with words for assistive tech', () => {
    for (const name of ['reading', 'weighting', 'clustering', 'average', 'change'] as const) {
      const { container, unmount } = render(<MethodsFigure name={name} />)
      const svg = container.querySelector('svg')
      expect(svg?.getAttribute('role'), name).toBe('img')
      expect(svg?.getAttribute('aria-label')?.length, name).toBeGreaterThan(40)
      expect(container.querySelector('figcaption')?.textContent?.length, name).toBeGreaterThan(20)
      expect(container.innerHTML, name).not.toMatch(/#[0-9a-f]{3,6}\b/i)
      unmount()
    }
  })
})
