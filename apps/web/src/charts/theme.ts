// Chart theme: every color is a `var(--token)` string straight into the
// SVG, so charts re-theme live with tokens.css and no hex ever exists in
// chart code. The map's sequential scale is *quantized* onto the seven
// discrete ramp tokens for the same reason (no interpolation, no
// resolved colors). Mark metrics follow the dataviz specs: thin bars
// (≤ 24px), hairline solid grid, 2px surface gaps and rings.

import * as Plot from '@observablehq/plot'
import type { EstimateRow, ResponseMeta, VariableSummary } from '../api/types'
import { ciText, formatEstimate, isShareChangeStat, isShareStat } from '../format'

export const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

/** Every tooltip: the plot font at the 12px token, the hairline rule as
 * its stroke; its fill is Plot's --plot-background, which tokens.css
 * sets to the surface in both themes (the text is the plot's current
 * colour, secondary ink, AA on that fill). */
export const TIP_OPTIONS = {
  fontFamily: FONT_FAMILY,
  fontSize: 12,
  stroke: 'var(--grid)',
} as const

export const INK = 'var(--ink)'
export const INK_SECONDARY = 'var(--ink-secondary)'
export const INK_MUTED = 'var(--ink-muted)'
export const GRID = 'var(--grid)'
export const AXIS = 'var(--axis)'
export const SURFACE = 'var(--surface)'
export const WHISKER = 'var(--whisker)'
/** The neutral for "no estimate" and unsurveyed land, and the outline
 * that keeps it apart from the ramp's lowest bin in both themes. */
export const MAP_EMPTY = 'var(--map-empty)'
export const MAP_EMPTY_OUTLINE = 'var(--map-empty-outline)'

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

/** A value in [lo, hi] onto the seven sequential ramp tokens (the map's
 * quantized scale; the What Matters matrix uses the same). */
export function quantizeSequential(domain: [number, number]): (value: number) => string {
  const [lo, hi] = domain
  const steps = SEQUENTIAL_RAMP.length
  return (value: number) => {
    if (hi <= lo) return SEQUENTIAL_RAMP[0]
    const t = Math.min(1, Math.max(0, (value - lo) / (hi - lo)))
    const index = Math.min(steps - 1, Math.floor(t * steps))
    return SEQUENTIAL_RAMP[index] as string
  }
}

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

/** A whisker's end cap: a vertical tick through the row's centre, drawn
 * by Plot's dot mark as a custom symbol (Plot sizes a symbol πr², so r
 * is the tick's half length). */
const WHISKER_CAP = {
  draw(
    context: { moveTo(x: number, y: number): void; lineTo(x: number, y: number): void },
    size: number,
  ) {
    const half = Math.sqrt(size / Math.PI)
    context.moveTo(0, -half)
    context.lineTo(0, half)
  },
}

/** A CI whisker drawn over a bar: one rule in the page ink, 1.25px,
 * with short end caps (6px) — it reads on the bar's own hue in either
 * theme, and the caps mark where the interval ends. No halo: a
 * surface-coloured one read as a white scratch through the bar (and a
 * whisker in the bar's tone vanished). `y` names the row; `x1` and `x2`
 * are the interval's ends. */
export function whiskerOverBars<Datum>(
  data: Datum[],
  channels: {
    y: string
    x1: (datum: Datum) => number | undefined
    x2: (datum: Datum) => number | undefined
  },
) {
  const ink = { stroke: INK, strokeWidth: 1.25, clip: true } as const
  const cap = { y: channels.y, symbol: WHISKER_CAP, r: 3, fill: 'none', ...ink }
  return [
    Plot.ruleY(data, { ...channels, ...ink }),
    Plot.dot(data, { ...cap, x: channels.x1 }),
    Plot.dot(data, { ...cap, x: channels.x2 }),
  ]
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
/** Row charts are never laid out shorter than this many rows: with one
 * to three rows the top ticks would touch the first row and a zero rule
 * would be a stub. */
export const MIN_ROWS = 4
/** Facet padding: enough that adjacent panels' tick labels never touch. */
export const FACET_PADDING = 0.16
/** Column (facet) labels sit one text line above the top axis's tick
 * labels: Plot puts both on the top edge otherwise (tick size + padding
 * = 9 px up), and "Indonesia" over "8" read as "Indo8esia". */
export const FACET_LABEL_DY = -25
/** Room under the last row of a panel for its in-panel tick labels. */
export const PANEL_AXIS_INSET = 18

/** Marches with docs/METHODS.md: quantiles ship without CIs for now. */
export function hasCI(row: Pick<EstimateRow, 'ci_lo' | 'ci_hi'>): boolean {
  return row.ci_lo !== null && row.ci_hi !== null
}

/** The axis names the statistic and the range; the subtitle names the
 * scale's endpoints (labels.ts scaleSubtitle) — never "higher is
 * better" (ADR-0016). */
export function axisLabel(
  variable: Pick<VariableSummary, 'min' | 'max'>,
  responseMeta: Pick<ResponseMeta, 'stat'>,
  levelLabel?: string,
): string {
  if (responseMeta.stat === 'proportion' || responseMeta.stat === 'distribution') {
    const of = levelLabel ? ` of “${levelLabel}”` : ''
    return `Weighted share${of} (%)`
  }
  const range =
    variable.min !== null && variable.max !== null ? ` (${variable.min}–${variable.max})` : ''
  const stat = responseMeta.stat === 'quantile' ? 'Median' : 'Weighted mean'
  return `${stat}${range}`
}

/** Tooltip text: value leads, the interval follows — never the n, which
 * lives in the data table (ADR-0016). A missing interval says why: none
 * is computed for the statistic (a plain correlation), or no SE was
 * computable (a single sampling unit). */
export function tipText(row: EstimateRow, label: string): string {
  const lines = [`${formatEstimate(row.estimate, row.stat)}  ${label}`]
  if (hasCI(row)) {
    lines.push(ciText(row))
  } else if (row.ci_method === 'none') {
    lines.push('point estimate — no interval is computed for this statistic')
  } else {
    lines.push('no interval (single sampling unit)')
  }
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
