// Chart theme: every color is a `var(--token)` string straight into the
// SVG, so charts re-theme live with tokens.css and no hex ever exists in
// chart code. The map's sequential scale is *quantized* onto the seven
// discrete ramp tokens for the same reason (no interpolation, no
// resolved colors). Mark metrics follow the dataviz specs: thin bars
// (≤ 24px), hairline solid grid, 2px surface gaps and rings.

import type { EstimateRow, ResponseMeta, VariableSummary } from '../api/types'
import { ciLabel, formatCount, formatEstimate, isShareChangeStat, isShareStat } from '../format'

export const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

export const INK = 'var(--ink)'
export const INK_SECONDARY = 'var(--ink-secondary)'
export const INK_MUTED = 'var(--ink-muted)'
export const GRID = 'var(--grid)'
export const AXIS = 'var(--axis)'
export const SURFACE = 'var(--surface)'
export const WHISKER = 'var(--whisker)'
export const MAP_EMPTY = 'var(--map-empty)'

/** The six fixed SFI domain hues (proposal §4.4 — same hue, every view). */
export const SFI_HUES: Record<string, string> = {
  sfi_happiness: 'var(--sfi-happiness)',
  sfi_health: 'var(--sfi-health)',
  sfi_meaning: 'var(--sfi-meaning)',
  sfi_character: 'var(--sfi-character)',
  sfi_relationships: 'var(--sfi-relationships)',
  sfi_financial: 'var(--sfi-financial)',
}

/** The six domain outcomes in index order — the ids `flourish_stats.outcomes`
 * serves; their display names come from the catalog, never from here. */
export const SFI_DOMAINS: readonly string[] = Object.keys(SFI_HUES)

export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'] as const

export const SEQUENTIAL_RAMP = [
  'var(--seq-100)',
  'var(--seq-200)',
  'var(--seq-300)',
  'var(--seq-400)',
  'var(--seq-500)',
  'var(--seq-600)',
  'var(--seq-700)',
] as const

/** The diverging ramp (Phase 6): rust for negative associations, the
 * page tone at zero, teal for positive — five tints per sign with a
 * stronger end step, every one designed for ink text on top (the
 * correlates matrix), quantized like the map ramp. */
export const DIVERGING_RAMP = [
  'var(--div-n5)',
  'var(--div-n4)',
  'var(--div-n3)',
  'var(--div-n2)',
  'var(--div-n1)',
  'var(--div-0)',
  'var(--div-p1)',
  'var(--div-p2)',
  'var(--div-p3)',
  'var(--div-p4)',
  'var(--div-p5)',
] as const

/** Tint steps per sign of the diverging ramp. */
export const DIVERGING_STEPS = 5

/** Mark-grade hues for a negative / positive association (dots, bars). */
export const NEGATIVE_MARK = 'var(--div-neg-mark)'
export const POSITIVE_MARK = 'var(--div-pos-mark)'

/** The diverging tint for a value in [−extent, extent], quantized onto
 * the eleven ramp tokens (no interpolation, no resolved colors — the
 * theme switch recolors live); null → transparent. */
export function divergingTint(value: number | null | undefined, extent = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value) || extent <= 0)
    return 'transparent'
  const unit = Math.max(-1, Math.min(1, value / extent))
  const step = Math.round(unit * DIVERGING_STEPS) + DIVERGING_STEPS
  return DIVERGING_RAMP[step] ?? 'transparent'
}

/** The hue a signed mark wears. */
export function signMark(value: number | null | undefined): string {
  return value !== null && value !== undefined && value < 0 ? NEGATIVE_MARK : POSITIVE_MARK
}

/** The one hue an outcome's marks wear, everywhere. */
export function outcomeColor(outcome: string): string {
  return SFI_HUES[outcome] ?? SERIES[0]
}

export const BAR_THICKNESS = 20
export const BAR_RADIUS = 4
export const ROW_HEIGHT = 26

/** Marches with docs/METHODS.md: quantiles ship without CIs for now. */
export function hasCI(row: Pick<EstimateRow, 'ci_lo' | 'ci_hi'>): boolean {
  return row.ci_lo !== null && row.ci_hi !== null
}

/** Axis annotation for scale direction — never silently flipped. */
export function directionNote(direction: string, oriented: boolean): string {
  if (direction === 'higher_better') return 'higher is better'
  if (direction === 'lower_better')
    return oriented ? 'reversed so higher is better' : 'lower is better'
  return ''
}

export function axisLabel(
  variable: Pick<VariableSummary, 'min' | 'max' | 'direction'>,
  responseMeta: Pick<ResponseMeta, 'stat' | 'oriented'>,
  levelLabel?: string,
): string {
  const note = directionNote(variable.direction, responseMeta.oriented)
  if (responseMeta.stat === 'proportion' || responseMeta.stat === 'distribution') {
    const of = levelLabel ? ` of “${levelLabel}”` : ''
    return `Weighted share${of} (%)`
  }
  const range =
    variable.min !== null && variable.max !== null ? ` (${variable.min}–${variable.max})` : ''
  const stat = responseMeta.stat === 'quantile' ? 'Median' : 'Weighted mean'
  return `${stat}${range}${note ? ` · ${note}` : ''}`
}

/** Tooltip text: value leads, context follows. A missing interval says
 * why: none is computed for the statistic (a plain correlation), or no
 * SE was computable (a single sampling unit — read the n). */
export function tipText(row: EstimateRow, label: string): string {
  const lines = [`${formatEstimate(row.estimate, row.stat)}  ${label}`]
  if (hasCI(row)) {
    lines.push(
      `${ciLabel(row.ci_level)} ${formatEstimate(row.ci_lo, row.stat)} to ${formatEstimate(row.ci_hi, row.stat)}`,
    )
  } else if (row.ci_method === 'none') {
    lines.push('point estimate — no interval is computed for this statistic')
  } else {
    lines.push('no interval (single sampling unit)')
  }
  lines.push(`n = ${formatCount(row.n)} · ${row.weight}`)
  return lines.join('\n')
}

/** Percent-scaled value for share stats (Plot draws 0–100, not 0–1) and
 * for a share change (percentage points). */
export function plotValue(row: EstimateRow): number | null {
  if (row.estimate === null) return null
  return isShareStat(row.stat) || isShareChangeStat(row.stat) ? row.estimate * 100 : row.estimate
}

export function plotCI(row: EstimateRow): [number, number] | null {
  if (!hasCI(row)) return null
  const scale = isShareStat(row.stat) || isShareChangeStat(row.stat) ? 100 : 1
  return [(row.ci_lo as number) * scale, (row.ci_hi as number) * scale]
}
