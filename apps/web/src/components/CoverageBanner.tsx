// Wave 2 / midyear response coverage, shown wherever those waves appear
// (proposal §3.4: retention runs from 90% in China to 23% in Hong Kong —
// no post-Wave-1 number is honest without it). Data comes from the
// variable's missingness rows; country names from meta.

import type { Country, MissingnessRow } from '../api/types'
import { summarizeCoverage } from '../coverage'
import { formatCount, formatPercent } from '../format'
import styles from './CoverageBanner.module.css'

const WAVE_NOUN: Record<'MY' | 'Y2', string> = {
  Y2: 'Wave 2',
  MY: 'the midyear survey',
}

export function CoverageBanner({
  wave,
  missingness,
  countries,
}: {
  wave: 'MY' | 'Y2'
  missingness: MissingnessRow[]
  countries: Country[]
}) {
  const summary = summarizeCoverage(missingness, wave)
  if (summary.lowest === null || summary.highest === null) return null
  const names = new Map(countries.map((country) => [country.code, country.name]))
  const name = (code: number) => names.get(code) ?? `country ${code}`
  return (
    <aside className={styles.banner}>
      <p className={styles.lead}>
        Coverage varies: of this item&rsquo;s Wave&nbsp;1 respondents, {WAVE_NOUN[wave]} reached{' '}
        <strong>{formatPercent(summary.lowest.fraction ?? 0)}</strong> in{' '}
        {name(summary.lowest.country_code)} and{' '}
        <strong>{formatPercent(summary.highest.fraction ?? 0)}</strong> in{' '}
        {name(summary.highest.country_code)}. Estimates use the calibrated weights, but low coverage
        still deserves caution.
      </p>
      <details>
        <summary>Coverage by country</summary>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Country</th>
              <th scope="col">Answered at {wave === 'Y2' ? 'Wave 2' : 'midyear'}</th>
              <th scope="col">Of Wave 1</th>
            </tr>
          </thead>
          <tbody>
            {summary.countries.map((entry) => (
              <tr key={entry.country_code}>
                <th scope="row">{name(entry.country_code)}</th>
                <td>{formatCount(entry.presentAtWave)}</td>
                <td>{entry.fraction === null ? '—' : formatPercent(entry.fraction)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </aside>
  )
}
