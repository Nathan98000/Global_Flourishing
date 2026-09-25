// URL state round-trip: parse → serialize → parse reproduces the view,
// defaults stay out of the URL, invalid values degrade with a notice.

import { describe, expect, test } from 'vitest'
import {
  ATLAS_DEFAULTS,
  CHANGE_DEFAULTS,
  COMPARE_MAX_COUNTRIES,
  COMPARE_MIN_COUNTRIES,
  CORRELATES_DEFAULTS,
  atlasRequest,
  atlasSearchParams,
  breakdownsRequest,
  breakdownsSearchParams,
  changeRequest,
  changeSearchParams,
  compareRequest,
  compareSearchParams,
  correlatesAcrossCountries,
  correlatesRequest,
  correlatesSearchParams,
  parseAtlasSearch,
  parseBreakdownsSearch,
  parseChangeSearch,
  parseCodebookSearch,
  parseCompareSearch,
  parseCorrelatesSearch,
  parseStatesSearch,
  parseWhatMattersSearch,
  statesRequest,
  statesSearchParams,
  whatMattersRequest,
  whatMattersSearchParams,
} from '../state/search'
import { parseSearchString, stringifySearch } from '../state/searchCodec'
import { happyVariable, sfiVariable } from '../test-utils/fixtures'

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
    const raw = parseSearchString('?outcome=HAPPY&wave=Y2&countries=1,22&sort=name')
    const search = parseAtlasSearch(raw)
    expect(search.outcome).toBe('HAPPY')
    expect(search.wave).toBe('Y2')
    expect(search.countries).toEqual([1, 22])
    expect(search.sort).toBe('name')
    const serialized = stringifySearch(atlasSearchParams(search))
    expect(parseAtlasSearch(parseSearchString(serialized))).toEqual(search)
  })

  test('an old view=map URL loads the chart and raises no notice (ADR-0016)', () => {
    const search = parseAtlasSearch(parseSearchString('?outcome=HAPPY&view=map'))
    expect(search.outcome).toBe('HAPPY')
    expect('view' in search).toBe(false)
    expect(search.invalid).toBeUndefined()
    expect(stringifySearch(atlasSearchParams(search))).toBe('?outcome=HAPPY')
  })

  test('invalid values degrade to defaults and are reported, not thrown', () => {
    const search = parseAtlasSearch({ wave: 'Y9', sort: 'pie', countries: 'x,y' })
    expect(search.wave).toBe('Y1')
    expect(search.sort).toBe('estimate')
    expect(search.countries).toEqual([])
    expect(search.invalid).toEqual(['wave', 'sort', 'countries'])
    // Serialization keeps the rejected raw params (they are what was
    // typed), so any re-parse — including the router's own URL
    // normalization — recomputes the SAME full notice (F5)…
    const serialized = stringifySearch(atlasSearchParams(search))
    expect(serialized).toBe('?wave=Y9&sort=pie&countries=x%2Cy')
    expect(parseAtlasSearch(parseSearchString(serialized)).invalid).toEqual([
      'wave',
      'sort',
      'countries',
    ])
    // …dismissing strips them…
    expect(
      stringifySearch(atlasSearchParams({ ...search, invalid: undefined, invalidRaw: undefined })),
    ).toBe('')
    // …an explicit new value for one control drops only that leftover…
    expect(stringifySearch(atlasSearchParams({ ...search, wave: 'Y2' }))).toBe(
      '?wave=Y2&sort=pie&countries=x%2Cy',
    )
    // …and a forged ?invalid=wave cannot conjure a notice (the parser
    // recomputes it from the actual params).
    expect(parseAtlasSearch({ invalid: 'wave' }).invalid).toBeUndefined()
  })

  test('a rejected countries value survives the router rebuild (the re-parse sees the typed value)', () => {
    // The rebuild feeds the parser the validated state plus the carried
    // raw: the notice must be recomputed from the raw alone.
    const rebuilt = parseAtlasSearch({ countries: [], invalidRaw: { countries: 'x,y' } })
    expect(rebuilt.invalid).toEqual(['countries'])
    expect(
      parseCompareSearch({ countries: [], invalidRaw: { countries: '1,2,3,4,5,6' } }).invalid,
    ).toEqual(['countries'])
    // Repeated keys still combine.
    expect(parseAtlasSearch({ countries: ['1', '22'] }).countries).toEqual([1, 22])
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

describe('change search (Phase 5)', () => {
  test('defaults are 2023 → 2024 and stay out of the URL', () => {
    const search = parseChangeSearch({})
    expect(search).toEqual(CHANGE_DEFAULTS)
    expect(stringifySearch(changeSearchParams(search))).toBe('')
    expect(changeRequest(search)).toEqual({
      outcome: 'sfi',
      from: 'Y1',
      to: 'Y2',
      via: undefined,
      by: ['country_code'],
    })
  })

  test('a full URL round-trips with the API names', () => {
    const raw = parseSearchString('?outcome=BALANCE&via=MY&sort=name&dir=desc&countries=1,22')
    const search = parseChangeSearch(raw)
    expect(search.via).toBe('MY')
    expect(search.sort).toBe('name')
    expect(search.countries).toEqual([1, 22])
    const serialized = stringifySearch(changeSearchParams(search))
    expect(serialized).toBe('?outcome=BALANCE&via=MY&sort=name&dir=desc&countries=1%2C22')
    expect(parseChangeSearch(parseSearchString(serialized))).toEqual(search)
    expect(changeRequest(search).via).toBe('MY')
    // Other pairs the API serves.
    expect(stringifySearch(changeSearchParams(parseChangeSearch({ to: 'MY' })))).toBe('?to=MY')
    expect(stringifySearch(changeSearchParams(parseChangeSearch({ from: 'MY', to: 'Y2' })))).toBe(
      '?from=MY',
    )
  })

  test('bad, non-chronological or misplaced waves degrade with a notice', () => {
    expect(parseChangeSearch({ from: 'Y9' }).invalid).toEqual(['from'])
    const backwards = parseChangeSearch({ from: 'Y2', to: 'Y1' })
    expect([backwards.from, backwards.to]).toEqual(['Y1', 'Y2'])
    expect(backwards.invalid).toEqual(['from', 'to'])
    // A pair that collapses onto one wave is rejected too.
    const same = parseChangeSearch({ from: 'MY', to: 'MY' })
    expect([same.from, same.to]).toEqual(['MY', 'Y2'])
    expect(same.invalid).toEqual(['to'])
    // via only exists between 2023 and 2024.
    const misplaced = parseChangeSearch({ to: 'MY', via: 'MY' })
    expect(misplaced.via).toBeUndefined()
    expect(misplaced.invalid).toEqual(['via'])
    expect(parseChangeSearch({ via: 'Y2' }).invalid).toEqual(['via'])
    expect(parseChangeSearch({ sort: 'level' }).invalid).toEqual(['sort'])
  })
})

describe('compare search (Phase 5)', () => {
  test('two to five countries; more than five is rejected, not truncated', () => {
    expect(parseCompareSearch({ countries: '1,22' }).countries).toEqual([1, 22])
    const capped = parseCompareSearch({ countries: '1,2,3,4,5,6' })
    expect(capped.countries).toEqual([])
    expect(capped.invalid).toEqual(['countries'])
    expect(COMPARE_MAX_COUNTRIES).toBe(5)
    expect(COMPARE_MIN_COUNTRIES).toBe(2)
  })

  test('round-trips wave, split and the extra item; defaults omitted', () => {
    expect(stringifySearch(compareSearchParams(parseCompareSearch({})))).toBe('')
    const search = parseCompareSearch({
      countries: '1,22',
      wave: 'Y2',
      by: 'gender',
      outcome: 'HAPPY',
    })
    const serialized = stringifySearch(compareSearchParams(search))
    expect(serialized).toBe('?countries=1%2C22&wave=Y2&by=gender&outcome=HAPPY')
    expect(parseCompareSearch(parseSearchString(serialized))).toEqual(search)
    expect(parseCompareSearch({ by: 'country_code' }).invalid).toEqual(['by'])
    expect(compareRequest(search, 'sfi_health', happyVariable)).toEqual({
      outcome: 'sfi_health',
      wave: 'Y2',
      stat: 'mean',
      by: ['country_code', 'gender'],
    })
  })
})

describe('what-matters search (Phase 5)', () => {
  test('defaults: no country chosen, split by age band, countries A–Z', () => {
    const search = parseWhatMattersSearch({})
    expect(search).toEqual({
      by: 'age_band',
      sort: 'name',
      country: undefined,
      dir: undefined,
      item: undefined,
    })
    expect(stringifySearch(whatMattersSearchParams(search))).toBe('')
  })

  test('round-trips and degrades', () => {
    const search = parseWhatMattersSearch({
      country: '22',
      by: 'gender',
      item: 'NATURE',
      sort: 'estimate',
      dir: 'asc',
    })
    const serialized = stringifySearch(whatMattersSearchParams(search))
    expect(serialized).toBe('?country=22&by=gender&item=NATURE&sort=estimate&dir=asc')
    expect(parseWhatMattersSearch(parseSearchString(serialized))).toEqual(search)
    expect(parseWhatMattersSearch({ country: 'US' }).invalid).toEqual(['country'])
    expect(parseWhatMattersSearch({ country: '0' }).invalid).toEqual(['country'])
    expect(whatMattersRequest('MONEY', happyVariable, 'age_band')).toEqual({
      outcome: 'MONEY',
      wave: 'MY',
      stat: 'mean',
      by: ['country_code', 'age_band'],
    })
  })
})

describe('states search (Phase 5)', () => {
  test('defaults are the index on the map at Wave 1, nothing in the URL', () => {
    const search = parseStatesSearch({})
    expect(search.outcome).toBe('sfi')
    expect(search.wave).toBe('Y1')
    expect(search.view).toBe('map')
    expect(stringifySearch(statesSearchParams(search))).toBe('')
    expect(statesRequest(search, sfiVariable)).toEqual({
      outcome: 'sfi',
      wave: 'Y1',
      stat: 'mean',
      adj: undefined,
    })
  })

  test('adj round-trips on Wave 2 and is rejected on Wave 1 (no such weight)', () => {
    const y2 = parseStatesSearch({ wave: 'Y2', adj: 'true', view: 'bars' })
    expect(y2.adj).toBe(true)
    expect(stringifySearch(statesSearchParams(y2))).toBe('?wave=Y2&adj=true&view=bars')
    expect(statesRequest(y2, sfiVariable).adj).toBe(true)
    const y1 = parseStatesSearch({ adj: 'true' })
    expect(y1.adj).toBeUndefined()
    expect(y1.invalid).toEqual(['adj'])
    expect(parseStatesSearch({ view: 'globe' }).invalid).toEqual(['view'])
  })
})

describe('correlates search (Phase 6)', () => {
  test('defaults apply and are omitted from the URL', () => {
    const search = parseCorrelatesSearch({})
    expect(search).toEqual(CORRELATES_DEFAULTS)
    expect(stringifySearch(correlatesSearchParams(search))).toBe('')
  })

  test('a full URL round-trips exactly', () => {
    const raw = parseSearchString(
      '?outcome=HAPPY&wave=Y2&country=22&adjusted=true&method=spearman&topic=wellbeing',
    )
    const search = parseCorrelatesSearch(raw)
    expect(search).toMatchObject({
      outcome: 'HAPPY',
      wave: 'Y2',
      country: 22,
      adjusted: true,
      method: 'spearman',
      topic: 'wellbeing',
    })
    expect(search.invalid).toBeUndefined()
    expect(stringifySearch(correlatesSearchParams(search))).toBe(
      '?outcome=HAPPY&topic=wellbeing&wave=Y2&country=22&adjusted=true&method=spearman',
    )
  })

  test('invalid values degrade to defaults with a notice, and stay in the URL until dismissed', () => {
    const raw = parseSearchString(
      '?outcome=HAPPY&country=abc&adjusted=maybe&method=kendall&wave=Y9',
    )
    const search = parseCorrelatesSearch(raw)
    expect(search.outcome).toBe('HAPPY')
    expect(search.country).toBeUndefined()
    expect(search.adjusted).toBeUndefined()
    expect(search.method).toBeUndefined()
    expect(search.wave).toBe(CORRELATES_DEFAULTS.wave)
    expect(search.invalid).toEqual(['wave', 'country', 'adjusted', 'method'])
    // The rejected raws ride along, so a re-parse reports the same notice.
    const again = parseCorrelatesSearch(correlatesSearchParams(search))
    expect(again.invalid).toEqual(['wave', 'country', 'adjusted', 'method'])
    // Dismissed: they drop out.
    expect(
      stringifySearch(
        correlatesSearchParams({ ...search, invalid: undefined, invalidRaw: undefined }),
      ),
    ).toBe('?outcome=HAPPY')
    // country=0 and an unknown name are rejected too.
    expect(parseCorrelatesSearch({ country: '0' }).invalid).toEqual(['country'])
    expect(parseCorrelatesSearch({ outcome: '9lives' }).invalid).toEqual(['outcome'])
  })

  test('the requests carry the API vocabulary; adjusted drops the method', () => {
    const search = parseCorrelatesSearch({ outcome: 'HAPPY', method: 'spearman' })
    expect(correlatesRequest(search, 9)).toEqual({
      outcome: 'HAPPY',
      wave: 'Y1',
      by: [],
      countries: [9],
      adjusted: undefined,
      method: 'spearman',
    })
    expect(correlatesAcrossCountries(search, ['LONELY', 'BALANCE'])).toEqual({
      outcome: 'HAPPY',
      wave: 'Y1',
      against: ['LONELY', 'BALANCE'],
      by: ['country_code'],
      adjusted: undefined,
      method: 'spearman',
    })
    const adjusted = parseCorrelatesSearch({
      outcome: 'HAPPY',
      method: 'spearman',
      adjusted: 'true',
    })
    expect(correlatesRequest(adjusted, 9).method).toBeUndefined()
    expect(correlatesRequest(adjusted, 9).adjusted).toBe(true)
  })
})
