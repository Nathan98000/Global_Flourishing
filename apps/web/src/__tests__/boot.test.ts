// Boot data: static-first meta and variables, API fallback, one type.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { fetchMeta } from '../api/meta'
import { NAV_ITEMS } from '../nav'
import { fetchVariableDetail, fetchVariables } from '../api/variables'
import { happyVariable, testMeta } from '../test-utils/fixtures'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchMeta', () => {
  test('boots from /data/meta.json without touching the API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(testMeta))
    vi.stubGlobal('fetch', fetchMock)
    const result = await fetchMeta()
    expect(result.source).toBe('static')
    expect(result.meta.data_version).toBe('test.1.0.0')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/data/meta.json')
  })

  test('falls back to /v1/meta when the tier is absent', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('nope', { status: 404 }))
      .mockResolvedValue(jsonResponse(testMeta))
    vi.stubGlobal('fetch', fetchMock)
    const result = await fetchMeta()
    expect(result.source).toBe('api')
    expect(String(fetchMock.mock.calls[1]?.[0])).toMatch(/\/v1\/meta$/)
  })

  test('rejects only when both tiers fail', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('x', { status: 404 }))
        .mockRejectedValue(new TypeError('down')),
    )
    await expect(fetchMeta()).rejects.toThrow()
  })
})

describe('fetchVariables', () => {
  test('indexes by name and reports the tier', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ variables: [happyVariable] })))
    const result = await fetchVariables()
    expect(result.source).toBe('static')
    expect(result.byName['HAPPY']?.default_stat).toBe('mean')
  })
})

describe('fetchVariableDetail', () => {
  test('reads v1/<name>/variable.json first', async () => {
    const detail = { ...happyVariable, wording: 'How happy…?', value_labels: [], missingness: [] }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(detail))
    vi.stubGlobal('fetch', fetchMock)
    const result = await fetchVariableDetail('HAPPY')
    expect(result.source).toBe('static')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/data/v1/HAPPY/variable.json')
  })
})

describe('index.html (H7)', () => {
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8')
  const page = new DOMParser().parseFromString(html, 'text/html')

  test("each data preload matches fetch()'s own request, so it is used, not fetched twice", () => {
    const preloads = [...page.querySelectorAll('link[rel="preload"][as="fetch"]')]
    expect(preloads.map((link) => link.getAttribute('href'))).toEqual([
      '/data/meta.json',
      '/data/variables.json',
      '/data/v1/sfi/Y1/mean_by-country_code.json',
    ])
    for (const link of preloads) expect(link.getAttribute('crossorigin')).toBe('')
  })

  test('the wordmark and the nav paint before any script runs, the app replacing them', () => {
    const root = page.getElementById('root')
    expect(root?.querySelector('h1')?.textContent).toBe('Flourish Atlas')
    const nav = root?.querySelector('nav[aria-label="Main"]')
    expect(
      [...(nav?.querySelectorAll('a') ?? [])].map((link) => link.getAttribute('href')),
    ).toEqual(NAV_ITEMS.map((item) => item.to))
    expect([...(nav?.querySelectorAll('a') ?? [])].map((link) => link.textContent)).toEqual(
      NAV_ITEMS.map((item) => item.label),
    )
    // And the page's shape under them, not blank paper.
    expect(root?.querySelector('main[aria-busy="true"] .boot-field')).not.toBeNull()
  })
})
