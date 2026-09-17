// Wave 2 / midyear response coverage, shown wherever those waves appear
// (proposal §3.4). Plain-language framing (F6): who came back, range
// named with countries, per-country table one click away, Methods link
// for why it matters. Country names from meta; every number served.

import { Link } from '@tanstack/react-router'
import type { Country } from '../api/types'
import type { CoverageSummary } from '../coverage'
import { formatCount, formatPercent } from '../format'
import styles from './CoverageBanner.module.css'

const ROUND_NOUN: Record<'MY' | 'Y2', string> = {
  Y2: 'the 2024 round',
  MY: 'the midyear survey',
}

const WAVE_COLUMN: Record<'MY' | 'Y2', string> = {
  Y2: 'Wave 2',
  MY: 'midyear',
}

export function CoverageBanner({
  wave,
  summary,
  countries,
}: {
  wave: 'MY' | 'Y2'
  summary: CoverageSummary
  countries: Country[]
}) {
  if (summary.lowest === null || summary.highest === null) return null
  const names = new Map(countries.map((country) => [country.code, country.name]))
  const name = (code: number) => names.get(code) ?? `country ${code}`
  return (
    <aside className={styles.banner}>
      <p className={styles.lead}>
        <strong>Not everyone came back for {ROUND_NOUN[wave]}.</strong> Follow-up ranges from{' '}
        <strong>{formatPercent(summary.lowest.fraction ?? 0)}</strong> of the 2023 sample in{' '}
        {name(summary.lowest.country_code)} to{' '}
        <strong>{formatPercent(summary.highest.fraction ?? 0)}</strong> in{' '}
        {name(summary.highest.country_code)} — compare across countries with that in mind.{' '}
        <Link to="/methods">Why this matters</Link>
      </p>
      <details>
        <summary>Follow-up by country</summary>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Country</th>
              <th scope="col">Answered at {WAVE_COLUMN[wave]}</th>
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
