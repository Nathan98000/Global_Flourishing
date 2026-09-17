import { describe, expect, test } from 'vitest'
import { summarizeCoverage } from '../coverage'
import { ciLabel, formatCI, formatCount, formatEstimate } from '../format'
import { columnLabel, groupValueLabel } from '../labels'
import { testMeta, testRow } from '../test-utils/fixtures'
import type { MissingnessRow } from '../api/types'

describe('formatting', () => {
  test('means keep two decimals; shares render as percentages', () => {
    expect(formatEstimate(7.2143, 'mean')).toBe('7.21')
    expect(formatEstimate(0.4567, 'proportion')).toBe('45.7%')
    expect(formatEstimate(0.05, 'distribution')).toBe('5.0%')
    expect(formatEstimate(null, 'mean')).toBe('—')
  })

  test('CI strings match the estimate scale', () => {
    expect(formatCI(testRow())).toBe('[7.10, 7.32]')
    expect(formatCI(testRow({ stat: 'proportion', ci_lo: 0.41, ci_hi: 0.5 }))).toBe(
      '[41.0%, 50.0%]',
    )
    // A missing interval is data to show (ADR-0011), never an empty cell.
    expect(formatCI(testRow({ ci_lo: null }))).toBe('—')
  })

  test('counts get separators; the CI label follows meta', () => {
    expect(formatCount(207919)).toBe('207,919')
    expect(ciLabel(0.95)).toBe('95% CI')
    expect(ciLabel(0.9)).toBe('90% CI')
  })
})

describe('labels come from meta, never a TS copy', () => {
  test('columns and values resolve through meta', () => {
    expect(columnLabel('country_code', testMeta)).toBe('Country')
    expect(columnLabel('gender', testMeta)).toBe('Gender')
    expect(columnLabel('unknown_col', testMeta)).toBe('unknown_col')
    expect(groupValueLabel('country_code', 22, testMeta)).toBe('United States')
    expect(groupValueLabel('gender', 2, testMeta)).toBe('Female')
    expect(groupValueLabel('age_band', '18-24', testMeta)).toBe('18–24')
    expect(groupValueLabel('gender', null, testMeta)).toBe('—')
    expect(groupValueLabel('gender', 9, testMeta)).toBe('9')
  })
})

describe('coverage', () => {
  const rows: MissingnessRow[] = [
    {
      wave: 'Y1',
      country_code: 1,
      n_present: 100,
      n_valid: 95,
      n_skipped: 5,
      n_dk: 0,
      n_refused: 0,
    },
    {
      wave: 'Y1',
      country_code: 22,
      n_present: 200,
      n_valid: 190,
      n_skipped: 10,
      n_dk: 0,
      n_refused: 0,
    },
    {
      wave: 'Y2',
      country_code: 1,
      n_present: 23,
      n_valid: 22,
      n_skipped: 1,
      n_dk: 0,
      n_refused: 0,
    },
    {
      wave: 'Y2',
      country_code: 22,
      n_present: 180,
      n_valid: 175,
      n_skipped: 5,
      n_dk: 0,
      n_refused: 0,
    },
  ]

  test('per-country retention with honest extremes', () => {
    const summary = summarizeCoverage(rows, 'Y2')
    expect(summary.countries).toHaveLength(2)
    expect(summary.lowest?.country_code).toBe(1)
    expect(summary.lowest?.fraction).toBeCloseTo(0.23)
    expect(summary.highest?.country_code).toBe(22)
    expect(summary.highest?.fraction).toBeCloseTo(0.9)
  })

  test('a wave with no rows yields no banner data', () => {
    const summary = summarizeCoverage(rows.slice(0, 2), 'MY')
    expect(summary.lowest).toBeNull()
  })
})
