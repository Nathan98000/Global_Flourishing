// Boot data: static-first meta and variables, API fallback, one type.

import { afterEach, describe, expect, test, vi } from 'vitest'
import { fetchMeta } from '../api/meta'
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
