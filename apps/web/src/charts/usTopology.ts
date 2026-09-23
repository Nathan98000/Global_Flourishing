// The US states topology for the state choropleth (Phase 5): us-atlas
// states-10m, vendored under charts/assets (no new dependency — see the
// README there) and fetched only inside the lazy US States map chunk,
// exactly the way the world map loads.
//
// The release keys states by two-letter code — plus four pooled groups
// of small states (ME_NH_RI_VT, DE_MS_WV, AK_HI_MT, ND_SD_WY) so state
// estimates keep adequate n — while us-atlas keys features by FIPS. The
// postal → FIPS table below is a rendering-asset concern, like the
// world map's ISO3 → numeric join; the labels the page shows are the
// server's own codes, and the topology's names appear only in the tip.

import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import type { EstimateRow } from '../api/types'
import topologyUrl from './assets/us-states-10m.json?url'
import { plotValue } from './theme'

export interface UsFeature {
  type: 'Feature'
  id?: string | number
  properties: { name?: string }
  geometry: {
    type: string
    coordinates: unknown
  } | null
}

/** The fifty states and DC; territories in the file (PR, GU, …) are
 * dropped, since the study has no respondents there. */
export const POSTAL_TO_FIPS: Record<string, string> = {
  AL: '01',
  AK: '02',
  AZ: '04',
  AR: '05',
  CA: '06',
  CO: '08',
  CT: '09',
  DE: '10',
  DC: '11',
  FL: '12',
  GA: '13',
  HI: '15',
  ID: '16',
  IL: '17',
  IN: '18',
  IA: '19',
  KS: '20',
  KY: '21',
  LA: '22',
  ME: '23',
  MD: '24',
  MA: '25',
  MI: '26',
  MN: '27',
  MS: '28',
  MO: '29',
  MT: '30',
  NE: '31',
  NV: '32',
  NH: '33',
  NJ: '34',
  NM: '35',
  NY: '36',
  NC: '37',
  ND: '38',
  OH: '39',
  OK: '40',
  OR: '41',
  PA: '42',
  RI: '44',
  SC: '45',
  SD: '46',
  TN: '47',
  TX: '48',
  UT: '49',
  VT: '50',
  VA: '51',
  WA: '53',
  WV: '54',
  WI: '55',
  WY: '56',
}

const KNOWN_FIPS = new Set(Object.values(POSTAL_TO_FIPS))

/** A pooled group's members: the release joins small states' codes with
 * underscores (`ME_NH_RI_VT`), so the code itself says who is in it. */
export function stateMembers(code: string): string[] {
  return code.split('_').filter(Boolean)
}

export function featuresFromUsTopology(topology: unknown): UsFeature[] {
  const us = topology as Topology<{ states: GeometryCollection<{ name?: string }> }>
  const collection = feature(us, us.objects.states)
  return (collection.features as unknown as UsFeature[]).filter((item) =>
    KNOWN_FIPS.has(String(item.id)),
  )
}

let cache: Promise<UsFeature[]> | null = null

export function loadUsStateFeatures(): Promise<UsFeature[]> {
  cache ??= fetch(topologyUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`topology fetch failed: HTTP ${response.status}`)
      return response.json()
    })
    .then(featuresFromUsTopology)
    .catch((error: unknown) => {
      cache = null
      throw error
    })
  return cache
}

export interface StateEntry {
  feature: UsFeature
  /** The server's state code (a state, or the pooled group it belongs to). */
  code: string | null
  row: EstimateRow | null
  /** The topology's name for the feature — tip copy only. */
  name: string
  value: number | null
}

/** Join state rows to the fifty-one features: every feature is drawn,
 * a pooled group fills each of its members, and codes the topology
 * cannot place are reported rather than dropped silently. */
export function joinStates(
  rows: readonly EstimateRow[],
  features: readonly UsFeature[],
): { entries: StateEntry[]; unmatched: string[] } {
  const byFips = new Map(features.map((item) => [String(item.id), item]))
  const rowByFips = new Map<string, { row: EstimateRow; code: string }>()
  const unmatched: string[] = []
  for (const row of rows) {
    const code = String(row.group['state'] ?? '')
    if (!code) continue
    let placed = false
    for (const member of stateMembers(code)) {
      const fips = POSTAL_TO_FIPS[member]
      if (fips && byFips.has(fips)) {
        rowByFips.set(fips, { row, code })
        placed = true
      }
    }
    if (!placed) unmatched.push(code)
  }
  const entries = features.map((item) => {
    const hit = rowByFips.get(String(item.id))
    return {
      feature: item,
      code: hit?.code ?? null,
      row: hit?.row ?? null,
      name: item.properties.name ?? String(item.id),
      value: hit ? plotValue(hit.row) : null,
    }
  })
  return { entries, unmatched }
}
