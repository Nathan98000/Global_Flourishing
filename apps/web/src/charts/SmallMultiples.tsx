// One panel per country for outcome × demographic (§2.6): faceted dot
// plots with shared scales, ordered by value or by the gap between
// levels (never by name — ADR-0029). A second breakdown becomes a facet-column grid — one
// hue everywhere, so identity never rides on color for 4+ levels.
// Each panel is titled top-left in ink (F15), and reads its ticks under
// itself: the window's ends turned inward, the facets a gap apart (and
// wrapped onto more rows when the width cannot hold them) and the ticks
// thinned to the facet's width, so neighbouring facets' "10" and "0"
// never meet as "100".
// Every cell is shown (ADR-0011). The facet column defaults to country;
// What Matters facets a single country's items by age band instead.

import * as Plot from '@observablehq/plot'
import { useRef } from 'react'
import type { EstimateRow, Meta, ResponseMeta, VariableSummary } from '../api/types'
import { formatEstimate } from '../format'
import { columnLabel, groupValueLabel } from '../labels'
import type { SortDir } from '../sortRows'
import { dotEntries, dotMarks, dotTip, type DotEntry, type LevelLabeler } from './DotPlot'
import { ciExtents, fittedScale, measureBounds, phoneMinStep } from './domain'
import {
  plotRow,
  readableRowName,
  rowFocus as newRowFocus,
  withReadableRows,
  type ReadablePanel,
  type RowFocus,
} from './readableRows'
import {
  FACET_PADDING,
  FONT_FAMILY,
  INK,
  INK_SECONDARY,
  PANEL_AXIS_INSET,
  isThin,
  plotValue,
} from './theme'
import { chartWidth, usePlot } from './usePlot'

/** The strip at the top of each panel that holds its title. */
export const PANEL_TITLE_ROOM = 24
/** The strip under it that holds a grid facet's column label. */
const COLUMN_LABEL_ROOM = 16
/** A panel's height per row, beside its head strip and the room under
 * its rows for the ticks; the room above and below its plot; and the gap
 * between two panels. */
const LEVEL_STEP = 22
const PANEL_ROOM = 26 + PANEL_AXIS_INSET
const PANEL_MARGIN = 12
const PANEL_GAP = 16
/** The least width of a grid's facet, and the least gap between two. */
const MIN_FACET_WIDTH = 72
const MIN_FACET_GAP = 16
/** The least gap between two tick labels, in px. */
const TICK_LABEL_GAP = 6
/** About one glyph of the 11 px plot text, in px. */
const GLYPH = 6.6

/** The ticks a facet `facetWidth` px wide can label without two touching:
 * the first starts at the facet's left edge and the last ends at its
 * right edge (both turned inward), the rest centred — every second
 * (third, …) one when they would crowd. */
export function panelTicks(
  ticks: readonly number[],
  domain: readonly [number, number],
  label: (tick: number) => string,
  facetWidth: number,
): number[] {
  if (ticks.length <= 1) return [...ticks]
  const [lo, hi] = domain
  const xOf = (tick: number) => ((tick - lo) / (hi - lo || 1)) * facetWidth
  const extent = (tick: number, index: number, count: number): [number, number] => {
    const width = label(tick).length * GLYPH
    const x = xOf(tick)
    if (index === 0) return [x, x + width]
    if (index === count - 1) return [x - width, x]
    return [x - width / 2, x + width / 2]
  }
  const fits = (kept: number[]) =>
    kept.every((tick, index) => {
      if (index === 0) return true
      const before = extent(kept[index - 1] as number, index - 1, kept.length)
      return extent(tick, index, kept.length)[0] >= before[1] + TICK_LABEL_GAP
    })
  const first = ticks[0] as number
  const last = ticks[ticks.length - 1] as number
  const inner = ticks.slice(1, -1)
  for (let stride = 1; stride <= inner.length; stride += 1) {
    const kept = [first, ...inner.filter((_, index) => (index + 1) % stride === 0), last]
    if (fits(kept)) return kept
    // The last interval runs short: drop the inner tick next to the end.
    const trimmed = [...kept.slice(0, -2), last]
    if (kept.length > 2 && fits(trimmed)) return trimmed
  }
  return fits([first, last]) ? [first, last] : [first]
}

export type PanelSort = 'estimate' | 'gap'

/** Facet (country) order under each sort rule and direction — the one
 * ordering the panels and the CSV both consume; ties in name order.
 *
 * By value, a country goes by its own estimate (`overall`: the Atlas's
 * by-country number for the same question, year and statistic — the
 * server's, ADR-0031), never by an average of its groups, which a
 * one-person group could swing. By gap, the highest group less the
 * lowest, over groups that aren't thin: a country with fewer than two
 * goes last. Without `overall` (a facet that is not a country) the
 * groups' plain average stands in. */
export function facetOrder(
  rows: EstimateRow[],
  meta: Meta,
  facetColumn: string,
  sort: PanelSort,
  dir: SortDir = 'desc',
  overall?: ReadonlyMap<string, number>,
): string[] {
  const byFacet = new Map<string, number[]>()
  for (const row of rows) {
    const label = groupValueLabel(facetColumn, row.group[facetColumn] ?? null, meta)
    const value = plotValue(row)
    const bucket = byFacet.get(label) ?? []
    if (value !== null && (sort !== 'gap' || !isThin(row))) bucket.push(value)
    byFacet.set(label, bucket)
  }
  const labels = [...byFacet.keys()]
  const score = (label: string): number => {
    const values = byFacet.get(label) ?? []
    if (sort === 'gap') {
      return values.length < 2 ? -Infinity : Math.max(...values) - Math.min(...values)
    }
    if (overall) return overall.get(label) ?? -Infinity
    if (values.length === 0) return -Infinity
    return values.reduce((sum, value) => sum + value, 0) / values.length
  }
  const sign = dir === 'desc' ? 1 : -1
  // A country with no score goes last whichever way the order runs.
  return labels.sort((a, b) => {
    const sa = score(a)
    const sb = score(b)
    if (sa === -Infinity || sb === -Infinity) {
      return (sa === -Infinity ? 1 : 0) - (sb === -Infinity ? 1 : 0) || a.localeCompare(b)
    }
    return sign * (sb - sa) || a.localeCompare(b)
  })
}

/** Each country's own estimate, by its label, as the chart plots it —
 * from the by-country response (at one answer, for a share). */
export function countryEstimates(
  rows: readonly EstimateRow[],
  meta: Meta,
  level?: number,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const row of rows) {
    if (level !== undefined && row.level !== level) continue
    const value = plotValue(row)
    if (value === null) continue
    out.set(groupValueLabel('country_code', row.group['country_code'] ?? null, meta), value)
  }
  return out
}

export function SmallMultiples({
  rows,
  meta,
  responseMeta,
  variable,
  color,
  levelColumn,
  levelDomain,
  seriesColumn,
  seriesDomain,
  sort,
  dir,
  labeler,
  facetColumn = 'country_code',
  facetDomain,
  labelWidth,
  answer,
}: {
  rows: EstimateRow[]
  meta: Meta
  responseMeta: ResponseMeta
  variable: VariableSummary
  color: string
  /** The demographic on each panel's y axis. */
  levelColumn: string
  levelDomain: string[]
  /** One panel per value of this group column (country by default). */
  facetColumn?: string
  /** Panel order when it is served, not sorted (a demographic's levels). */
  facetDomain?: string[]
  /** Room for the row labels, when they run longer than a demographic's
   * levels (What Matters' item names); the phone keeps its own margin. */
  labelWidth?: number
  /** The answer a share counts, for the hover cards ("45.0% answered
   * “Yes”"). */
  answer?: string
  /** Optional second breakdown → facet columns (one hue, no legend). */
  seriesColumn?: string
  seriesDomain?: string[]
  sort: PanelSort
  dir?: SortDir
  labeler?: LevelLabeler
}) {
  const focus = useRef<RowFocus>(newRowFocus())
  const container = usePlot(
    (available) => {
      const facets = facetDomain ?? facetOrder(rows, meta, facetColumn, sort, dir)
      // A level takes a row only in the panels where it has an estimate
      // (H11, ADR-0033), so panels differ in height and no empty row
      // stands between the groups compared; a column of a second
      // breakdown, only where some panel has one (G6).
      const base = dotEntries(rows, meta, levelColumn, facetColumn, labeler)
      const valued = base.filter((entry) => entry.value !== null)
      const levelsOf = (facet: string) =>
        levelDomain.filter((level) =>
          valued.some((entry) => entry.facet === facet && entry.level === level),
        )
      const shown = facets.filter((facet) => levelsOf(facet).length > 0)
      const levels = levelDomain.filter((level) => valued.some((entry) => entry.level === level))
      const seriesOf = (entry: DotEntry) =>
        seriesColumn
          ? groupValueLabel(seriesColumn, entry.row.group[seriesColumn] ?? null, meta, labeler)
          : ''
      const presentSeries = new Set(valued.map(seriesOf))
      const isShare = responseMeta.stat === 'proportion' || responseMeta.stat === 'distribution'
      const width = chartWidth(seriesColumn ? 820 : 700, available)
      const narrow = width < 480
      // On a phone the row labels get the room their longest needs (up
      // to two-fifths of the width), so "Prefer not to answer" is never cut.
      const longest = Math.max(0, ...levels.map((level) => level.length))
      const marginLeft = narrow
        ? Math.round(Math.min(width * 0.4, Math.max(90, longest * GLYPH + 12)))
        : (labelWidth ?? 150)
      const marginRight = narrow ? 16 : 32
      const inner = width - marginLeft - marginRight
      // A second breakdown's facets sit side by side, as many to a row as
      // leave each MIN_FACET_WIDTH, MIN_FACET_GAP apart; the rest wrap
      // onto the next row under the same title (F15). No outer padding, so
      // a band step is inner / (n − padding).
      const series = seriesColumn
        ? (seriesDomain ?? []).filter((label) => presentSeries.has(label))
        : []
      const perRow = seriesColumn
        ? Math.max(
            1,
            Math.min(
              series.length,
              Math.floor((inner + MIN_FACET_GAP) / (MIN_FACET_WIDTH + MIN_FACET_GAP)),
            ),
          )
        : 1
      const padding =
        perRow > 1
          ? Math.min(
              0.5,
              Math.max(FACET_PADDING, (MIN_FACET_GAP * perRow) / (inner + MIN_FACET_GAP)),
            )
          : 0
      const facetWidth = (inner / (perRow - padding)) * (1 - padding)
      const chunks = Math.max(1, Math.ceil(series.length / perRow))
      const place = (label: string) => {
        const index = Math.max(0, series.indexOf(label))
        return { slot: index % perRow, chunk: Math.floor(index / perRow) }
      }
      const entries = base.map((entry) => {
        const column = seriesOf(entry)
        const { slot, chunk } = place(column)
        // The second breakdown rides into the card under the first.
        return {
          ...entry,
          band: chunk,
          slot,
          column: column || undefined,
          detail:
            seriesColumn && entry.detail
              ? `${entry.detail} · ${columnLabel(seriesColumn, meta)}: ${column}`
              : entry.detail,
        }
      })
      // One shared, data-fitted window across every panel (F1): shared so
      // panels stay comparable, fitted so the variation is visible — and
      // its ticks repeat inside each panel, so no panel is read against an
      // axis 23 rows away. It fits the cells with enough people behind
      // them (G6): a handful of people could stretch it across the whole
      // scale — a second split held 150 thin cells from 2.3 to 10 around
      // solid ones from 5.3 to 8.5. A thin cell beyond the window sits at
      // its edge with an arrow pointing on; its card gives its value.
      const solid = entries.filter((entry) => entry.value !== null && !isThin(entry.row))
      const scale = fittedScale(ciExtents(solid.length > 0 ? solid : entries), {
        // Fewer ticks when a second breakdown splits the width into columns.
        targetTicks: seriesColumn || narrow ? 4 : 5,
        bounds: measureBounds(responseMeta.stat, variable),
        minStep: narrow ? phoneMinStep(responseMeta.stat, variable) : 0,
      })
      const [lo, hi] = scale.domain
      const beyond = (entry: DotEntry) =>
        entry.value === null ? null : entry.value < lo ? 'low' : entry.value > hi ? 'high' : null
      const drawn = entries.map((entry) => {
        const side = beyond(entry)
        return side === null ? entry : { ...entry, value: side === 'low' ? lo : hi, ci: null }
      })
      const arrows = entries.flatMap((entry, index) => {
        const side = beyond(entry)
        return side === null ? [] : [{ ...(drawn[index] as (typeof drawn)[number]), side }]
      })
      const tickLabel = (tick: number) => (isShare ? `${scale.format(tick)}%` : scale.format(tick))
      const ticks = panelTicks(scale.ticks, scale.domain, tickLabel, facetWidth)
      // Each panel keeps a strip on top for its title (and, in a grid, its
      // column's label) and one under its last row for its tick labels, so
      // neither sits on a row label or a dot.
      const headRoom = PANEL_TITLE_ROOM + (seriesColumn ? COLUMN_LABEL_ROOM : 0)
      const facetChannel: Record<string, string> = seriesColumn
        ? { fy: 'band', fx: 'slot' }
        : { fy: 'band' }
      const tickMarks = (kept: number[], textAnchor: 'start' | 'middle' | 'end') =>
        Plot.text(kept, {
          x: (tick: number) => tick,
          text: tickLabel,
          frameAnchor: 'bottom',
          dy: -3,
          textAnchor,
          fill: INK_SECONDARY,
          fontSize: 11,
          ariaDescription: 'panel tick label',
        })
      const tipContext = { answer, range: variable }
      // One plot per panel, each as tall as its own rows: a country, its
      // title on its first row of facets; a label per facet of a grid,
      // naming its column.
      const panels = shown.map((facet) => {
        const own = levelsOf(facet)
        const height = PANEL_MARGIN + chunks * (own.length * LEVEL_STEP + headRoom + PANEL_ROOM)
        const inPanel = <T extends { facet: string }>(entry: T) => entry.facet === facet
        const plot = Plot.plot({
          height,
          width,
          marginLeft,
          marginRight,
          marginTop: 4,
          marginBottom: PANEL_MARGIN - 4,
          style: {
            fontFamily: FONT_FAMILY,
            fontSize: '11px',
            background: 'transparent',
            color: INK_SECONDARY,
          },
          // No axis over the chart: each panel reads its own, under it.
          x: { domain: scale.domain, axis: null, label: null },
          y: {
            domain: own,
            label: null,
            tickSize: 0,
            insetTop: headRoom,
            insetBottom: PANEL_AXIS_INSET,
          },
          fy: {
            domain: Array.from({ length: chunks }, (_, chunk) => chunk),
            paddingInner: 0.14,
            axis: null,
          },
          ...(seriesColumn
            ? {
                fx: {
                  domain: Array.from({ length: perRow }, (_, slot) => slot),
                  axis: null,
                  paddingInner: padding,
                  paddingOuter: 0,
                },
              }
            : {}),
          marks: [
            // The panel's title — its country — top-left at 13.5 in ink,
            // semibold, over its row labels (F15); level labels, column
            // labels and the value axis stay the 11px plot size.
            Plot.text([{ facet, band: 0, slot: 0 }], {
              fy: 'band',
              ...(seriesColumn ? { fx: 'slot' } : {}),
              text: 'facet',
              frameAnchor: 'top-left',
              dx: 2 - marginLeft,
              dy: 3,
              lineAnchor: 'top',
              textAnchor: 'start',
              fill: INK,
              fontSize: 13.5,
              fontWeight: 600,
              ariaDescription: 'panel title',
            }),
            ...(seriesColumn
              ? [
                  Plot.text(
                    series.map((label) => ({ label, band: place(label).chunk, ...place(label) })),
                    {
                      fy: 'band',
                      fx: 'slot',
                      text: 'label',
                      frameAnchor: 'top',
                      dy: PANEL_TITLE_ROOM + 1,
                      lineAnchor: 'top',
                      fill: INK_SECONDARY,
                      fontSize: 11,
                      ariaDescription: 'column label',
                    },
                  ),
                ]
              : []),
            // No facet channel → drawn in every facet: its frame and grid
            // under the head strip, and the shared axis labelled under it.
            Plot.frame({ stroke: 'var(--grid)', insetTop: headRoom }),
            Plot.gridX(ticks, { insetTop: headRoom }),
            tickMarks(ticks.slice(0, 1), 'start'),
            tickMarks(ticks.slice(1, -1), 'middle'),
            ...(ticks.length > 1 ? [tickMarks(ticks.slice(-1), 'end')] : []),
            ...dotMarks(drawn.filter(inPanel), color, facetChannel, lo, tipContext),
            // Beyond the window: an arrow just outside its edge, pointing on.
            ...(['low', 'high'] as const).map((side) =>
              Plot.text(
                arrows.filter((entry) => entry.side === side && inPanel(entry)),
                {
                  ...facetChannel,
                  y: 'level',
                  x: 'value',
                  text: () => (side === 'low' ? '◂' : '▸'),
                  dx: side === 'low' ? -9 : 9,
                  fill: color,
                  fontSize: 10,
                  ariaDescription: 'beyond the window',
                },
              ),
            ),
          ],
        })
        return { facet, own, plot, height }
      })
      // The panels stacked in one drawing — one SVG, so the PNG export
      // takes them all — each keeping its own plot, and so its own tips.
      const svgNs = 'http://www.w3.org/2000/svg'
      const drawing = document.createElementNS(svgNs, 'svg')
      const first = panels[0]?.plot
      for (const name of ['class', 'fill', 'font-family', 'font-size', 'text-anchor', 'style']) {
        const value = first?.getAttribute(name)
        if (value) drawing.setAttribute(name, value)
      }
      let top = 0
      const offsets = panels.map((panel) => {
        const at = top
        top += panel.height + PANEL_GAP
        return at
      })
      const total = Math.max(0, top - PANEL_GAP)
      drawing.setAttribute('width', String(width))
      drawing.setAttribute('height', String(total))
      drawing.setAttribute('viewBox', `0 0 ${width} ${total}`)
      panels.forEach((panel, index) => {
        panel.plot.setAttribute('x', '0')
        panel.plot.setAttribute('y', String(offsets[index]))
        // Plot's stylesheet sizes its plots `height: auto`, which inside
        // another SVG means the whole drawing: each keeps its own size.
        Object.assign(panel.plot.style, {
          width: `${width}px`,
          height: `${panel.height}px`,
          maxWidth: 'none',
        })
        drawing.append(panel.plot)
      })
      // A keyboard reads the panels row by row (H2, ADR-0032): within a
      // panel its groups in reading order, Page Down to the next country.
      const readable: ReadablePanel[] = panels.map((panel, index) => ({
        name: panel.facet,
        rows: Array.from({ length: chunks }, (_, chunk) => chunk).flatMap((chunk) =>
          panel.own.flatMap((level) =>
            drawn
              .filter(
                (entry) =>
                  entry.facet === panel.facet && entry.level === level && entry.band === chunk,
              )
              .sort((a, b) => a.slot - b.slot)
              .map((entry) => {
                const printed =
                  entry.row.estimate === null
                    ? null
                    : formatEstimate(entry.row.estimate, entry.row.stat)
                const group = [level, entry.column].filter(Boolean).join(', ')
                const geometry = plotRow(
                  panel.plot,
                  level,
                  entry.value ?? lo,
                  seriesColumn ? { fy: chunk, fx: entry.slot } : { fy: chunk },
                )
                return {
                  key: `${panel.facet}\u0000${group}`,
                  name: readableRowName(group, printed, isThin(entry.row)),
                  tip: dotTip(entry, tipContext),
                  geometry: { ...geometry, top: geometry.top + (offsets[index] ?? 0) },
                  across: group,
                }
              }),
          ),
        ),
      }))
      return withReadableRows(drawing, readable, focus.current)
    },
    [
      rows,
      meta,
      responseMeta,
      variable,
      color,
      levelColumn,
      levelDomain,
      seriesColumn,
      seriesDomain,
      sort,
      dir,
      labeler,
      facetColumn,
      facetDomain,
      labelWidth,
      answer,
    ],
  )

  return <div ref={container} />
}
