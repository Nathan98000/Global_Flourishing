// One variable, in full: exact wording, the complete value-label table
// (country-specific labels included), scale and direction, waves, and
// missingness by country × wave. "Chart this" lands on the Atlas with
// the right outcome and wave already in the URL. Non-servable variables
// appear here and say plainly why they cannot be charted yet.

import { Link, getRouteApi } from '@tanstack/react-router'
import { useMeta } from '../api/meta'
import type { ValueLabel, VariableDetail } from '../api/types'
import { useVariable } from '../api/variables'
import { ErrorState } from '../components/ErrorState'
import { Skeleton } from '../components/Skeleton'
import { formatCount, formatPercent } from '../format'
import { WAVE_CHIPS } from '../waves'
import { directionPhrase } from '../labels'
import { topicName } from '../topics'
import styles from './CodebookDetailView.module.css'

const route = getRouteApi('/codebook/$name')

function ValueLabelTable({
  labels,
  countryName,
}: {
  labels: ValueLabel[]
  countryName: (code: number | null) => string
}) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Code</th>
          <th scope="col">Label</th>
          <th scope="col">Applies to</th>
          <th scope="col">Non-response</th>
        </tr>
      </thead>
      <tbody>
        {labels.map((label, index) => (
          <tr key={index}>
            <td className={styles.num}>{label.code}</td>
            <td>{label.label}</td>
            <td>
              {countryName(label.country_code)}
              {label.wave ? `, ${WAVE_CHIPS[label.wave] ?? label.wave}` : ''}
            </td>
            <td>{label.is_nonresponse ? 'yes' : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function whyNotChartable(detail: VariableDetail): string {
  if (detail.servable) return ''
  if (detail.is_country_specific) {
    return (
      'Country-specific: its codes and labels differ per country, so a ' +
      'cross-country chart would compare different questions. It stays ' +
      'searchable here until a per-country view ships.'
    )
  }
  return (
    `Scale type “${detail.scale_type}” is bookkeeping or free-form, ` +
    'not an aggregatable survey answer.'
  )
}

export function CodebookDetailView() {
  const { name } = route.useParams()
  const meta = useMeta()
  const detailQuery = useVariable(name)

  if (meta.isPending || detailQuery.isPending) {
    return (
      <section>
        <h2>{name}</h2>
        <Skeleton height={360} label="Loading the variable" />
      </section>
    )
  }
  if (detailQuery.isError || meta.isError || !meta.data) {
    return (
      <section>
        <h2>{name}</h2>
        <ErrorState error={detailQuery.error ?? meta.error} />
      </section>
    )
  }

  const detail = detailQuery.data.detail
  const labels = detail.value_labels
  const countries = meta.data.meta.countries
  const countryName = (code: number | null) =>
    code === null ? 'all countries' : (countries.find((c) => c.code === code)?.name ?? `#${code}`)
  const waves = [...new Set(detail.missingness.map((row) => row.wave))]

  return (
    <section className={styles.detail}>
      <p className={styles.breadcrumb}>
        <Link to="/codebook">← Codebook</Link>
      </p>
      <h2>
        {detail.display_name} <span className={styles.code}>{detail.name}</span>
      </h2>
      <p className={styles.facts}>
        {topicName(detail.family)} · {detail.scale_type}
        {detail.min !== null && detail.max !== null && ` (${detail.min}–${detail.max})`} ·{' '}
        {directionPhrase(detail.direction)} · asked:{' '}
        {detail.waves_available.map((wave) => WAVE_CHIPS[wave] ?? wave).join(', ')}
      </p>

      {detail.servable ? (
        <p>
          <Link
            className={styles.chartThis}
            to="/"
            search={{ outcome: detail.name, wave: detail.waves_available[0] ?? 'Y1' } as never}
          >
            Chart this →
          </Link>
        </p>
      ) : (
        <p className={styles.whyNot}>{whyNotChartable(detail)}</p>
      )}

      {detail.wording ? (
        <blockquote className={styles.wording}>{detail.wording}</blockquote>
      ) : detail.is_derived ? null : (
        <p className={styles.whyNot}>No wording recorded for this item.</p>
      )}

      {detail.is_derived && (
        <>
          <h3>How it is scored</h3>
          <p>{detail.scoring ?? detail.label ?? 'Computed by the pipeline.'}</p>
          {detail.components.length > 0 && (
            <>
              <h3>The questions behind it</h3>
              {detail.components.map((component) => (
                <section key={component.name} className={styles.component}>
                  <h4 className={styles.componentTitle}>
                    {component.display_name} <span className={styles.code}>{component.name}</span>
                  </h4>
                  {component.wording ? (
                    <blockquote className={styles.wording}>{component.wording}</blockquote>
                  ) : (
                    <p className={styles.whyNot}>No wording recorded for this item.</p>
                  )}
                  {component.value_labels.length > 0 && (
                    <ValueLabelTable labels={component.value_labels} countryName={countryName} />
                  )}
                </section>
              ))}
            </>
          )}
        </>
      )}

      {labels.length > 0 && (
        <>
          <h3>Value labels</h3>
          <ValueLabelTable labels={labels} countryName={countryName} />
        </>
      )}

      {detail.missingness.length > 0 && (
        <>
          <h3>Answered, by country and wave</h3>
          <p className={styles.facts}>
            n present (share of that country&rsquo;s wave sample with a valid answer).
          </p>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Country</th>
                {waves.map((wave) => (
                  <th key={wave} scope="col">
                    {WAVE_CHIPS[wave] ?? wave}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {countries
                .filter((country) =>
                  detail.missingness.some((row) => row.country_code === country.code),
                )
                .map((country) => (
                  <tr key={country.code}>
                    <th scope="row">{country.name}</th>
                    {waves.map((wave) => {
                      const cell = detail.missingness.find(
                        (row) => row.country_code === country.code && row.wave === wave,
                      )
                      return (
                        <td key={wave} className={styles.num}>
                          {cell
                            ? `${formatCount(cell.n_present)} (${
                                cell.n_present > 0
                                  ? formatPercent(cell.n_valid / cell.n_present)
                                  : '—'
                              } valid)`
                            : '—'}
                        </td>
                      )
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}
