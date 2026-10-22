// Segments' panel order (ADR-0031): each country by its own estimate,
// never an average of its groups; the gap only over groups that aren't
// thin.

import { describe, expect, test } from 'vitest'
import { countryEstimates, facetOrder } from '../charts/SmallMultiples'
import { testMeta, testRow } from '../test-utils/fixtures'

// Testland (1) has one person who scored 9.6 in a group of their own; the
// United States (22) has the higher estimate overall.
const groups = [
  testRow({ group: { country_code: 1, gender: 1 }, estimate: 7.2 }),
  testRow({ group: { country_code: 1, gender: 2 }, estimate: 7.3 }),
  testRow({ group: { country_code: 1, gender: 4 }, estimate: 9.6, n: 1, flagged: true }),
  testRow({ group: { country_code: 22, gender: 1 }, estimate: 7.5 }),
  testRow({ group: { country_code: 22, gender: 2 }, estimate: 7.4 }),
]
const overall = countryEstimates(
  [
    testRow({ group: { country_code: 1 }, estimate: 7.25 }),
    testRow({ group: { country_code: 22 }, estimate: 7.45 }),
  ],
  testMeta,
)

describe('facetOrder', () => {
  test("by value, each country goes by its own estimate — a one-person group can't move it", () => {
    // The groups' plain average would put Testland first (8.03 > 7.45).
    expect(facetOrder(groups, testMeta, 'country_code', 'estimate')).toEqual([
      'Testland',
      'United States',
    ])
    expect(facetOrder(groups, testMeta, 'country_code', 'estimate', 'desc', overall)).toEqual([
      'United States',
      'Testland',
    ])
    expect(facetOrder(groups, testMeta, 'country_code', 'estimate', 'asc', overall)).toEqual([
      'Testland',
      'United States',
    ])
  })

  test('the gap leaves thin groups out; a country with fewer than two goes last', () => {
    // Testland's gap over its two solid groups is 0.1 (not 2.4 with the
    // one person); the United States' is 0.1 too — a tie, in name order.
    const order = facetOrder(groups, testMeta, 'country_code', 'gap')
    expect(order).toEqual(['Testland', 'United States'])
    const lonely = [
      ...groups.filter((row) => row.group['country_code'] === 22),
      testRow({ group: { country_code: 1, gender: 1 }, estimate: 7.2 }),
      testRow({ group: { country_code: 1, gender: 4 }, estimate: 9.6, n: 1, flagged: true }),
    ]
    expect(facetOrder(lonely, testMeta, 'country_code', 'gap')).toEqual([
      'United States',
      'Testland',
    ])
    expect(facetOrder(lonely, testMeta, 'country_code', 'gap', 'asc')).toEqual([
      'United States',
      'Testland',
    ])
  })

  test('a country with no estimate of its own goes last, either way', () => {
    const partial = countryEstimates(
      [testRow({ group: { country_code: 1 }, estimate: 7 })],
      testMeta,
    )
    expect(facetOrder(groups, testMeta, 'country_code', 'estimate', 'asc', partial)).toEqual([
      'Testland',
      'United States',
    ])
  })

  test('a share orders by the country at the same answer', () => {
    const shares = [
      testRow({ group: { country_code: 1 }, stat: 'proportion', level: 1, estimate: 0.2 }),
      testRow({ group: { country_code: 1 }, stat: 'proportion', level: 2, estimate: 0.8 }),
    ]
    expect(countryEstimates(shares, testMeta, 2).get('Testland')).toBeCloseTo(80)
  })
})
