// The keyboard's way into a chart's marks (G18, ADR-0032, ADR-0033): a
// layer of rows over the plot, each a band over its mark, and the hover
// card they open, in the Plot tips' look (TipCard.tsx). Read one by one
// — one tab stop on the chart, ↑ ↓ Home End between rows, the row's card
// open while it has focus, Escape to close it — or, on the Correlates
// list, rows that are real buttons (ADR-0018). A chart of panels (each
// Segments country) reads panel by panel: ↑ ↓ within a panel, Page Down
// and Page Up to the next and previous one, Home and End to its ends.
// The ranked charts (RankedBar), Change's dots (ChangeDots) and the
// Segments panels (SmallMultiples) share it; it draws nothing itself.

import type * as Plot from '@observablehq/plot'
import styles from './RankedBar.module.css'
import { fillTipCard } from './tipLines'
import { TIP_OPTIONS } from './theme'

/** Where a row sits over the drawing, in px from its top left: its band
 * (`top`, `height`; across the full width unless `left` and `width` say
 * otherwise) and its mark's x, beside which its card opens. */
export interface RowGeometry {
  top: number
  height: number
  x: number
  left?: number
  width?: number
}

/** A row the keyboard reads: a key that finds it again across rebuilds,
 * its name (with its value — H3), its card's text and where it sits. */
export interface ReadableRow {
  key: string
  name: string
  tip: string
  geometry: RowGeometry
  /** The group it stands for across panels ("18–24 · Female"): Page Down
   * lands on the next panel's row of the same group. */
  across?: string
}

/** A panel's rows (a Segments country), named for a screen reader's
 * list of lists. */
export interface ReadablePanel {
  name: string
  rows: ReadableRow[]
}

/** Where the keyboard is in a chart's rows, kept across its rebuilds (a
 * resize, a new render): the row holding the tab stop, the pinned row it
 * last moved to, and whether a row had focus when its layer was taken
 * out — the new layer's row then takes it back. */
export interface RowFocus {
  active: string | null
  pinned: string | null
  reading: boolean
}

export function rowFocus(): RowFocus {
  return { active: null, pinned: null, reading: false }
}

/** A readable row's name (H3, ADR-0032 revised): its label, then the
 * value the chart prints — "Indonesia, 8.10", or "Indonesia, 7.40, few
 * people" for a thin one — so a screen reader's browse mode hears the
 * numbers; the card, with the CI and n, stays its description on focus. */
export function readableRowName(label: string, printed: string | null, thin: boolean): string {
  return `${label}, ${printed ?? 'no estimate'}${thin ? ', few people' : ''}`
}

/** A scale as Plot exposes it once a plot is built. */
interface BuiltScale {
  apply: (value: unknown) => number
  range?: readonly number[]
  bandwidth?: number
  step?: number
}

/** A row of a built plot: its band on `y` (inside its `fy` facet, if
 * any) and its mark's x on `x` (inside its `fx` facet). A facet's marks
 * are drawn translated by the facet's place less the plot's margin — the
 * start of the facet scale's range. */
export function plotRow(
  plot: Plot.Plot,
  y: unknown,
  x: number,
  facet: { fx?: unknown; fy?: unknown } = {},
): RowGeometry {
  const ys = plot.scale('y') as unknown as BuiltScale
  const xs = plot.scale('x') as unknown as BuiltScale
  const band = ys.bandwidth ?? 0
  const step = ys.step ?? band
  const facetScale = (name: 'fx' | 'fy', key: unknown) =>
    key === undefined ? undefined : (plot.scale(name) as unknown as BuiltScale | undefined)
  const offset = (name: 'fx' | 'fy', key: unknown) => {
    const scale = facetScale(name, key)
    return scale ? scale.apply(key) - (scale.range?.[0] ?? 0) : 0
  }
  const dx = offset('fx', facet.fx)
  const geometry: RowGeometry = {
    top: ys.apply(y) - (step - band) / 2 + offset('fy', facet.fy),
    height: step,
    x: xs.apply(x) + dx,
  }
  const fx = facetScale('fx', facet.fx)
  if (fx) {
    geometry.left = fx.apply(facet.fx)
    geometry.width = fx.bandwidth ?? 0
  }
  return geometry
}

let tipCount = 0

/** The room between a mark and its hover card, in px. */
const TIP_GAP = 10

/** A layer over the drawing for its rows and the hover card they open,
 * beside the row's mark; Escape closes it where it stands (WCAG 1.4.13). */
export function rowLayer(drawing: Element) {
  const wrap = document.createElement('div')
  wrap.className = styles.interactive ?? ''
  const layer = document.createElement('div')
  layer.className = styles.rows ?? ''
  const tipBox = document.createElement('div')
  tipBox.className = styles.tip ?? ''
  tipBox.setAttribute('role', 'tooltip')
  tipBox.id = `ranked-tip-${(tipCount += 1)}`
  tipBox.hidden = true
  Object.assign(tipBox.style, {
    fontFamily: TIP_OPTIONS.fontFamily,
    fontSize: `${TIP_OPTIONS.fontSize}px`,
    borderColor: TIP_OPTIONS.stroke,
  })
  const place = (row: HTMLElement, geometry: RowGeometry) => {
    row.style.top = `${geometry.top}px`
    row.style.height = `${geometry.height}px`
    if (geometry.left !== undefined) row.style.left = `${geometry.left}px`
    if (geometry.width !== undefined) {
      row.style.right = 'auto'
      row.style.width = `${geometry.width}px`
    }
  }
  const show = (row: HTMLElement, geometry: RowGeometry, text: string) => {
    fillTipCard(tipBox, text)
    tipBox.hidden = false
    const width = tipBox.offsetWidth
    const height = tipBox.offsetHeight
    const { top, height: step, x: mark } = geometry
    const room = wrap.clientWidth || Number(drawing.getAttribute('width')) || 0
    // Beside the mark, level with its row — to the right when it fits,
    // else to the left — so the card never covers the rows above (F22);
    // over or under the row when neither side holds it (a phone).
    const level = Math.max(0, top + step / 2 - height / 2)
    const above = top - height - 4
    const [left, cardTop] =
      mark + TIP_GAP + width <= room
        ? [mark + TIP_GAP, level]
        : mark - TIP_GAP - width >= 0
          ? [mark - TIP_GAP - width, level]
          : [
              Math.max(0, Math.min(mark - width / 2, room - width)),
              above >= 0 ? above : top + step + 4,
            ]
    tipBox.style.left = `${left}px`
    tipBox.style.top = `${cardTop}px`
    row.setAttribute('aria-describedby', tipBox.id)
  }
  const hide = (row: HTMLElement) => {
    tipBox.hidden = true
    row.removeAttribute('aria-describedby')
  }
  layer.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || tipBox.hidden || !(event.target instanceof HTMLElement)) return
    hide(event.target)
  })
  wrap.append(drawing, layer, tipBox)
  return { wrap, layer, place, show, hide }
}

/** The description of a pinned card's mark (how it is found again, to
 * step aside while its row's keyboard card is open). */
export const PINNED_TIP = 'pinned tip'

/** The rows as lists a keyboard reads one by one (G18, ADR-0032): one
 * tab stop on the chart — the pinned row's (US States' Find a state) or
 * where the reader left it, else the first — and the row it rests on
 * opens its card, announced as its description. One list moves with
 * ↑ ↓ Home End; panels (a list each) move with ↑ ↓ inside a panel, Home
 * and End to its ends, Page Down and Page Up to the same row of the next
 * and previous panel (or its nearest). The rows never take the pointer:
 * hover keeps Plot's own tip. */
export function withReadableRows(
  drawing: Element,
  content: ReadableRow[] | ReadablePanel[],
  focus: RowFocus,
  pinned: string | null = null,
): HTMLElement {
  const rows = rowLayer(drawing)
  const panels: ReadablePanel[] =
    content.length > 0 && 'rows' in (content[0] as object)
      ? (content as ReadablePanel[])
      : [{ name: '', rows: content as ReadableRow[] }]
  const grouped = panels.length > 1 || panels[0]?.name !== ''
  if (pinned !== null && pinned !== focus.pinned) focus.active = pinned
  focus.pinned = pinned
  const all = panels.flatMap((panel) => panel.rows)
  const start = Math.max(
    0,
    all.findIndex((row) => row.key === focus.active),
  )
  // A pinned card steps aside while its row's own card is open.
  const pinnedCards = [
    ...drawing.querySelectorAll<SVGElement>(`g[aria-description="${PINNED_TIP}"]`),
  ]
  const items: HTMLDivElement[] = []
  const panelOf: number[] = []
  panels.forEach((panel, panelIndex) => {
    const list = grouped ? document.createElement('div') : rows.layer
    list.setAttribute('role', 'list')
    if (grouped) list.setAttribute('aria-label', panel.name)
    for (const row of panel.rows) {
      const index = items.length
      const item = document.createElement('div')
      item.className = [styles.row, styles.reading].filter(Boolean).join(' ')
      rows.place(item, row.geometry)
      item.setAttribute('role', 'listitem')
      item.setAttribute('aria-label', row.name)
      item.tabIndex = index === start ? 0 : -1
      item.addEventListener('focus', () => {
        focus.active = row.key
        focus.reading = true
        for (const other of items) other.tabIndex = other === item ? 0 : -1
        if (row.key === pinned) for (const card of pinnedCards) card.style.visibility = 'hidden'
        rows.show(item, row.geometry, row.tip)
      })
      item.addEventListener('blur', () => {
        rows.hide(item)
        for (const card of pinnedCards) card.style.visibility = ''
        // Once focus lands: still reading if it moved to another row; a
        // row taken out by a rebuild leaves the flag for the new layer.
        queueMicrotask(() => {
          if (item.isConnected) focus.reading = rows.layer.contains(document.activeElement)
        })
      })
      list.append(item)
      items.push(item)
      panelOf.push(panelIndex)
    }
    if (grouped) rows.layer.append(list)
  })
  const firstOf = (panel: number) => panelOf.indexOf(panel)
  const lastOf = (panel: number) => panelOf.lastIndexOf(panel)
  rows.layer.addEventListener('keydown', (event) => {
    const at = items.indexOf(event.target as HTMLDivElement)
    if (at < 0) return
    const panel = panelOf[at] ?? 0
    const [first, last] = [firstOf(panel), lastOf(panel)]
    // Page Down / Up: the same row of the next or previous panel — the
    // same group, when it has one — else its nearest row.
    const across = (step: 1 | -1) => {
      let next = panel + step
      while (next >= 0 && next < panels.length && firstOf(next) < 0) next += step
      if (next < 0 || next >= panels.length) return at
      const group = all[at]?.across
      const target = panels[next]?.rows ?? []
      const same = group === undefined ? -1 : target.findIndex((row) => row.across === group)
      const offset = same >= 0 ? same : Math.min(at - first, target.length - 1)
      return firstOf(next) + offset
    }
    const to =
      event.key === 'ArrowDown'
        ? Math.min(at + 1, last)
        : event.key === 'ArrowUp'
          ? Math.max(at - 1, first)
          : event.key === 'Home'
            ? first
            : event.key === 'End'
              ? last
              : grouped && event.key === 'PageDown'
                ? across(1)
                : grouped && event.key === 'PageUp'
                  ? across(-1)
                  : undefined
    if (to === undefined) return
    event.preventDefault()
    items[to]?.focus()
  })
  // Rebuilt under the reader (a resize, a new render): the same row
  // takes focus back once the new layer is in the page.
  if (focus.reading) {
    queueMicrotask(() => {
      const item = items[start]
      if (item?.isConnected && !rows.layer.contains(document.activeElement)) {
        item.focus({ preventScroll: true })
      }
    })
  }
  return rows.wrap
}
