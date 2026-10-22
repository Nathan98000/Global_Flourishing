// PNG export: serialize the Plot SVG with the computed token colors
// inlined (the live SVG uses `var(--…)`, which a rasterizer cannot
// resolve), draw at 2× onto a canvas, and stamp the chart's header onto
// the image — its title in the page's serif, its subtitle and its key
// (G8) — with the citation line under it: the image is what gets shared,
// and travels without the page. The data version stays out of the footer
// (ADR-0016); the CSV's meta lines carry it.

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

/** One entry of the chart's key, as ChartKey draws it. */
export interface PngKeyEntry {
  glyph: 'dot' | 'bar' | 'whisker' | 'thin-dot' | 'thin-bar'
  label: string
  color: string
}

export interface PngStamp {
  title: string
  /** The chart's subtitle — its units, year, countries and order. */
  subtitle?: string
  /** The chart's key, so the marks can be read off the page. */
  key?: PngKeyEntry[]
}

/** The header is the chart title; the footer is just the citation line. */
export function stampLines(stamp: PngStamp): { header: string; footer: string } {
  return { header: stamp.title, footer: CITATION_LINE }
}

/** A key read from the figure's ChartKey (its entries carry `data-key`),
 * so the image's key says what the page's says. */
export function keyFromFigure(figure: Element | null): PngKeyEntry[] {
  if (!figure) return []
  return [...figure.querySelectorAll<HTMLElement>('[data-key]')].map((entry) => ({
    glyph: entry.dataset['key'] as PngKeyEntry['glyph'],
    label: entry.textContent?.trim() ?? '',
    color: entry.dataset['color'] ?? 'var(--series-1)',
  }))
}

/** Words broken onto lines no wider than `width`. */
export function wrapWords(
  text: string,
  width: number,
  measure: (text: string) => number,
): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (line && measure(next) > width) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines
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
const FOOTER = 22
const TITLE_FONT = '600 18px "Source Serif 4", Georgia, serif'
const SUBTITLE_FONT = '12px system-ui, sans-serif'
const KEY_FONT = '11px system-ui, sans-serif'

/** One key entry's mark, as ChartKey draws it, at (x, y) — its middle. */
function drawGlyph(
  context: CanvasRenderingContext2D,
  entry: PngKeyEntry,
  x: number,
  y: number,
  resolve: TokenResolver,
): number {
  const color = entry.color.replace(VAR_PATTERN, (_match, name: string) => resolve(name))
  context.lineWidth = 1.5
  if (entry.glyph === 'whisker') {
    context.strokeStyle = resolve('--whisker')
    context.beginPath()
    context.moveTo(x, y)
    context.lineTo(x + 16, y)
    context.moveTo(x, y - 3)
    context.lineTo(x, y + 3)
    context.moveTo(x + 16, y - 3)
    context.lineTo(x + 16, y + 3)
    context.stroke()
    return 18
  }
  const hollow = entry.glyph.startsWith('thin')
  context.fillStyle = hollow ? resolve('--surface') : color
  context.strokeStyle = color
  context.beginPath()
  if (entry.glyph.endsWith('dot')) context.arc(x + 6, y, hollow ? 3.5 : 4, 0, Math.PI * 2)
  else context.rect(x, y - 3.5, 13, 7)
  context.fill()
  if (hollow) context.stroke()
  return 14
}

/** Browser-only: rasterize and download under `filename` (see
 * export/filename.ts). Returns false when unsupported. */
export async function downloadChartPng(
  svg: SVGSVGElement,
  stamp: PngStamp,
  filename: string,
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
    await document.fonts?.load(TITLE_FONT).catch(() => undefined)
    const canvas = document.createElement('canvas')
    const probe = canvas.getContext('2d')
    if (!probe) return false
    const measure = (font: string) => (text: string) => {
      probe.font = font
      return probe.measureText(text).width
    }
    const { header, footer } = stampLines(stamp)
    const titleLines = wrapWords(header, width, measure(TITLE_FONT))
    const subtitleLines = stamp.subtitle
      ? wrapWords(stamp.subtitle, width, measure(SUBTITLE_FONT))
      : []
    const key = stamp.key ?? []
    const headerHeight =
      titleLines.length * 23 + subtitleLines.length * 17 + (key.length ? 22 : 0) + 8
    canvas.width = (width + PAD * 2) * SCALE
    canvas.height = (height + headerHeight + FOOTER + PAD * 2) * SCALE
    const context = canvas.getContext('2d')
    if (!context) return false
    context.scale(SCALE, SCALE)
    context.fillStyle = resolve('--surface')
    context.fillRect(0, 0, canvas.width, canvas.height)
    let y = PAD
    context.fillStyle = resolve('--ink')
    context.font = TITLE_FONT
    for (const line of titleLines) {
      y += 23
      context.fillText(line, PAD, y - 5)
    }
    context.fillStyle = resolve('--ink-secondary')
    context.font = SUBTITLE_FONT
    for (const line of subtitleLines) {
      y += 17
      context.fillText(line, PAD, y - 4)
    }
    if (key.length) {
      y += 22
      let x = PAD
      context.font = KEY_FONT
      for (const entry of key) {
        x += drawGlyph(context, entry, x, y - 8, resolve) + 5
        context.fillStyle = resolve('--ink-secondary')
        context.fillText(entry.label, x, y - 4)
        x += measure(KEY_FONT)(entry.label) + 14
      }
    }
    y += 8
    context.drawImage(image, PAD, y, width, height)
    context.fillStyle = resolve('--ink-secondary')
    context.font = KEY_FONT
    context.fillText(footer, PAD, y + height + 15)
    const blob = await new Promise<Blob | null>((accept) => canvas.toBlob(accept, 'image/png'))
    if (!blob) return false
    const pngUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = pngUrl
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(pngUrl)
    return true
  } finally {
    URL.revokeObjectURL(svgUrl)
  }
}
