// Change (Phase 5): how the same people answered later. One /v1/change
// request answers the page — for a numeric measure the mean within-person
// change per country with its CI (dots on a change axis with zero
// marked, on values aligned so a rise means more of what the measure
// names — ADR-0015) and the histogram of individual change for chosen
// countries; for a categorical item the change in the share answering a
// chosen level, in percentage points (the overall change alone — no
// matrix of moves between answers, ADR-0027). Every number is the server's; this view chooses, filters,
// orders and renders. Retention is for the
// maths (owner decision 2): the longitudinal weights carry it, and the
// interval and the n show it — nothing on the page says more.

import { getRouteApi } from '@tanstack/react-router'
import { useMemo } from 'react'
import {
  changeDistributionRows,
  changeRows,
  changeShareRows,
  legsPresent,
  useChange,
} from '../api/change'
import { NetworkError } from '../api/errors'
import { useBootStatus, useMeta } from '../api/meta'
import type { EstimateRow, VariableSummary, Wave } from '../api/types'
import { useVariable, useVariables } from '../api/variables'
import { useWarmApi } from '../api/warm'
import { ChangeDots, changeBounds } from '../charts/ChangeDots'
import { ChartFigure, type CsvExport } from '../charts/ChartFigure'
import { Histogram } from '../charts/Histogram'
import { summarizeExtremes } from '../charts/summary'
import { outcomeColor } from '../charts/theme'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingBlock } from '../components/Loading'
import { InvalidParamsNotice } from '../components/Notice'
import { OfflineLine } from '../components/StillWorks'
import { WordingPanel } from '../components/WordingPanel'
import { CountryFilter } from '../components/controls/CountryFilter'
import { QuestionPicker } from '../components/controls/QuestionPicker'
import { RadioRow, type RadioOption } from '../components/controls/RadioRow'
import { downloadTextFile, responseToCsv } from '../export/csv'
import { exportFilename, type ExportName } from '../export/filename'
import { defaultLevel, outcomeLevels } from '../labels'
import { DEFAULT_DIR, VALUE_ORDER } from '../sortRows'
import { searchNavigation } from '../state/navigate'
import { changeRequest, changeSearchParams, type ChangeSearch } from '../state/search'
import { NARROW_VIEWPORT, useMediaQuery } from '../useMediaQuery'
import { WAVE_MOMENTS, WAVE_NAMES, WAVE_TITLES, pairTitle } from '../waves'
import { changeLevels, orderChangeRows, shareRiseIsBetter, signedLevel } from './changeOrder'
import styles from './AtlasView.module.css'

const route = getRouteApi('/change')

/** The comparisons the API serves, in the order the control offers them. */
const PAIRS: readonly { from: Wave; to: Wave; via?: 'MY' }[] = [
  { from: 'Y1', to: 'Y2' },
  { from: 'Y1', to: 'MY' },
  { from: 'MY', to: 'Y2' },
  { from: 'Y1', to: 'Y2', via: 'MY' },
]

type Pair = (typeof PAIRS)[number]

const pairKey = (pair: Pair) => `${pair.from}-${pair.via ?? ''}-${pair.to}`

/** Whether a measure asked at `waves` can make this comparison. */
const pairSupported = (pair: Pair, waves: readonly string[]) =>
  [pair.from, pair.via, pair.to].every((wave) => wave === undefined || waves.includes(wave))

export function ChangeView() {
  useWarmApi()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const meta = useMeta()
  const boot = useBootStatus()
  const variables = useVariables()
  const variable = variables.data?.byName[search.outcome]
  const chartable = variable !== undefined && variable.servable
  const askedTwice = chartable && variable.waves_available.length >= 2
  // Only the comparisons at least one servable measure can make are
  // offered (today: 2023 → 2024 alone — the midyear survey asked
  // different questions); more reappear by themselves if the data
  // changes. The picker lists every question; one that can make none of
  // them stays in view, disabled, with the reason.
  const allVariables = variables.data?.list
  const supportedPairs = useMemo(
    () =>
      PAIRS.filter((pair) =>
        (allVariables ?? []).some(
          (candidate) => candidate.servable && pairSupported(pair, candidate.waves_available),
        ),
      ),
    [allVariables],
  )
  // Why a question can't be compared here (the picker lists it all the
  // same, the reason in words): asked once, or never at both waves of a
  // comparison the page makes.
  const changeReason = (candidate: VariableSummary): string | undefined => {
    if (supportedPairs.some((pair) => pairSupported(pair, candidate.waves_available)))
      return undefined
    const [only] = candidate.waves_available
    return candidate.waves_available.length === 1 && only !== undefined
      ? `Asked only in ${WAVE_NAMES[only] ?? only}`
      : 'Not asked in both years'
  }
  // A categorical item (the server's default stat is a share) changes
  // in the share answering a level; a numeric one in its mean.
  const isCategorical = chartable && variable.default_stat === 'proportion'
  const detailQuery = useVariable(chartable ? search.outcome : null)
  const detail = detailQuery.data?.detail
  const narrow = useMediaQuery(NARROW_VIEWPORT)
  const dir = search.dir ?? DEFAULT_DIR
  const pair = pairTitle(search.from, search.to, search.via)

  const setSearch = (patch: Partial<ChangeSearch>) => {
    void navigate(searchNavigation(changeSearchParams({ ...search, ...patch })))
  }

  const request = askedTwice ? changeRequest(search) : null
  const change = useChange(request)
  const response = change.data
  const metaData = meta.data?.meta
  const legs = useMemo(
    () => (search.via && response ? legsPresent(response.rows) : undefined),
    [search.via, response],
  )
  const levels = useMemo(() => outcomeLevels(detail), [detail])
  // Atlas's default level, from the one shared rule.
  const activeLevel = search.level ?? defaultLevel(detail)
  const activeLevelLabel = levels.find((entry) => entry.value === activeLevel)?.label
  const display = useMemo(() => {
    if (!response || !metaData) return { rows: [] as EstimateRow[], countryDomain: [] as string[] }
    return orderChangeRows(
      isCategorical ? changeShareRows(response.rows, activeLevel) : changeRows(response.rows),
      metaData,
      dir,
      search.countries,
      legs,
    )
  }, [response, metaData, isCategorical, activeLevel, dir, search.countries, legs])
  const chosen = search.countries.slice(0, 4)
  const distribution = useMemo(
    () =>
      response
        ? changeDistributionRows(response.rows).filter((row) =>
            chosen.includes(Number(row.group['country_code'])),
          )
        : [],
    [response, chosen],
  )
  const hasDistribution = response ? changeDistributionRows(response.rows).length > 0 : false
  if (meta.isPending || variables.isPending) {
    return (
      <section>
        <h2>Change</h2>
        <LoadingBlock height={420} label="Loading the Change view" />
      </section>
    )
  }
  if (meta.isError || variables.isError || !meta.data || !variables.data) {
    return (
      <section>
        <h2>Change</h2>
        <ErrorState apiReachable={boot.apiReachable} error={meta.error ?? variables.error} />
      </section>
    )
  }

  const handlePick = ({ outcome }: { outcome: string }) => {
    const target = variables.data.byName[outcome]
    const waves = target?.waves_available ?? []
    // Keep the comparison when the new measure supports it; otherwise
    // the first pair it does support (2023 → 2024 first).
    const keep = [search.from, search.via, search.to].every(
      (wave) => wave === undefined || waves.includes(wave),
    )
    const fallback = supportedPairs.find((candidate) => pairSupported(candidate, waves))
    setSearch({
      outcome,
      topic: undefined,
      from: keep ? search.from : (fallback?.from ?? search.from),
      to: keep ? search.to : (fallback?.to ?? search.to),
      via: keep ? search.via : fallback?.via,
      level: undefined,
      invalid: undefined,
      invalidRaw: undefined,
    })
  }

  const missingOf = (candidate: Pair): Wave[] =>
    [candidate.from, candidate.via, candidate.to].filter(
      (wave): wave is Wave =>
        wave !== undefined && !(variable?.waves_available ?? []).includes(wave),
    )
  const pairOptions: RadioOption<string>[] = supportedPairs.map((candidate) => ({
    value: pairKey(candidate),
    label: pairTitle(candidate.from, candidate.to, candidate.via),
    disabled: missingOf(candidate).length > 0,
  }))
  // Why the unavailable comparisons can't be chosen, in view (F6): those
  // missing the same survey named together — "2023 → Midyear and
  // Midyear → 2024 — not asked in the midyear survey".
  const byMissing = new Map<string, string[]>()
  for (const candidate of supportedPairs) {
    const missing = missingOf(candidate)
    if (missing.length === 0) continue
    const key = missing.map((wave) => WAVE_NAMES[wave] ?? wave).join(' or ')
    byMissing.set(key, [
      ...(byMissing.get(key) ?? []),
      pairTitle(candidate.from, candidate.to, candidate.via),
    ])
  }
  const pairNote = [...byMissing]
    .map(([missing, labels]) => {
      const last = labels.pop()
      const named = labels.length > 0 ? `${labels.join(', ')} and ${last}` : last
      return `${named} — not asked in ${missing}`
    })
    .join('; ')

  const title = variable?.display_name ?? search.outcome
  // A numeric change is taken on values aligned to the label (a rise =
  // more of what the measure names), so whether a rise is better follows
  // from the server's direction and polarity together: better when the
  // better end and the "more" end of the coded scale coincide. A share
  // is never re-coded: its rise is better or worse only when the chosen
  // answer is the better or the worse end of a directional item.
  const riseIsBetter =
    variable === undefined || variable.direction === 'none'
      ? undefined
      : isCategorical
        ? shareRiseIsBetter(variable, activeLevel)
        : (variable.direction === 'higher_better') === (variable.polarity === 'ascending')
  const directionNote =
    riseIsBetter === undefined ? '' : riseIsBetter ? 'a rise is better' : 'a rise is worse'
  const range =
    variable && variable.min !== null && variable.max !== null
      ? ` on the ${variable.min}–${variable.max} scale`
      : ''
  const subtitle = isCategorical
    ? [
        `Change in share answering “${activeLevelLabel ?? activeLevel ?? '…'}”, percentage points`,
        directionNote,
        pair,
      ]
        .filter(Boolean)
        .join(' · ')
    : [
        `Mean change${range}, among the same people${directionNote ? ` · ${directionNote}` : ''}`,
        pair,
      ].join(' · ')
  const color = variable ? outcomeColor(variable.name) : 'var(--series-1)'
  // What a download is called, in words (ADR-0016): the measure, the
  // figure ("Change", "Change distribution", "Transitions") and the
  // waves compared ("2023 to 2024").
  const nameFor = (view: string): ExportName => ({
    measure: title,
    view,
    waves: [search.from, search.via, search.to]
      .filter((wave): wave is NonNullable<typeof wave> => wave !== undefined)
      .map((wave) => WAVE_MOMENTS[wave])
      .join(' to '),
  })
  const csvFor = (rows: EstimateRow[], name: ExportName): CsvExport | undefined =>
    response
      ? {
          kind: 'client',
          onDownload: () =>
            downloadTextFile(exportFilename(name, 'csv'), responseToCsv({ ...response, rows })),
        }
      : undefined
  // The lede's years come from the supported pair, never from literals:
  // if the only pair ever changes, the lede follows.
  const ledePair = supportedPairs[0] ?? { from: search.from, to: search.to }
  const ledeYears = `${WAVE_MOMENTS[ledePair.from]} to ${WAVE_MOMENTS[ledePair.to]}`

  const displayOptions = (
    <>
      <RadioRow
        legend="Order"
        name="dir"
        options={VALUE_ORDER}
        value={dir}
        onChange={(value) => setSearch({ dir: value })}
      />
      <CountryFilter
        countries={meta.data.meta.countries}
        selected={search.countries}
        onChange={(countries) => setSearch({ countries })}
      />
    </>
  )

  return (
    <section>
      <h2 className="visually-hidden">Change</h2>
      <p className={styles.deck}>
        <span className={styles.deckLong}>
          How the same people&rsquo;s answers changed from {ledeYears}, country by country, among
          those who answered both years.
        </span>
        <span className={styles.deckShort}>
          How the same people&rsquo;s answers changed from {ledeYears}.
        </span>
      </p>
      <InvalidParamsNotice
        invalid={search.invalid}
        onDismiss={() =>
          void navigate(
            searchNavigation(
              changeSearchParams({ ...search, invalid: undefined, invalidRaw: undefined }),
              { replace: true },
            ),
          )
        }
      />
      <div className={styles.controls}>
        <QuestionPicker
          variant="field"
          label="Question"
          variables={variables.data.list}
          wave={search.from}
          value={search.outcome}
          topic={search.topic}
          unavailable={changeReason}
          countable={(candidate) => changeReason(candidate) === undefined}
          onPick={(outcome) => handlePick({ outcome })}
        />
        {supportedPairs.length > 1 && (
          <RadioRow
            legend="Compare"
            name="pair"
            wide
            selectOnNarrow
            options={pairOptions}
            note={pairNote ? `${pairNote}.` : undefined}
            value={pairKey(search)}
            onChange={(value) => {
              const candidate = supportedPairs.find((entry) => pairKey(entry) === value)
              if (candidate)
                setSearch({ from: candidate.from, to: candidate.to, via: candidate.via })
            }}
          />
        )}
        {isCategorical && levels.length > 0 && (
          <RadioRow
            legend="Showing % who said"
            name="level"
            wide
            selectOnNarrow
            options={levels.map((entry) => ({ value: String(entry.value), label: entry.label }))}
            value={String(activeLevel)}
            onChange={(value) => setSearch({ level: Number(value) })}
          />
        )}
        {narrow ? (
          <details className={styles.moreOptions}>
            <summary>More options — order, countries</summary>
            <div className={styles.moreBody}>{displayOptions}</div>
          </details>
        ) : (
          displayOptions
        )}
      </div>

      {!chartable ? (
        <EmptyState title="Choose a measure to begin">
          <p>
            {variable === undefined
              ? `The link asked for “${search.outcome}”, which isn't in this release's codebook — `
              : `“${search.outcome}” can't be charted (its codebook entry says why) — `}
            pick a topic and measure above, or search all the measures.
          </p>
        </EmptyState>
      ) : !askedTwice ? (
        <EmptyState title="Asked only once">
          <p>
            {title} was asked in{' '}
            {WAVE_TITLES[variable.waves_available[0] ?? ''] ?? variable.waves_available[0]} only, so
            there is no later answer from the same people to compare. Pick another measure.
          </p>
        </EmptyState>
      ) : change.isPending ? (
        <LoadingBlock height={420} label="Loading estimates" />
      ) : change.isError ? (
        change.error instanceof NetworkError && !boot.apiReachable ? (
          <OfflineLine className={styles.hint} />
        ) : (
          <ErrorState apiReachable={boot.apiReachable} error={change.error} />
        )
      ) : response ? (
        <>
          <p role="status" className="visually-hidden">
            Updated: {title}, {display.countryDomain.length} countries shown.
          </p>
          <ChartFigure
            title={title}
            subtitle={subtitle}
            ariaLabel={summarizeExtremes(
              legs ? display.rows.filter((row) => row.leg === 'y1_y2') : display.rows,
              meta.data.meta,
              isCategorical
                ? `${title}: change in the share of the same people answering “${activeLevelLabel ?? activeLevel}”, ${pair}, by country, in percentage points.`
                : `${title}: mean change among the same people, ${pair}, by country.`,
            )}
            intro={
              detail && (
                <div className={styles.wording}>
                  <WordingPanel detail={detail} />
                </div>
              )
            }
            csv={csvFor(display.rows, nameFor('Change'))}
            exportName={nameFor('Change')}
            isRefreshing={change.isPlaceholderData}
          >
            <ChangeDots
              rows={display.rows}
              meta={meta.data.meta}
              color={color}
              countryDomain={display.countryDomain}
              legs={legs}
              bounds={changeBounds(variable, isCategorical)}
            />
          </ChartFigure>

          {hasDistribution &&
            (chosen.length === 0 ? null : (
              <ChartFigure
                title="How individual answers moved"
                subtitle={`Share of people by the change in their own answer · ${pair}`}
                ariaLabel={`${title}: the share of people at each change in their own answer, ${pair}, for ${display.countryDomain.length ? chosen.length : 0} countries.`}
                csv={csvFor(distribution, nameFor('Change distribution'))}
                exportName={nameFor('Change distribution')}
                isRefreshing={change.isPlaceholderData}
              >
                <Histogram
                  rows={distribution}
                  meta={meta.data.meta}
                  responseMeta={response.meta}
                  variable={variable}
                  color={color}
                  levels={changeLevels(variable)}
                  xLabel="Change in the answer (later minus earlier)"
                  levelLabel={signedLevel}
                />
                {search.countries.length > 4 && (
                  <p className={styles.hint}>Showing the first four selected countries.</p>
                )}
              </ChartFigure>
            ))}
        </>
      ) : null}
    </section>
  )
}
