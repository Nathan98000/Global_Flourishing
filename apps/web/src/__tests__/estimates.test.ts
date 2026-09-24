// The static-first fetch layer (ADR-0009): path computation, the 404 and
// SPA-fallback miss checks, negative caching, API fallback, typed errors.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  canonicalKey,
  canonicalParams,
  exportCsvUrl,
  fetchEstimates,
  resetNegativePathCache,
  staticPathFor,
  type AggregateRequest,
} from '../api/estimates'
import { ApiError, NetworkError } from '../api/errors'
import { fetchApiJson } from '../api/http'
import {
  attendVariable,
  happyVariable,
  testMeta,
  testResponse,
  testRow,
} from '../test-utils/fixtures'

const context = {
  variable: happyVariable,
  breakdowns: testMeta.breakdowns,
  dataVersion: 'test.1.0.0',
}

const byCountry: AggregateRequest = {
  outcome: 'HAPPY',
  wave: 'Y1',
  stat: 'mean',
  by: ['country_code'],
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

beforeEach(() => resetNegativePathCache())
afterEach(() => vi.unstubAllGlobals())

describe('staticPathFor', () => {
  test('the Atlas and Breakdowns views are precomputed', () => {
    expect(staticPathFor(byCountry, context)).toBe('v1/HAPPY/Y1/mean_by-country_code.json')
    expect(staticPathFor({ ...byCountry, by: ['country_code', 'age_band'] }, context)).toBe(
      'v1/HAPPY/Y1/mean_by-country_code-age_band.json',
    )
    expect(staticPathFor({ ...byCountry, stat: 'distribution' }, context)).toBe(
      'v1/HAPPY/Y1/distribution_by-country_code.json',
    )
    expect(
      staticPathFor(
        { ...byCountry, outcome: 'ATTEND_SVCS', stat: 'proportion' },
        { ...context, variable: attendVariable },
      ),
    ).toBe('v1/ATTEND_SVCS/Y1/proportion_by-country_code.json')
  })

  test('everything the exporter did not precompute goes to the API', () => {
    // filters, oriented, quantiles, a non-default stat, a variable-valued
    // by, three dimensions, an unknown outcome, a wave the item lacks.
    expect(staticPathFor({ ...byCountry, countries: [22] }, context)).toBeNull()
    expect(
      staticPathFor({ ...byCountry, filters: [{ column: 'gender', values: [1] }] }, context),
    ).toBeNull()
    expect(staticPathFor({ ...byCountry, oriented: true }, context)).toBeNull()
    expect(staticPathFor({ ...byCountry, stat: 'quantile', p: [0.5] }, context)).toBeNull()
    expect(staticPathFor({ ...byCountry, stat: 'proportion' }, context)).toBeNull()
    expect(staticPathFor({ ...byCountry, by: ['country_code', 'ATTEND_SVCS'] }, context)).toBeNull()
    expect(
      staticPathFor({ ...byCountry, by: ['country_code', 'age_band', 'gender'] }, context),
    ).toBeNull()
    expect(staticPathFor(byCountry, { ...context, variable: undefined })).toBeNull()
    expect(staticPathFor({ ...byCountry, wave: 'MY' }, context)).toBeNull()
    // distribution is only precomputed for 0–10 scales, and only by country.
    expect(
      staticPathFor(
        { ...byCountry, outcome: 'ATTEND_SVCS', stat: 'distribution' },
        { ...context, variable: attendVariable },
      ),
    ).toBeNull()
    expect(
      staticPathFor(
        { ...byCountry, stat: 'distribution', by: ['country_code', 'age_band'] },
        context,
      ),
    ).toBeNull()
  })
})

describe('canonicalParams', () => {
  test('stable order, API names, repeated by and filter', () => {
    const request: AggregateRequest = {
      outcome: 'HAPPY',
      wave: 'Y2',
      stat: 'mean',
      by: ['country_code', 'age_band'],
      countries: [1, 22],
      filters: [{ column: 'gender', values: [1, 2] }],
      oriented: true,
    }
    expect(canonicalParams(request).toString()).toBe(
      'outcome=HAPPY&wave=Y2&stat=mean&by=country_code&by=age_band' +
        '&filter=country_code%3A1&filter=country_code%3A22' +
        '&filter=gender%3A1&filter=gender%3A2&oriented=true',
    )
    expect(canonicalKey(request)).toBe(canonicalParams(request).toString())
  })

  test('p rides only with quantiles', () => {
    expect(canonicalParams({ ...byCountry, p: [0.5] }).toString()).not.toContain('p=')
    expect(
      canonicalParams({ ...byCountry, stat: 'quantile', p: [0.25, 0.75] }).toString(),
    ).toContain('p=0.25&p=0.75')
  })

  test('export URL shares the exact query', () => {
    expect(exportCsvUrl(byCountry)).toMatch(
      /\/v1\/export\.csv\?outcome=HAPPY&wave=Y1&stat=mean&by=country_code$/,
    )
  })
})

describe('fetchEstimates', () => {
  const payload = testResponse([testRow()])

  test('serves the static tier when the file exists', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)
    const result = await fetchEstimates(byCountry, context)
    expect(result.source).toBe('static')
    expect(result.response.rows).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/data/v1/HAPPY/Y1/mean_by-country_code.json')
  })

  test('a 404 falls back to the API and the miss is remembered', async () => {
    const fetchMock = vi
      .fn(async (_input: RequestInfo | URL) => jsonResponse(payload))
      .mockResolvedValueOnce(new Response('nope', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    const first = await fetchEstimates(byCountry, context)
    expect(first.source).toBe('api')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/v1/aggregate?outcome=HAPPY')

    // Second identical query: the static tier is not asked again.
    const second = await fetchEstimates(byCountry, context)
    expect(second.source).toBe('api')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  test('the SPA fallback (200 text/html) counts as a miss, not data', async () => {
    const fetchMock = vi
      .fn(async (_input: RequestInfo | URL) => jsonResponse(payload))
      .mockResolvedValueOnce(
        new Response('<!doctype html><title>Flourish Atlas</title>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const result = await fetchEstimates(byCountry, context)
    expect(result.source).toBe('api')
  })

  test('API-only queries skip the static tier entirely', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)
    await fetchEstimates({ ...byCountry, oriented: true }, context)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/v1/aggregate?')
  })

  test('API calls revalidate a stored response; static files are fetched plainly', async () => {
    // The API URL carries no data_version, so a cached envelope must be
    // checked with If-None-Match before reuse — or a deploy leaves the
    // browser replaying the previous release's shape for a day.
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(payload),
    )
    vi.stubGlobal('fetch', fetchMock)
    await fetchApiJson('/v1/aggregate?outcome=HAPPY')
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({ cache: 'no-cache' })
    await fetchEstimates(byCountry, context)
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/data/v1/HAPPY/Y1/mean_by-country_code.json')
    expect(fetchMock.mock.calls[1]?.[1]).toBeUndefined()
  })

  test('422s surface the server messages verbatim', async () => {
    const detail = ['HAPPY is not asked at MY; it is available at Y1, Y2']
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      jsonResponse({ detail }, { status: 422 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const error = await fetchEstimates({ ...byCountry, wave: 'MY' }, context).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).kind).toBe('validation')
    expect((error as ApiError).details).toEqual(detail)
  })

  test('429 carries Retry-After; 503 is the no-data state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: 'rate limit exceeded' }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '17' },
        }),
      ),
    )
    const limited = await fetchEstimates({ ...byCountry, oriented: true }, context).catch((e) => e)
    expect((limited as ApiError).kind).toBe('rate-limit')
    expect((limited as ApiError).retryAfterSeconds).toBe(17)

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ detail: 'No data is baked in' }, { status: 503 })),
    )
    const noData = await fetchEstimates({ ...byCountry, oriented: true }, context).catch((e) => e)
    expect((noData as ApiError).kind).toBe('no-data')
  })

  test('a dead network is a NetworkError, not a crash', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    const error = await fetchEstimates({ ...byCountry, oriented: true }, context).catch((e) => e)
    expect(error).toBeInstanceOf(NetworkError)
  })
})
