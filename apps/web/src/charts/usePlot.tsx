// Mount an Observable Plot render into React: build on a detached node,
// swap it in, clean up on unmount.
//
// The container's width is measured and handed to the build (F2): a
// chart narrower than its design width re-renders at the real width
// instead of scaling down, so rows keep their per-row height and labels
// stay legible on a phone — a 23-row chart scrolls, it never shrinks.

import { useEffect, useRef, useState } from 'react'

/** The width a chart should render at: its design width, or the real
 * container width when that is narrower (never below 300). */
export function chartWidth(designWidth: number, available: number | null): number {
  if (available === null || available <= 0) return designWidth
  return Math.max(300, Math.min(designWidth, Math.floor(available)))
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
