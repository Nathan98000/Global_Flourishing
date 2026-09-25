// Data-fitted scale windows (design review 2026-09-16, F1). Position and
// color encodings do not need a zero baseline, so dot, ramp and bin
// scales fit the observed values — but a fitted window that does not say
// where it starts would mislead, so the window's edges are always
// themselves ticks: pad the observed extent, then round outward to a
// nice step and emit every tick explicitly. Bars keep their zero
// baseline and never come through here (ADR-0010, revised).

export interface FittedScale {
  domain: [number, number]
  /** Every tick from domain[0] to domain[1], endpoints included. */
  ticks: number[]
  /** Just enough decimals for the step (charts add their own % suffix). */
  format: (value: number) => string
}

/** Largest of 1/2/2.5/5 × 10^k at or above `raw`. */
function niceStep(raw: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const normalized = raw / magnitude
  const factor =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10
  return factor * magnitude
}

function decimalsOf(step: number): number {
  const text = step.toString()
  const dot = text.indexOf('.')
  return dot === -1 ? 0 : text.length - dot - 1
}

export function fittedScale(
  values: readonly number[],
  {
    targetTicks = 6,
    zeroBaseline = false,
    bounds,
  }: {
    targetTicks?: number
    zeroBaseline?: boolean
    /** The measure's own limits (a 0–10 scale, 0–100 for shares, −1…1
     * for a correlation): the niced window is clamped to them, so an
     * axis never runs past what the measure can be (no 2–12 or 0–15). */
    bounds?: readonly [number, number]
  } = {},
): FittedScale {
  const finite = values.filter((value) => Number.isFinite(value))
  if (finite.length === 0) {
    return { domain: [0, 1], ticks: [0, 0.5, 1], format: (value) => value.toFixed(1) }
  }
  let lo = zeroBaseline ? 0 : Math.min(...finite)
  let hi = Math.max(...finite, zeroBaseline ? 0 : -Infinity)
  if (hi - lo < 1e-9) {
    const pad = Math.abs(hi) * 0.05 || 0.5
    lo -= zeroBaseline ? 0 : pad
    hi += pad
  }
  const pad = (hi - lo) * 0.05
  if (!zeroBaseline) lo -= pad
  hi += pad
  const step = niceStep((hi - lo) / Math.max(2, targetTicks - 1))
  const decimals = decimalsOf(step)
  const snap = (value: number) => Number(value.toFixed(Math.min(10, decimals + 2)))
  let start = snap(Math.floor(lo / step) * step)
  let end = snap(Math.ceil(hi / step) * step)
  let ticks: number[] = []
  for (let tick = start; tick <= end + step / 2; tick += step) ticks.push(snap(tick))
  if (bounds && bounds[0] < bounds[1]) {
    // Clamp after niceing; the clamped edges stay ticks (the window
    // always states where it starts and ends).
    start = Math.max(start, bounds[0])
    end = Math.min(end, bounds[1])
    if (end <= start) [start, end] = [Math.max(bounds[0], lo), Math.min(bounds[1], hi)]
    ticks = ticks.filter((tick) => tick >= start - 1e-9 && tick <= end + 1e-9)
    if (ticks.length === 0 || (ticks[0] ?? 0) > start + 1e-9) ticks.unshift(snap(start))
    if ((ticks[ticks.length - 1] ?? 0) < end - 1e-9) ticks.push(snap(end))
  }
  return {
    domain: [start, end],
    ticks,
    // A fixed precision per chart, with a true minus sign.
    format: (value) => value.toFixed(decimals).replace(/^-/, '−'),
  }
}

/** A measure's own limits for a fitted window: 0–100 for a share, −1…1
 * for a correlation, the catalog's min–max for a mean or median, none
 * for a model coefficient (unbounded). */
export function measureBounds(
  stat: string,
  variable: { min: number | null; max: number | null },
): [number, number] | undefined {
  if (stat === 'proportion' || stat === 'distribution' || stat === 'transition') return [0, 100]
  if (stat === 'pearson_r' || stat === 'spearman_r') return [-1, 1]
  if (stat === 'beta') return undefined
  if (variable.min !== null && variable.max !== null) return [variable.min, variable.max]
  return undefined
}

/** The plot-space extents a row occupies: its CI when present, else its value. */
export function ciExtents(
  entries: readonly { value: number | null; ci: [number, number] | null }[],
): number[] {
  const extents: number[] = []
  for (const entry of entries) {
    if (entry.ci !== null) extents.push(entry.ci[0], entry.ci[1])
    else if (entry.value !== null) extents.push(entry.value)
  }
  return extents
}
