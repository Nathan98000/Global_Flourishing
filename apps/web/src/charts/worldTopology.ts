// The world topology for the choropleth. countries-50m is the smallest
// Natural Earth build that carries a Hong Kong feature (110m does not —
// ADR-0010), so no country silently disappears from a map of 23. The
// JSON rides as a hashed Vite asset (~756 KB raw / 230 KB gz) fetched
// only inside this lazy map chunk, never in the initial route.

import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import topologyUrl from 'world-atlas/countries-50m.json?url'

export interface WorldFeature {
  type: 'Feature'
  id?: string | number
  properties: { name?: string }
  geometry: {
    type: string
    coordinates: unknown
  } | null
}

/**
 * world-atlas keys features by ISO 3166-1 *numeric* id; the catalog
 * speaks alpha-3. This join table is a rendering-asset concern (names
 * still come from meta.countries) and is pinned by a test that resolves
 * every catalog country to a feature in the shipped topology.
 */
export const ISO3_TO_NUMERIC: Record<string, string> = {
  ARG: '032',
  AUS: '036',
  BRA: '076',
  EGY: '818',
  DEU: '276',
  IND: '356',
  IDN: '360',
  ISR: '376',
  JPN: '392',
  KEN: '404',
  MEX: '484',
  NGA: '566',
  PHL: '608',
  POL: '616',
  ZAF: '710',
  ESP: '724',
  TZA: '834',
  TUR: '792',
  GBR: '826',
  USA: '840',
  SWE: '752',
  HKG: '344',
  CHN: '156',
}

const ANTARCTICA = '010'

export function featuresFromTopology(topology: unknown): WorldFeature[] {
  const world = topology as Topology<{ countries: GeometryCollection<{ name?: string }> }>
  const collection = feature(world, world.objects.countries)
  return (collection.features as unknown as WorldFeature[]).filter(
    (item) => String(item.id) !== ANTARCTICA,
  )
}

let cache: Promise<WorldFeature[]> | null = null

export function loadWorldFeatures(): Promise<WorldFeature[]> {
  cache ??= fetch(topologyUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`topology fetch failed: HTTP ${response.status}`)
      return response.json()
    })
    .then(featuresFromTopology)
    .catch((error: unknown) => {
      cache = null
      throw error
    })
  return cache
}

/**
 * Bounding-box area in square degrees. Territories below ~1 sq° (Hong
 * Kong is ~0.1) are sub-pixel on a world map and get a labelled centroid
 * marker instead of relying on their fill.
 */
export function bboxAreaSqDeg(geometry: WorldFeature['geometry']): number {
  if (!geometry) return 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const visit = (node: unknown): void => {
    if (!Array.isArray(node)) return
    if (node.length >= 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
      const [x, y] = node as [number, number]
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      return
    }
    for (const child of node) visit(child)
  }
  visit(geometry.coordinates)
  if (minX > maxX) return 0
  return (maxX - minX) * (maxY - minY)
}

export const SMALL_TERRITORY_SQ_DEG = 1
