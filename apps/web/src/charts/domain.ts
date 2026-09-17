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
  { targetTicks = 6, zeroBaseline = false }: { targetTicks?: number; zeroBaseline?: boolean } = {},
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
  const start = snap(Math.floor(lo / step) * step)
  const end = snap(Math.ceil(hi / step) * step)
  const ticks: number[] = []
  for (let tick = start; tick <= end + step / 2; tick += step) ticks.push(snap(tick))
  return {
    domain: [start, end],
    ticks,
    format: (value) => value.toFixed(decimals),
  }
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
