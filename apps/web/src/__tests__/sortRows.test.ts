// One ordering, two consumers (items 5/13): these functions decide the
// order the chart AND the data table render in, and the direction rides
// the URL with a sort-appropriate default.

import { describe, expect, test } from 'vitest'
import { facetOrder } from '../charts/SmallMultiples'
import { groupValueLabel } from '../labels'
import { defaultDir, sortAtlasRows, sortBreakdownRows } from '../sortRows'
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

describe('defaultDir', () => {
  test('values read high-first, names read A→Z', () => {
    expect(defaultDir('estimate')).toBe('desc')
    expect(defaultDir('gap')).toBe('desc')
    expect(defaultDir('name')).toBe('asc')
  })
})

describe('sortAtlasRows', () => {
  test('by value in both directions, valueless rows always last', () => {
    expect(names(sortAtlasRows(rows, metaWithHK, 'estimate', 'desc'))).toEqual([
      'United States',
      'Testland',
      'Hong Kong',
    ])
    expect(names(sortAtlasRows(rows, metaWithHK, 'estimate', 'asc'))).toEqual([
      'Testland',
      'United States',
      'Hong Kong',
    ])
  })

  test('A–Z in both directions', () => {
    expect(names(sortAtlasRows(rows, metaWithHK, 'name', 'asc'))).toEqual([
      'Hong Kong',
      'Testland',
      'United States',
    ])
    expect(names(sortAtlasRows(rows, metaWithHK, 'name', 'desc'))).toEqual([
      'United States',
      'Testland',
      'Hong Kong',
    ])
  })

  test('does not mutate its input', () => {
    const input = [...rows]
    sortAtlasRows(input, metaWithHK, 'estimate', 'asc')
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
