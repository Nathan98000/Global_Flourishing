// The Phase 5 fetch layer: /v1/change and /v1/states are API-only,
// their query strings are canonical, the change envelope's row kinds
// narrow by stat, and the warm-up ping is one fire-and-forget request.

import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  canonicalChangeKey,
  canonicalChangeParams,
  changeDistributionRows,
  changeRows,
  fetchChange,
  isChangeStat,
  legsPresent,
  transitionRows,
  type ChangeRequest,
} from '../api/change'
import { ApiError } from '../api/errors'
import { adjustedWeightsExist, canonicalStatesParams, fetchStates } from '../api/states'
import { isStat } from '../api/types'
import { warmApi } from '../api/warm'
import { testResponse, testRow } from '../test-utils/fixtures'

afterEach(() => vi.unstubAllGlobals())

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

const pair: ChangeRequest = { outcome: 'HAPPY', from: 'Y1', to: 'Y2', by: ['country_code'] }

describe('change requests', () => {
  test('canonical params carry the API names in a stable order', () => {
    expect(canonicalChangeParams(pair).toString()).toBe(
      'outcome=HAPPY&from=Y1&to=Y2&by=country_code',
    )
    expect(
      canonicalChangeParams({
        ...pair,
        outcome: 'BALANCE',
        via: 'MY',
        countries: [1],
        filters: [{ column: 'gender', values: [1] }],
        scope: 'us_state',
        rect: true,
      }).toString(),
    ).toBe(
      'outcome=BALANCE&from=Y1&via=MY&to=Y2&by=country_code&filter=country_code%3A1&filter=gender%3A1&scope=us_state&rect=true',
    )
    // The global scope is the API default and stays out of the string.
    expect(canonicalChangeKey({ ...pair, scope: 'global' })).toBe(canonicalChangeKey(pair))
  })

  test('fetchChange hits /v1/change only — never a static path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(testResponse([])))
    vi.stubGlobal('fetch', fetchMock)
    await fetchChange(pair)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(
      /\/v1\/change\?outcome=HAPPY&from=Y1&to=Y2&by=country_code$/,
    )
  })

  test('a 422 surfaces as a validation ApiError with the server messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ detail: ['HAPPY is not asked at MY'] }, { status: 422 })),
    )
    await expect(fetchChange({ ...pair, from: 'MY' })).rejects.toMatchObject({
      kind: 'validation',
      details: ['HAPPY is not asked at MY'],
    })
    await expect(fetchChange({ ...pair, from: 'MY' })).rejects.toBeInstanceOf(ApiError)
  })
})

describe('change row kinds', () => {
  const rows = [
    testRow({ stat: 'change', estimate: 0.12, leg: 'y1_y2' }),
    testRow({ stat: 'change', estimate: 0.05, leg: 'y1_my' }),
    testRow({ stat: 'change_distribution', level: -1, estimate: 0.2 }),
    testRow({ stat: 'change_distribution', level: 0, estimate: 0.5 }),
    testRow({
      stat: 'transition',
      measure: 'transition_conditional',
      from_level: 1,
      to_level: 2,
      estimate: 0.4,
    }),
    testRow({
      stat: 'transition',
      measure: 'transition_joint',
      from_level: 1,
      to_level: 2,
      estimate: 0.1,
    }),
  ]

  test('ChangeStat is its own union — Stat is not widened', () => {
    expect(isChangeStat('change')).toBe(true)
    expect(isChangeStat('transition')).toBe(true)
    expect(isChangeStat('mean')).toBe(false)
    expect(isStat('change')).toBe(false)
  })

  test('helpers narrow by stat, leg and measure', () => {
    expect(changeRows(rows).map((row) => row.estimate)).toEqual([0.12, 0.05])
    expect(changeRows(rows, 'y1_my').map((row) => row.estimate)).toEqual([0.05])
    expect(changeDistributionRows(rows).map((row) => row.level)).toEqual([-1, 0])
    expect(transitionRows(rows).map((row) => row.estimate)).toEqual([0.4])
    expect(transitionRows(rows, 'transition_joint').map((row) => row.estimate)).toEqual([0.1])
    expect(legsPresent(rows)).toEqual(['y1_my', 'y1_y2'])
  })
})

describe('states requests', () => {
  test('canonical params; adj rides only when asked', () => {
    expect(
      canonicalStatesParams({ outcome: 'sfi', wave: 'Y2', stat: 'mean', adj: true }).toString(),
    ).toBe('outcome=sfi&wave=Y2&stat=mean&adj=true')
    expect(canonicalStatesParams({ outcome: 'sfi', wave: 'Y1', stat: 'mean' }).toString()).toBe(
      'outcome=sfi&wave=Y1&stat=mean',
    )
  })

  test('the adjusted weights exist for every wave but the first', () => {
    expect(adjustedWeightsExist('Y1')).toBe(false)
    expect(adjustedWeightsExist('MY')).toBe(true)
    expect(adjustedWeightsExist('Y2')).toBe(true)
  })

  test('fetchStates hits /v1/states', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(testResponse([])))
    vi.stubGlobal('fetch', fetchMock)
    await fetchStates({ outcome: 'sfi', wave: 'Y1', stat: 'mean' })
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(
      /\/v1\/states\?outcome=sfi&wave=Y1&stat=mean$/,
    )
  })
})

describe('warmApi', () => {
  test('one GET /health, errors swallowed, concurrent calls share the request', async () => {
    let resolveFetch: (value: Response) => void = () => undefined
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL) =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const first = warmApi()
    const second = warmApi()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/health$/)
    resolveFetch(new Response('ok'))
    await Promise.all([first, second])
    // After it settles, the next entry pings again.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')))
    await expect(warmApi()).resolves.toBeUndefined()
  })
})
