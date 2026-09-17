// Chart theme: every color is a `var(--token)` string straight into the
// SVG, so charts re-theme live with tokens.css and no hex ever exists in
// chart code. The map's sequential scale is *quantized* onto the seven
// discrete ramp tokens for the same reason (no interpolation, no
// resolved colors). Mark metrics follow the dataviz specs: thin bars
// (≤ 24px), hairline solid grid, 2px surface gaps and rings.

import type { EstimateRow, ResponseMeta, VariableSummary } from '../api/types'
import { ciLabel, formatCount, formatEstimate } from '../format'

export const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

export const INK = 'var(--ink)'
export const INK_SECONDARY = 'var(--ink-secondary)'
export const INK_MUTED = 'var(--ink-muted)'
export const GRID = 'var(--grid)'
export const AXIS = 'var(--axis)'
export const SURFACE = 'var(--surface)'
export const WHISKER = 'var(--whisker)'
export const SUPPRESSED_HATCH_FILL = 'url(#suppressed-hatch)'
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

/** Tooltip text: value leads, context follows; suppression stays honest. */
export function tipText(row: EstimateRow, label: string, threshold: number): string {
  if (row.suppressed) {
    return `${label}\nwithheld (n = ${formatCount(row.n)}, below ${threshold})`
  }
  const lines = [`${formatEstimate(row.estimate, row.stat)}  ${label}`]
  if (hasCI(row)) {
    lines.push(
      `${ciLabel(row.ci_level)} ${formatEstimate(row.ci_lo, row.stat)} to ${formatEstimate(row.ci_hi, row.stat)}`,
    )
  }
  lines.push(`n = ${formatCount(row.n)} · ${row.weight}${row.flagged ? ' · small cell' : ''}`)
  return lines.join('\n')
}

/** Percent-scaled value for share stats (Plot draws 0–100, not 0–1). */
export function plotValue(row: EstimateRow): number | null {
  if (row.estimate === null) return null
  return row.stat === 'proportion' || row.stat === 'distribution'
    ? row.estimate * 100
    : row.estimate
}

export function plotCI(row: EstimateRow): [number, number] | null {
  if (!hasCI(row)) return null
  const scale = row.stat === 'proportion' || row.stat === 'distribution' ? 100 : 1
  return [(row.ci_lo as number) * scale, (row.ci_hi as number) * scale]
}
