// Number formatting: one place, one locale (the site is English), so
// every view renders 7.21 [7.10, 7.32] and 1,204 people the same way.

import type { EstimateRow } from './api/types'

const count = new Intl.NumberFormat('en-US')
const two = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const one = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** A small count in words — "seven things" — and in figures past
 * twelve. */
export function countWord(value: number): string {
  const words = [
    'zero',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
  ]
  return Number.isInteger(value) ? (words[value] ?? formatCount(value)) : formatCount(value)
}

export function formatCount(value: number): string {
  return count.format(value)
}

/** Percentages for share stats (the change histogram and transition
 * cells are shares too), two decimals for scores/means. */
export function isShareStat(stat: string): boolean {
  return (
    stat === 'proportion' ||
    stat === 'distribution' ||
    stat === 'change_distribution' ||
    stat === 'transition'
  )
}

/** Whether a signed value shows as 0.00 at two places — neither sign's
 * (it carries no sign, and wears neutral ink, never rust or teal). */
export function roundsToZero(value: number): boolean {
  return two.format(Math.abs(value)) === '0.00'
}

/** A within-person change carries its sign: +0.12, −0.30, 0.00. */
export function formatChange(value: number): string {
  const rendered = two.format(Math.abs(value))
  if (roundsToZero(value)) return rendered
  return value > 0 ? `+${rendered}` : `−${rendered}`
}

/** A categorical item's change is the change in the share answering a
 * level (the engine's `change_share`, a fraction): shown in percentage
 * points, signed — "+3.2 percentage points", never "pp". */
export function isShareChangeStat(stat: string): boolean {
  return stat === 'change_share'
}

/** The signed number of points alone — +3.2, −1.0, 0.0 — for an
 * interval's ends and a chart's value column, whose line or label
 * already names the unit. */
function signedPoints(fraction: number): string {
  const rendered = one.format(Math.abs(fraction * 100))
  return rendered === '0.0' ? rendered : fraction > 0 ? `+${rendered}` : `−${rendered}`
}

export function formatShareChange(fraction: number): string {
  return `${signedPoints(fraction)} percentage points`
}

/** Correlations and model coefficients are signed quantities around
 * zero, so they carry their sign the way a change does. */
export function isAssociationStat(stat: string): boolean {
  return stat === 'pearson_r' || stat === 'spearman_r' || stat === 'beta'
}

export function formatEstimate(value: number | null | undefined, stat: string): string {
  if (value === null || value === undefined) return '—'
  // A share is never below zero; an interval bound that dips under it
  // (a normal CI on a near-empty bin) shows as 0.0%, never "−0.0%".
  if (isShareStat(stat)) return `${one.format(Math.max(0, value) * 100)}%`
  if (isShareChangeStat(stat)) return formatShareChange(value)
  if (stat === 'change' || isAssociationStat(stat)) return formatChange(value)
  return two.format(value)
}

/** A missing interval renders as an em dash — a lone PSU in a stratum
 * yields no computable SE (ADR-0011), and that is data to show, never a
 * zero-width mark. */
export function formatCI(row: Pick<EstimateRow, 'ci_lo' | 'ci_hi' | 'stat'>): string {
  if (row.ci_lo === null || row.ci_hi === null) return '—'
  // A share change's ends are bare points: its value line names the unit.
  if (isShareChangeStat(row.stat)) return `[${signedPoints(row.ci_lo)}, ${signedPoints(row.ci_hi)}]`
  // A true minus, as every other signed number prints (H17): "[−0.53, 9.02]".
  const bound = (value: number) => formatEstimate(value, row.stat).replace(/^-/, '−')
  return `[${bound(row.ci_lo)}, ${bound(row.ci_hi)}]`
}

/** A chart's value column: the estimate as formatEstimate gives it, a
 * share change as bare points (the column's label and the subtitle say
 * "percentage points"; the hover card says it again). */
export function formatValueLabel(value: number | null | undefined, stat: string): string {
  if (value !== null && value !== undefined && isShareChangeStat(stat)) return signedPoints(value)
  return formatEstimate(value, stat)
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
