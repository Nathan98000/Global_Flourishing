// One ordering, two consumers (items 5/13): these functions decide the
// order the chart AND the CSV render in — by value only, never by name
// (ADR-0029), the direction riding the URL, highest first by default.

import { describe, expect, test } from 'vitest'
import { facetOrder } from '../charts/SmallMultiples'
import { groupValueLabel } from '../labels'
import { DEFAULT_DIR, reversed, sortAtlasRows, sortBreakdownRows } from '../sortRows'
import { testMeta, testRow } from '../test-utils/fixtures'

const rows = [
  testRow({ group: { country_code: 1 }, estimate: 6.9 }), // Testland
  testRow({ group: { country_code: 22 }, estimate: 7.4 }), // United States
  testRow({ group: { country_code: 24 }, estimate: null, ci_lo: null, ci_hi: null }),
]

const metaWithHK = {
  ...testMeta,
  countries: [...testMeta.countries, { code: 24, name: 'Hong Kong', iso3: 'HKG' }],
}

const names = (sorted: ReturnType<typeof sortAtlasRows>) =>
  sorted.map((row) =>
    groupValueLabel('country_code', row.group['country_code'] ?? null, metaWithHK),
  )

describe('direction', () => {
  test('highest first by default; a second click reverses it', () => {
    expect(DEFAULT_DIR).toBe('desc')
    expect(reversed('desc')).toBe('asc')
    expect(reversed('asc')).toBe('desc')
  })
})

describe('sortAtlasRows', () => {
  test('by value in both directions, valueless rows always last', () => {
    expect(names(sortAtlasRows(rows, metaWithHK, 'desc'))).toEqual([
      'United States',
      'Testland',
      'Hong Kong',
    ])
    expect(names(sortAtlasRows(rows, metaWithHK, 'asc'))).toEqual([
      'Testland',
      'United States',
      'Hong Kong',
    ])
  })

  test('a tie in value falls back to name order, in either direction', () => {
    const tied = [
      testRow({ group: { country_code: 22 }, estimate: 7 }),
      testRow({ group: { country_code: 1 }, estimate: 7 }),
      testRow({ group: { country_code: 24 }, estimate: 6 }),
    ]
    expect(names(sortAtlasRows(tied, metaWithHK, 'desc'))).toEqual([
      'Testland',
      'United States',
      'Hong Kong',
    ])
    expect(names(sortAtlasRows(tied, metaWithHK, 'asc'))).toEqual([
      'Hong Kong',
      'Testland',
      'United States',
    ])
  })

  test('does not mutate its input', () => {
    const input = [...rows]
    sortAtlasRows(input, metaWithHK, 'asc')
    expect(input).toEqual(rows)
  })
})

describe('sortBreakdownRows', () => {
  const cells = [1, 22].flatMap((code) =>
    [2, 1].map((gender) =>
      testRow({
        group: { country_code: code, gender },
        estimate: code === 22 ? 7 + gender * 0.2 : 6 + gender * 0.1,
      }),
    ),
  )
  const levelDomain = ['Male', 'Female']
  const levelLabelOf = (row: (typeof cells)[number]) =>
    groupValueLabel('gender', row.group['gender'] ?? null, testMeta)

  test('countries follow the panel order, levels the served order', () => {
    const sorted = sortBreakdownRows(
      cells,
      testMeta,
      (input) => facetOrder(input, testMeta, 'country_code', 'estimate', 'desc'),
      levelLabelOf,
      levelDomain,
    )
    expect(
      sorted.map((row) => [
        groupValueLabel('country_code', row.group['country_code'] ?? null, testMeta),
        levelLabelOf(row),
      ]),
    ).toEqual([
      ['United States', 'Male'],
      ['United States', 'Female'],
      ['Testland', 'Male'],
      ['Testland', 'Female'],
    ])
  })

  test('direction reverses the country order, not the level order', () => {
    const sorted = sortBreakdownRows(
      cells,
      testMeta,
      (input) => facetOrder(input, testMeta, 'country_code', 'estimate', 'asc'),
      levelLabelOf,
      levelDomain,
    )
    expect(
      sorted.map((row) =>
        groupValueLabel('country_code', row.group['country_code'] ?? null, testMeta),
      ),
    ).toEqual(['Testland', 'Testland', 'United States', 'United States'])
    expect(sorted.slice(0, 2).map(levelLabelOf)).toEqual(['Male', 'Female'])
  })
})
