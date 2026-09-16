// Mount an Observable Plot render into React: build on a detached node,
// swap it in, clean up on unmount. The hatch pattern every chart may use
// for suppressed marks is injected here so `url(#suppressed-hatch)` and
// the `var(--…)` colors resolve inside the chart's own SVG.

import { useEffect, useRef } from 'react'

const HATCH_ID = 'suppressed-hatch'

export function ensureSuppressedHatch(svg: SVGSVGElement): void {
  if (svg.querySelector(`#${HATCH_ID}`)) return
  const ns = 'http://www.w3.org/2000/svg'
  const defs = document.createElementNS(ns, 'defs')
  const pattern = document.createElementNS(ns, 'pattern')
  pattern.setAttribute('id', HATCH_ID)
  pattern.setAttribute('width', '5')
  pattern.setAttribute('height', '5')
  pattern.setAttribute('patternUnits', 'userSpaceOnUse')
  pattern.setAttribute('patternTransform', 'rotate(45)')
  const bg = document.createElementNS(ns, 'rect')
  bg.setAttribute('width', '5')
  bg.setAttribute('height', '5')
  bg.setAttribute('fill', 'var(--suppressed-fill)')
  const line = document.createElementNS(ns, 'line')
  line.setAttribute('x1', '0')
  line.setAttribute('y1', '0')
  line.setAttribute('x2', '0')
  line.setAttribute('y2', '5')
  line.setAttribute('stroke', 'var(--suppressed-hatch)')
  line.setAttribute('stroke-width', '1')
  pattern.append(bg, line)
  defs.append(pattern)
  svg.prepend(defs)
}

/**
 * `build` returns Plot.plot(...) output — an <svg>, or a <figure>
 * wrapping svg + legend. Rebuilds when `deps` change.
 */
export function usePlot(build: () => Element, deps: readonly unknown[]) {
  const container = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const host = container.current
    if (!host) return
    const rendered = build()
    for (const svg of rendered instanceof SVGSVGElement
      ? [rendered]
      : rendered.querySelectorAll('svg')) {
      ensureSuppressedHatch(svg as SVGSVGElement)
    }
    host.replaceChildren(rendered)
    return () => {
      rendered.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return container
}
