// Mount an Observable Plot render into React: build on a detached node,
// swap it in, clean up on unmount.
//
// The container's width is measured and handed to the build (F2/§10):
// the chart renders at the real column width — full-bleed in a wide
// column, honest per-row heights on a phone (a 23-row chart scrolls, it
// never shrinks). The design width only serves until the first measure.
//
// It re-fits on every change of that width, growing as well as
// shrinking: the ResizeObserver's width becomes state and the build
// reruns at it. Browsers deliver those observations with the page's
// rendering, so a hidden document (a background tab, an occluded
// window) gets them — and re-fits — when it is next shown. Until then
// an SVG built wider than its host is scaled down by Plot's max-width:
// 100%, which makes a missed shrink look right while a missed growth
// shows (the Correlates review's "doesn't widen on resize", 25 Sept
// 2026, reproduced only in a hidden tab; a rendering page re-fits on
// dev and the live build alike — see the test in charts.test.tsx).

import { useEffect, useRef, useState } from 'react'

/** The width a chart renders at: the measured container width (never
 * below 300), or the design width until the container is measured. */
export function chartWidth(designWidth: number, available: number | null): number {
  if (available === null || available <= 0) return designWidth
  return Math.max(300, Math.floor(available))
}

/**
 * `build` returns Plot.plot(...) output — an <svg>, or a <figure>
 * wrapping svg + legend — for the given available width (null until
 * measured, and always null under jsdom). Rebuilds when `deps` or the
 * measured width change.
 */
export function usePlot(build: (available: number | null) => Element, deps: readonly unknown[]) {
  const container = useRef<HTMLDivElement | null>(null)
  const [available, setAvailable] = useState<number | null>(null)

  useEffect(() => {
    const host = container.current
    if (!host || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const width = Math.round(host.getBoundingClientRect().width)
      setAvailable(width > 0 ? width : null)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const host = container.current
    if (!host) return
    const rendered = build(available)
    for (const svg of rendered instanceof SVGSVGElement
      ? [rendered]
      : rendered.querySelectorAll('svg')) {
      // The ChartFigure container carries role="img" + the summary; the
      // SVG internals (Plot labels its mark groups with aria-label on
      // plain <g>, which ARIA prohibits) stay out of the a11y tree —
      // the data table is the accessible path.
      svg.setAttribute('aria-hidden', 'true')
    }
    host.replaceChildren(rendered)
    return () => {
      rendered.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, available])
  return container
}
