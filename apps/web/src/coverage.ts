// Response coverage per country for a wave, from a variable's missingness
// rows (proposal §3.4: no Wave-2 or midyear number is honest without it —
// retention runs from 90% in China to 23% in Hong Kong).

import type { MissingnessRow } from './api/types'

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

export function summarizeCoverage(rows: MissingnessRow[], wave: 'MY' | 'Y2'): CoverageSummary {
  const countries = coverageByCountry(rows, wave)
  const comparable = countries.filter((entry) => entry.fraction !== null)
  comparable.sort((a, b) => (a.fraction ?? 0) - (b.fraction ?? 0))
  return {
    countries,
    lowest: comparable[0] ?? null,
    highest: comparable[comparable.length - 1] ?? null,
  }
}
