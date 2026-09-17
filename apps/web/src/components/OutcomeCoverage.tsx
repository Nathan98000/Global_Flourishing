// The one place a Y2/MY view gets its coverage story (F3). Items carry
// missingness rows in their catalog detail — static tier first, so the
// banner works with the API down. Derived scores ship no missingness
// rows, so their coverage comes from the wave's own by-country estimates
// against the same query at Wave 1 — two files the static tier also
// serves. Either way the banner renders, or this view is not honest.

import type { Stat, VariableDetail, VariableSummary, Wave } from '../api/types'
import { useEstimates } from '../api/estimates'
import type { Country } from '../api/types'
import { coverageByCountry, coverageFromEstimates, summarize } from '../coverage'
import { CoverageBanner } from './CoverageBanner'

export function OutcomeCoverage({
  wave,
  variable,
  detail,
  countries,
}: {
  wave: 'MY' | 'Y2'
  variable: VariableSummary
  detail: VariableDetail
  countries: Country[]
}) {
  const fromMissingness = coverageByCountry(detail.missingness, wave)
  const needsEstimates = fromMissingness.length === 0
  const baselineWave: Wave = 'Y1'
  const request = (at: Wave) => ({
    outcome: variable.name,
    wave: at,
    stat: variable.default_stat as Stat,
    by: ['country_code'] as const,
  })
  const atWave = useEstimates(needsEstimates ? request(wave) : null)
  const baseline = useEstimates(
    needsEstimates && variable.waves_available.includes(baselineWave)
      ? request(baselineWave)
      : null,
  )

  const coverage = needsEstimates
    ? coverageFromEstimates(atWave.data?.response.rows ?? [], baseline.data?.response.rows ?? [])
    : fromMissingness
  return <CoverageBanner wave={wave} summary={summarize(coverage)} countries={countries} />
}
