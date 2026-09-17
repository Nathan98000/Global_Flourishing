// Number formatting: one place, one locale (the site is English), so
// every view renders 7.21 [7.10, 7.32] · n = 1,204 the same way.

import type { EstimateRow } from './api/types'

const count = new Intl.NumberFormat('en-US')
const two = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const one = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export function formatCount(value: number): string {
  return count.format(value)
}

/** Percentages for share stats, two decimals for scores/means. */
export function isShareStat(stat: string): boolean {
  return stat === 'proportion' || stat === 'distribution'
}

export function formatEstimate(value: number | null | undefined, stat: string): string {
  if (value === null || value === undefined) return '—'
  if (isShareStat(stat)) return `${one.format(value * 100)}%`
  return two.format(value)
}

/** A missing interval renders as an em dash — a lone PSU in a stratum
 * yields no computable SE (ADR-0011), and that is data to show, never a
 * zero-width mark. */
export function formatCI(row: Pick<EstimateRow, 'ci_lo' | 'ci_hi' | 'stat'>): string {
  if (row.ci_lo === null || row.ci_hi === null) return '—'
  return `[${formatEstimate(row.ci_lo, row.stat)}, ${formatEstimate(row.ci_hi, row.stat)}]`
}

/** "95% CI" from meta.ci_level (never hard-coded 95). */
export function ciLabel(ciLevel: number): string {
  return `${one.format(ciLevel * 100).replace(/\.0$/, '')}% CI`
}

export function formatPercent(fraction: number, decimals = 0): string {
  return fraction.toLocaleString('en-US', {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}
