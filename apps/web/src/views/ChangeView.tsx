// Change (Phase 5): how the same people answered later. One /v1/change
// request answers the page — for a numeric measure the mean within-person
// change per country with its CI (dots on a change axis with zero
// marked, on values aligned so a rise means more of what the measure
// names — ADR-0015) and the histogram of individual change for chosen
// countries; for a categorical item the change in the share answering a
// chosen level, in percentage points, and where people moved between
// answers. Every number is the server's; this view chooses, filters,
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
  transitionRows,
  useChange,
} from '../api/change'
import { NetworkError } from '../api/errors'
import { useBootStatus, useMeta } from '../api/meta'
import type { EstimateResponse, EstimateRow, Wave } from '../api/types'
import { useVariable, useVariables } from '../api/variables'
import { useWarmApi } from '../api/warm'
import { ChangeDots, changeBounds } from '../charts/ChangeDots'
import { ChartFigure, type CsvExport } from '../charts/ChartFigure'
import { Histogram } from '../charts/Histogram'
import { summarizeExtremes } from '../charts/summary'
import { outcomeColor } from '../charts/theme'
import { TransitionTable } from '../charts/TransitionTable'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingBlock } from '../components/Loading'
import { InvalidParamsNotice } from '../components/Notice'
import { WordingPanel } from '../components/WordingPanel'
import { CountryFilter } from '../components/controls/CountryFilter'
import { OutcomePicker } from '../components/controls/OutcomePicker'
import { RadioRow, type RadioOption } from '../components/controls/RadioRow'
import { csvFilename, downloadTextFile, responseToCsv } from '../export/csv'
import { defaultLevel, groupValueLabel, outcomeLevels } from '../labels'
import { defaultDir } from '../sortRows'
import { searchNavigation } from '../state/navigate'
import { changeRequest, changeSearchParams, type ChangeSearch } from '../state/search'
import { NARROW_VIEWPORT, useMediaQuery } from '../useMediaQuery'
import { WAVE_TITLES, pairTitle } from '../waves'
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
  // changes. The picker lists only measures asked at both waves of one.
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
  const changeable = useMemo(
    () =>
      (allVariables ?? []).filter(
        (candidate) =>
          candidate.servable &&
          supportedPairs.some((pair) => pairSupported(pair, candidate.waves_available)),
      ),
    [allVariables, supportedPairs],
  )
  // A categorical item (the server's default stat is a share) changes
  // in the share answering a level; a numeric one in its mean.
  const isCategorical = chartable && variable.default_stat === 'proportion'
  const detailQuery = useVariable(chartable ? search.outcome : null)
  const detail = detailQuery.data?.detail
  const narrow = useMediaQuery(NARROW_VIEWPORT)
  const dir = search.dir ?? defaultDir(search.sort === 'change' ? 'estimate' : 'name')
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
      search.sort,
      dir,
      search.countries,
      legs,
    )
  }, [response, metaData, isCategorical, activeLevel, search.sort, dir, search.countries, legs])
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
  const transitions = useMemo(
    () =>
      response
        ? transitionRows(response.rows).filter((row) =>
            chosen.includes(Number(row.group['country_code'])),
          )
        : [],
    [response, chosen],
  )
  const hasTransitions = response ? transitionRows(response.rows).length > 0 : false
  const levelLabel = (level: number) => levels.find((entry) => entry.value === level)?.label
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

  const handlePick = ({ outcome, topic }: { outcome?: string; topic?: string }) => {
    if (outcome === undefined) {
      setSearch({ topic })
      return
    }
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

  const pairOptions: RadioOption<string>[] = supportedPairs.map((candidate) => {
    const missing = [candidate.from, candidate.via, candidate.to].filter(
      (wave): wave is Wave =>
        wave !== undefined && !(variable?.waves_available ?? []).includes(wave),
    )
    return {
      value: pairKey(candidate),
      label: pairTitle(candidate.from, candidate.to, candidate.via),
      disabled: missing.length > 0,
      title:
        missing.length > 0
          ? `Not asked in ${missing.map((wave) => WAVE_TITLES[wave] ?? wave).join(' or ')}`
          : undefined,
    }
  })

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
        `Average change${range}, among the same people${directionNote ? ` · ${directionNote}` : ''}`,
        pair,
      ].join(' · ')
  const color = variable ? outcomeColor(variable.name) : 'var(--series-1)'
  const version = response?.meta.data_version ?? null
  const csvFor = (rows: EstimateRow[], stat: string): CsvExport | undefined =>
    response
      ? {
          kind: 'client',
          onDownload: () =>
            downloadTextFile(
              csvFilename(search.outcome, `${search.from}-${search.to}`, stat, version),
              responseToCsv({ ...response, rows }),
            ),
        }
      : undefined
  const withRows = (rows: EstimateRow[]): EstimateResponse =>
    response ? { ...response, rows } : { meta: meta.data.meta as never, rows }

  const displayOptions = (
    <>
      <RadioRow
        legend="Sort"
        name="sort"
        options={[
          { value: 'change', label: 'By change' },
          { value: 'name', label: 'A–Z' },
        ]}
        value={search.sort}
        onChange={(sort) => setSearch({ sort, dir: undefined })}
      />
      <RadioRow
        legend="Order"
        name="dir"
        options={
          search.sort === 'name'
            ? [
                { value: 'asc', label: 'A to Z' },
                { value: 'desc', label: 'Z to A' },
              ]
            : [
                { value: 'desc', label: 'High to low' },
                { value: 'asc', label: 'Low to high' },
              ]
        }
        value={dir}
        onChange={(value) => setSearch({ dir: value })}
      />
      <div className={styles.countryPrompt}>
        <CountryFilter
          countries={meta.data.meta.countries}
          selected={search.countries}
          onChange={(countries) => setSearch({ countries })}
        />
        <span className={styles.hint}>
          Pick up to four countries to see how individual answers moved.
        </span>
      </div>
    </>
  )

  return (
    <section>
      <h2 className="visually-hidden">Change</h2>
      <p className={styles.deck}>
        <span className={styles.deckLong}>
          How the same people answered a year later. Each number is the average change within one
          country&rsquo;s respondents who answered both times, with its margin of error.
        </span>
        <span className={styles.deckShort}>How the same people answered a year later.</span>
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
        <OutcomePicker
          variables={changeable}
          value={search.outcome}
          topic={search.topic}
          onSelect={handlePick}
          fields={narrow ? 'measure' : 'all'}
        />
        {supportedPairs.length > 1 ? (
          <RadioRow
            legend="Compare"
            name="pair"
            wide
            selectOnNarrow
            options={pairOptions}
            value={pairKey(search)}
            onChange={(value) => {
              const candidate = supportedPairs.find((entry) => pairKey(entry) === value)
              if (candidate)
                setSearch({ from: candidate.from, to: candidate.to, via: candidate.via })
            }}
          />
        ) : (
          <p className={styles.hint}>
            Comparing {pairTitle(search.from, search.to, search.via)}. The midyear survey asked
            different questions, so change is measured{' '}
            {supportedPairs[0]
              ? pairTitle(supportedPairs[0].from, supportedPairs[0].to, supportedPairs[0].via)
              : pair}
            .
          </p>
        )}
        {isCategorical && levels.length > 0 && (
          <RadioRow
            legend="Answer level"
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
            <summary>More options — sort, countries</summary>
            <div className={styles.moreBody}>
              <OutcomePicker
                variables={changeable}
                value={search.outcome}
                topic={search.topic}
                onSelect={handlePick}
                fields="topic-and-search"
              />
              {displayOptions}
            </div>
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
          <p className={styles.hint} role="status">
            This view needs the live data service, which is offline right now — the Atlas and
            Breakdowns still work.
          </p>
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
                : `${title}: average change among the same people, ${pair}, by country.`,
            )}
            marks="dots"
            levelLabel={levelLabel}
            intro={
              detail && (
                <div className={styles.wording}>
                  <WordingPanel detail={detail} />
                </div>
              )
            }
            response={withRows(display.rows)}
            meta={meta.data.meta}
            csv={csvFor(display.rows, isCategorical ? 'change_share' : 'change')}
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
                ariaLabel={`${title}: the share of people at each change in their own answer, ${pair}, for ${display.countryDomain.length ? chosen.length : 0} countries. The data table below carries every number.`}
                marks="bins"
                response={withRows(distribution)}
                meta={meta.data.meta}
                csv={csvFor(distribution, 'change_distribution')}
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

          {hasTransitions && chosen.length > 0 && (
            <ChartFigure
              title="Where people moved between answers"
              subtitle={`Of the people who gave each answer first, the share giving each answer later · ${pair}`}
              ariaLabel={`${title}: for each first answer, the share of the same people giving each later answer, ${pair}. Each row sums to 100%. The data table below carries every number.`}
              marks="table"
              response={withRows(transitions)}
              meta={meta.data.meta}
              csv={csvFor(transitions, 'transition')}
              isRefreshing={change.isPlaceholderData}
              levelLabel={levelLabel}
            >
              {chosen.map((code) => (
                <TransitionTable
                  key={code}
                  rows={transitions.filter((row) => Number(row.group['country_code']) === code)}
                  levelLabel={(level) => levelLabel(level) ?? String(level)}
                  caption={`${groupValueLabel('country_code', code, meta.data.meta)} — each row sums to 100%`}
                />
              ))}
            </ChartFigure>
          )}
        </>
      ) : null}
    </section>
  )
}
