// PNG export: serialize the Plot SVG with the computed token colors
// inlined (the live SVG uses `var(--…)`, which a rasterizer cannot
// resolve), draw at 2× onto a canvas, and stamp the chart title, data
// version and DOI onto the image — the image is what gets shared.

export const CITATION_LINE =
  'Global Flourishing Study, Waves 1–2 · doi.org/10.17605/OSF.IO/3JTZ8 · flourish-atlas.pages.dev'

const VAR_PATTERN = /var\((--[\w-]+)\)/g

export type TokenResolver = (name: string) => string

export function documentTokenResolver(): TokenResolver {
  const styles = getComputedStyle(document.documentElement)
  return (name) => styles.getPropertyValue(name).trim() || '#000000'
}

function resolveValue(value: string, resolve: TokenResolver): string {
  return value.replace(VAR_PATTERN, (_match, name: string) => resolve(name))
}

/** Replace every var(--token) in paint attributes and inline styles. */
export function inlineTokenColors(root: Element, resolve: TokenResolver): void {
  const attributes = ['fill', 'stroke', 'stop-color', 'color']
  const all = [root, ...root.querySelectorAll('*')]
  for (const element of all) {
    for (const name of attributes) {
      const value = element.getAttribute(name)
      if (value?.includes('var(')) element.setAttribute(name, resolveValue(value, resolve))
    }
    const style = element.getAttribute('style')
    if (style?.includes('var(')) element.setAttribute('style', resolveValue(style, resolve))
  }
}

export interface PngStamp {
  title: string
  dataVersion: string | null
}

export function stampLines(stamp: PngStamp): { header: string; footer: string } {
  return {
    header: stamp.title,
    footer: `data ${stamp.dataVersion ?? '—'} · ${CITATION_LINE}`,
  }
}

export function pngFilename(title: string, dataVersion: string | null): string {
  const slug = title.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return `flourish_${slug}_${dataVersion ?? 'nodata'}.png`
}

/** [width, height] from attributes or the viewBox (jsdom-safe). */
export function svgSize(svg: SVGSVGElement): [number, number] {
  const attr = (name: string) => Number(svg.getAttribute(name)) || 0
  if (attr('width') && attr('height')) return [attr('width'), attr('height')]
  const viewBox = (svg.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  if (viewBox.length === 4 && viewBox[2] && viewBox[3]) return [viewBox[2], viewBox[3]]
  return [svg.clientWidth || 640, svg.clientHeight || 400]
}

/** Serialize an SVG with tokens inlined and an explicit size. */
export function serializeSvg(svg: SVGSVGElement, resolve: TokenResolver): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  inlineTokenColors(clone, resolve)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  if (!clone.getAttribute('width')) {
    const [width, height] = svgSize(svg)
    clone.setAttribute('width', String(width))
    clone.setAttribute('height', String(height))
  }
  return new XMLSerializer().serializeToString(clone)
}

const SCALE = 2
const PAD = 16
const HEADER = 28
const FOOTER = 22

/** Browser-only: rasterize and download. Returns false when unsupported. */
export async function downloadChartPng(
  svg: SVGSVGElement,
  stamp: PngStamp,
  resolve: TokenResolver = documentTokenResolver(),
): Promise<boolean> {
  const [width, height] = svgSize(svg)
  const source = serializeSvg(svg, resolve)
  const image = new Image()
  const svgUrl = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }))
  try {
    await new Promise<void>((accept, reject) => {
      image.onload = () => accept()
      image.onerror = () => reject(new Error('SVG rasterization failed'))
      image.src = svgUrl
    })
    const canvas = document.createElement('canvas')
    canvas.width = (width + PAD * 2) * SCALE
    canvas.height = (height + HEADER + FOOTER + PAD * 2) * SCALE
    const context = canvas.getContext('2d')
    if (!context) return false
    context.scale(SCALE, SCALE)
    context.fillStyle = resolve('--surface')
    context.fillRect(0, 0, canvas.width, canvas.height)
    const { header, footer } = stampLines(stamp)
    context.fillStyle = resolve('--ink')
    context.font = '600 15px system-ui, sans-serif'
    context.fillText(header, PAD, PAD + 14)
    context.drawImage(image, PAD, PAD + HEADER, width, height)
    context.fillStyle = resolve('--ink-secondary')
    context.font = '11px system-ui, sans-serif'
    context.fillText(footer, PAD, PAD + HEADER + height + 15)
    const blob = await new Promise<Blob | null>((accept) => canvas.toBlob(accept, 'image/png'))
    if (!blob) return false
    const pngUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = pngUrl
    anchor.download = pngFilename(stamp.title, stamp.dataVersion)
    anchor.click()
    URL.revokeObjectURL(pngUrl)
    return true
  } finally {
    URL.revokeObjectURL(svgUrl)
  }
}
