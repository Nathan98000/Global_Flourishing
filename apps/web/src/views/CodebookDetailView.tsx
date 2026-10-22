// One variable, for a lay reader first (G7): its wording, its answers in
// words, the years it was asked and how many people answered; then, in a
// "For the technically minded" fold as Methods does it (ADR-0021), the
// scale type, the full value-label table with its codes (country-specific
// labels included) and how many answered in each country and year.
// "Chart this" lands on the Atlas with the right outcome and wave already
// in the URL. Non-servable variables say plainly why they cannot be
// charted yet.

import { Link, getRouteApi } from '@tanstack/react-router'
import { useMeta } from '../api/meta'
import type { MissingnessRow, ValueLabel, VariableDetail } from '../api/types'
import { useVariable } from '../api/variables'
import { ErrorState } from '../components/ErrorState'
import { Skeleton } from '../components/Skeleton'
import { formatCount, formatPercent } from '../format'
import { WAVE_CHIPS, WAVE_NAMES } from '../waves'
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
    // Scrolls sideways inside its own box where a label is too long for a
    // phone (words joined by slashes have nowhere to break); the page
    // never does.
    <div className={styles.tableScroll}>
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
    </div>
  )
}

/** "2023, the midyear survey and 2024" — a list in words. */
function inWords(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`
}

/** A question's answers in words, from its served labels (G7): a scale
 * by its two ends — "From 0 (Not at all satisfied with your life) to 10
 * (Completely satisfied with your life)" — else every answer, in code
 * order. Non-answers ("Don't know", "Refused") and country-specific
 * labels are left to the fold. */
export function answersInWords(
  detail: Pick<VariableDetail, 'min' | 'max'>,
  labels: readonly ValueLabel[],
): { kind: 'range'; text: string } | { kind: 'list'; answers: string[] } | null {
  const answers = labels.filter(
    (label) => !label.is_nonresponse && label.country_code === null && label.label,
  )
  if (answers.length === 0) return null
  // A question with no range of its own (a score's component) is a scale
  // when only its two ends are labelled.
  const ends = answers.length === 2 ? answers.map((label) => label.code) : []
  const min = detail.min ?? (ends.length === 2 ? Math.min(...ends) : null)
  const max = detail.max ?? (ends.length === 2 ? Math.max(...ends) : null)
  const labelAt = (code: number) => answers.find((label) => label.code === code)?.label
  if (min !== null && max !== null && max - min + 1 > answers.length) {
    const low = labelAt(min)
    const high = labelAt(max)
    const end = (code: number, label: string | undefined) =>
      label ? `${code} (${label})` : `${code}`
    return { kind: 'range', text: `From ${end(min, low)} to ${end(max, high)}.` }
  }
  const seen = new Set<string>()
  const list: string[] = []
  for (const label of [...answers].sort((a, b) => a.code - b.code)) {
    if (seen.has(label.label)) continue
    seen.add(label.label)
    list.push(label.label)
  }
  return { kind: 'list', answers: list }
}

/** How many people answered, year by year, in words: "Answered by 207,206
 * people in 2023 and 128,440 in 2024." */
export function answeredInWords(missingness: readonly MissingnessRow[]): string | null {
  const byWave = new Map<string, number>()
  for (const row of missingness) byWave.set(row.wave, (byWave.get(row.wave) ?? 0) + row.n_valid)
  const parts = [...byWave].map(
    ([wave, count], index) =>
      `${formatCount(count)}${index === 0 ? ' people' : ''} in ${WAVE_NAMES[wave] ?? wave}`,
  )
  return parts.length > 0 ? `Answered by ${inWords(parts)}.` : null
}

/** The answers, in words. */
function Answers({
  detail,
  labels,
}: {
  detail: Pick<VariableDetail, 'min' | 'max'>
  labels: ValueLabel[]
}) {
  const answers = answersInWords(detail, labels)
  const ownLabels = labels.some((label) => label.country_code !== null)
  if (!answers && !ownLabels) return null
  return (
    <div className={styles.answers}>
      {answers?.kind === 'range' && <p>{answers.text}</p>}
      {answers?.kind === 'list' && (
        <ul>
          {answers.answers.map((answer) => (
            <li key={answer}>{answer}</li>
          ))}
        </ul>
      )}
      {ownLabels && (
        <p className={styles.facts}>
          Some countries have answers of their own — they are listed under &ldquo;For the
          technically minded&rdquo;.
        </p>
      )}
    </div>
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
  const answered = answeredInWords(detail.missingness)
  // The fold's countries A–Z: a list to read, not a chart (ADR-0029).
  const answeringCountries = countries
    .filter((country) => detail.missingness.some((row) => row.country_code === country.code))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <section className={styles.detail}>
      <p className={styles.breadcrumb}>
        <Link to="/codebook">← Codebook</Link>
      </p>
      <h2>
        {detail.display_name} <span className={styles.code}>{detail.name}</span>
      </h2>
      <p className={styles.facts}>
        {topicName(detail.family)} · asked in{' '}
        {inWords(detail.waves_available.map((wave) => WAVE_NAMES[wave] ?? wave))}
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

      {!detail.is_derived && labels.length > 0 && (
        <>
          <h3>The answers</h3>
          <Answers detail={detail} labels={labels} />
        </>
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
                    <Link to="/codebook/$name" params={{ name: component.name }}>
                      {component.display_name}
                    </Link>
                  </h4>
                  {component.wording ? (
                    <blockquote className={styles.wording}>{component.wording}</blockquote>
                  ) : (
                    <p className={styles.whyNot}>No wording recorded for this item.</p>
                  )}
                  <Answers detail={{ min: null, max: null }} labels={component.value_labels} />
                </section>
              ))}
            </>
          )}
        </>
      )}

      {answered && <p>{answered}</p>}

      <details className={styles.fold}>
        <summary>For the technically minded</summary>
        <p className={styles.facts}>
          Variable <span className={styles.code}>{detail.name}</span> · scale type{' '}
          {detail.scale_type}
          {detail.min !== null && detail.max !== null && ` (${detail.min}–${detail.max})`}
        </p>
        {labels.length > 0 && (
          <>
            <h3>Value labels</h3>
            <ValueLabelTable labels={labels} countryName={countryName} />
          </>
        )}
        {detail.is_derived &&
          detail.components.map(
            (component) =>
              component.value_labels.length > 0 && (
                <section key={component.name}>
                  <h3>
                    {component.display_name} <span className={styles.code}>{component.name}</span>
                  </h3>
                  <ValueLabelTable labels={component.value_labels} countryName={countryName} />
                </section>
              ),
          )}
        {detail.missingness.length > 0 && (
          <>
            <h3>Answered, by country and year</h3>
            <p className={styles.facts}>
              People asked the question, and — where some gave no answer (skipped, didn&rsquo;t
              know, refused) — the share who answered.
            </p>
            <div className={styles.tableScroll}>
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
                  {answeringCountries.map((country) => (
                    <tr key={country.code}>
                      <th scope="row">{country.name}</th>
                      {waves.map((wave) => {
                        const cell = detail.missingness.find(
                          (row) => row.country_code === country.code && row.wave === wave,
                        )
                        return (
                          <td key={wave} className={styles.num}>
                            {cell
                              ? `${formatCount(cell.n_present)}${
                                  cell.n_present > 0 && cell.n_valid < cell.n_present
                                    ? ` (${formatPercent(cell.n_valid / cell.n_present)} answered)`
                                    : ''
                                }`
                              : '—'}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </details>
    </section>
  )
}
