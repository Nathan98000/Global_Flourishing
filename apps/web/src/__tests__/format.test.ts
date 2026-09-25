import { describe, expect, test } from 'vitest'
import { ciLabel, ciText, formatCI, formatCount, formatEstimate } from '../format'
import { columnLabel, groupValueLabel } from '../labels'
import { testMeta, testRow } from '../test-utils/fixtures'

describe('formatting', () => {
  test('means keep two decimals; shares render as percentages', () => {
    expect(formatEstimate(7.2143, 'mean')).toBe('7.21')
    expect(formatEstimate(0.4567, 'proportion')).toBe('45.7%')
    expect(formatEstimate(0.05, 'distribution')).toBe('5.0%')
    expect(formatEstimate(null, 'mean')).toBe('—')
    // A share's interval can dip below zero on a near-empty bin: shown
    // as 0.0%, never "−0.0%".
    expect(formatEstimate(-0.0003, 'distribution')).toBe('0.0%')
    expect(formatEstimate(-0.02, 'proportion')).toBe('0.0%')
    expect(formatCI(testRow({ stat: 'distribution', ci_lo: -0.001, ci_hi: 0.004 }))).toBe(
      '[0.0%, 0.4%]',
    )
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

  test('tooltips carry the interval in the table’s brackets: 95% CI [X, Y]', () => {
    expect(ciText(testRow({ ci_lo: 7.59, ci_hi: 7.68 }))).toBe('95% CI [7.59, 7.68]')
    expect(ciText(testRow({ stat: 'proportion', ci_lo: 0.41, ci_hi: 0.5, ci_level: 0.9 }))).toBe(
      '90% CI [41.0%, 50.0%]',
    )
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
