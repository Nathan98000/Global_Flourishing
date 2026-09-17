// Response coverage per country for a wave (proposal §3.4: no Wave-2 or
// midyear number is honest without it — retention runs from 90% in China
// to 23% in Hong Kong). Two sources, one shape: an item's missingness
// rows carry who answered per wave; a derived score has no missingness
// rows, so its coverage comes from the unweighted n per country in the
// wave's own estimates against the same query at Wave 1 — both files the
// static tier already serves, so the story survives the API being down.

import type { EstimateRow, MissingnessRow } from './api/types'

export interface CountryCoverage {
  country_code: number
  presentAtWave: number
  presentAtY1: number
  /** presentAtWave / presentAtY1; null when Y1 has no rows to compare to. */
  fraction: number | null
}

export function coverageByCountry(rows: MissingnessRow[], wave: 'MY' | 'Y2'): CountryCoverage[] {
  const y1 = new Map<number, number>()
  const atWave = new Map<number, number>()
  for (const row of rows) {
    if (row.wave === 'Y1') y1.set(row.country_code, row.n_present)
    if (row.wave === wave) atWave.set(row.country_code, row.n_present)
  }
  // No rows at that wave anywhere = the item wasn't asked then; that is
  // "no coverage story", not "0% coverage".
  if (atWave.size === 0) return []
  return pairUp(y1, atWave)
}

/** Unweighted n per country from estimate rows (the largest cell —
 * proportions carry one row per level of the same people). */
function nByCountry(rows: EstimateRow[]): Map<number, number> {
  const byCountry = new Map<number, number>()
  for (const row of rows) {
    const code = Number(row.group['country_code'])
    if (!Number.isFinite(code)) continue
    const existing = byCountry.get(code) ?? 0
    if (row.n > existing) byCountry.set(code, row.n)
  }
  return byCountry
}

/** Coverage for outcomes without missingness rows (derived scores):
 * who has a value at this wave, against the same query at Wave 1. */
export function coverageFromEstimates(
  currentRows: EstimateRow[],
  baselineRows: EstimateRow[],
): CountryCoverage[] {
  const atWave = nByCountry(currentRows)
  if (atWave.size === 0) return []
  return pairUp(nByCountry(baselineRows), atWave)
}

function pairUp(y1: Map<number, number>, atWave: Map<number, number>): CountryCoverage[] {
  const codes = [...new Set([...y1.keys(), ...atWave.keys()])].sort((a, b) => a - b)
  return codes
    .map((code) => {
      const presentAtY1 = y1.get(code) ?? 0
      const presentAtWave = atWave.get(code) ?? 0
      return {
        country_code: code,
        presentAtWave,
        presentAtY1,
        fraction: presentAtY1 > 0 ? presentAtWave / presentAtY1 : null,
      }
    })
    .filter((entry) => entry.presentAtY1 > 0 || entry.presentAtWave > 0)
}

export interface CoverageSummary {
  countries: CountryCoverage[]
  lowest: CountryCoverage | null
  highest: CountryCoverage | null
}

export function summarize(countries: CountryCoverage[]): CoverageSummary {
  const comparable = countries.filter((entry) => entry.fraction !== null)
  comparable.sort((a, b) => (a.fraction ?? 0) - (b.fraction ?? 0))
  return {
    countries,
    lowest: comparable[0] ?? null,
    highest: comparable[comparable.length - 1] ?? null,
  }
}

export function summarizeCoverage(rows: MissingnessRow[], wave: 'MY' | 'Y2'): CoverageSummary {
  return summarize(coverageByCountry(rows, wave))
}
