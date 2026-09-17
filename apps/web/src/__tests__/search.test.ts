// URL state round-trip: parse → serialize → parse reproduces the view,
// defaults stay out of the URL, invalid values degrade with a notice.

import { describe, expect, test } from 'vitest'
import {
  ATLAS_DEFAULTS,
  atlasRequest,
  atlasSearchParams,
  breakdownsRequest,
  breakdownsSearchParams,
  parseAtlasSearch,
  parseBreakdownsSearch,
  parseCodebookSearch,
} from '../state/search'
import { parseSearchString, stringifySearch } from '../state/searchCodec'
import { happyVariable } from '../test-utils/fixtures'

describe('search codec', () => {
  test('repeated keys become arrays and round-trip API-style', () => {
    const raw = parseSearchString('?outcome=HAPPY&by=country_code&by=age_band')
    expect(raw).toEqual({ outcome: 'HAPPY', by: ['country_code', 'age_band'] })
    expect(stringifySearch(raw)).toBe('?outcome=HAPPY&by=country_code&by=age_band')
  })

  test('empty, undefined and false are omitted; true serializes bare', () => {
    expect(stringifySearch({ a: undefined, b: null, c: false, d: true, e: [] })).toBe('?d=true')
    expect(stringifySearch({})).toBe('')
  })
})

describe('atlas search', () => {
  test('defaults apply and are omitted from the URL', () => {
    const search = parseAtlasSearch({})
    expect(search).toEqual(ATLAS_DEFAULTS)
    expect(stringifySearch(atlasSearchParams(search))).toBe('')
  })

  test('a full URL round-trips exactly', () => {
    const raw = parseSearchString('?outcome=HAPPY&wave=Y2&view=map&countries=1,22&sort=name')
    const search = parseAtlasSearch(raw)
    expect(search.outcome).toBe('HAPPY')
    expect(search.wave).toBe('Y2')
    expect(search.view).toBe('map')
    expect(search.countries).toEqual([1, 22])
    expect(search.sort).toBe('name')
    const serialized = stringifySearch(atlasSearchParams(search))
    expect(parseAtlasSearch(parseSearchString(serialized))).toEqual(search)
  })

  test('invalid values degrade to defaults and are reported, not thrown', () => {
    const search = parseAtlasSearch({ wave: 'Y9', view: 'pie', countries: 'x,y' })
    expect(search.wave).toBe('Y1')
    expect(search.view).toBe('bars')
    expect(search.countries).toEqual([])
    expect(search.invalid).toEqual(['wave', 'view', 'countries'])
    // Serialization keeps the rejected raw params (they are what was
    // typed), so any re-parse — including the router's own URL
    // normalization — recomputes the SAME full notice (F5)…
    const serialized = stringifySearch(atlasSearchParams(search))
    expect(serialized).toBe('?wave=Y9&view=pie&countries=x%2Cy')
    expect(parseAtlasSearch(parseSearchString(serialized)).invalid).toEqual([
      'wave',
      'view',
      'countries',
    ])
    // …dismissing strips them…
    expect(
      stringifySearch(atlasSearchParams({ ...search, invalid: undefined, invalidRaw: undefined })),
    ).toBe('')
    // …an explicit new value for one control drops only that leftover…
    expect(stringifySearch(atlasSearchParams({ ...search, wave: 'Y2' }))).toBe(
      '?wave=Y2&view=pie&countries=x%2Cy',
    )
    // …and a forged ?invalid=wave cannot conjure a notice (the parser
    // recomputes it from the actual params).
    expect(parseAtlasSearch({ invalid: 'wave' }).invalid).toBeUndefined()
  })

  test('oriented is an explicit opt-in', () => {
    expect(parseAtlasSearch({ oriented: 'true' }).oriented).toBe(true)
    expect(parseAtlasSearch({ oriented: 'yes' }).invalid).toEqual(['oriented'])
  })

  test("dir rides the URL only when it differs from the sort's default", () => {
    // Defaults: values high-first, names A→Z — omitted from the URL.
    expect(stringifySearch(atlasSearchParams(parseAtlasSearch({ dir: 'desc' })))).toBe('')
    expect(stringifySearch(atlasSearchParams(parseAtlasSearch({ dir: 'asc' })))).toBe('?dir=asc')
    expect(stringifySearch(atlasSearchParams(parseAtlasSearch({ sort: 'name', dir: 'asc' })))).toBe(
      '?sort=name',
    )
    expect(
      stringifySearch(atlasSearchParams(parseAtlasSearch({ sort: 'name', dir: 'desc' }))),
    ).toBe('?sort=name&dir=desc')
    expect(parseAtlasSearch({ dir: 'sideways' }).invalid).toEqual(['dir'])
  })

  test('topic (mid-selection) round-trips; absent = inferred from the measure', () => {
    expect(parseAtlasSearch({}).topic).toBeUndefined()
    const search = parseAtlasSearch({ topic: 'wellbeing' })
    expect(search.topic).toBe('wellbeing')
    expect(stringifySearch(atlasSearchParams(search))).toBe('?topic=wellbeing')
    expect(parseAtlasSearch({ topic: 'not a name!' }).invalid).toEqual(['topic'])
  })

  test('the request uses the API names and the server default stat', () => {
    const search = parseAtlasSearch({ outcome: 'HAPPY' })
    const request = atlasRequest(search, happyVariable)
    expect(request).toEqual({
      outcome: 'HAPPY',
      wave: 'Y1',
      stat: 'mean',
      by: ['country_code'],
      oriented: undefined,
    })
    expect(atlasRequest({ ...search, stat: 'distribution' }, happyVariable).stat).toBe(
      'distribution',
    )
  })
})

describe('breakdowns search', () => {
  test('by accepts one or two non-country dimensions', () => {
    expect(parseBreakdownsSearch({ by: 'gender' }).by).toEqual(['gender'])
    expect(parseBreakdownsSearch({ by: ['gender', 'ATTEND_SVCS'] }).by).toEqual([
      'gender',
      'ATTEND_SVCS',
    ])
    expect(parseBreakdownsSearch({ by: 'country_code' }).invalid).toEqual(['by'])
    expect(parseBreakdownsSearch({ by: ['a', 'b', 'c'] }).invalid).toEqual(['by'])
    expect(parseBreakdownsSearch({ by: ['gender', 'gender'] }).invalid).toEqual(['by'])
  })

  test('country_code leads the request by-list', () => {
    const search = parseBreakdownsSearch({ outcome: 'HAPPY', by: 'gender' })
    expect(breakdownsRequest(search, happyVariable).by).toEqual(['country_code', 'gender'])
  })

  test('defaults are omitted; non-defaults serialize API-style', () => {
    expect(stringifySearch(breakdownsSearchParams(parseBreakdownsSearch({})))).toBe('')
    const search = parseBreakdownsSearch({ by: ['gender', 'ATTEND_SVCS'], sort: 'gap' })
    expect(stringifySearch(breakdownsSearchParams(search))).toBe(
      '?by=gender&by=ATTEND_SVCS&sort=gap',
    )
  })
})

describe('codebook search', () => {
  test('parses and clamps', () => {
    const search = parseCodebookSearch({ q: 'happy', family: 'wellbeing', wave: 'Y2' })
    expect(search).toEqual({ q: 'happy', family: 'wellbeing', wave: 'Y2' })
    expect(parseCodebookSearch({ q: 'x'.repeat(500) }).q).toHaveLength(200)
    expect(parseCodebookSearch({ wave: 'nope' }).invalid).toEqual(['wave'])
  })
})
