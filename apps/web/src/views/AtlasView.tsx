// Atlas (§2.5): pick a measure and a wave, see ranked dots/bars or the
// distribution — CI on every value, n in the CSV, the question on
// the page, weight and suppression rule in plain words under the chart,
// coverage on Y2/MY, the URL carrying all of it. Statistics come from
// the server; this view only chooses, filters and renders.

import { getRouteApi } from '@tanstack/react-router'
import { useId, useMemo } from 'react'
import { exportCsvUrl, useEstimates } from '../api/estimates'
import { NetworkError } from '../api/errors'
import { useBootStatus, useHealth, useMeta } from '../api/meta'
import type { Stat } from '../api/types'
import { useVariable, useVariables } from '../api/variables'
import { ChartFigure, type CsvExport } from '../charts/ChartFigure'
import { ChartKey } from '../charts/ChartKey'
import { SortHead } from '../charts/SortHead'
import { Histogram } from '../charts/Histogram'
import { RankedBar } from '../charts/RankedBar'
import { MAX_ANSWERS, StackedShares } from '../charts/StackedShares'
import { summarizeExtremes } from '../charts/summary'
import { outcomeColor } from '../charts/theme'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingBlock } from '../components/Loading'
import { InvalidParamsNotice, StatusNotice } from '../components/Notice'
import { OfflineLine } from '../components/StillWorks'
import { Skeleton } from '../components/Skeleton'
import { WordingPanel } from '../components/WordingPanel'
import { CountryFilter } from '../components/controls/CountryFilter'
import { QuestionPicker } from '../components/controls/QuestionPicker'
import { RadioRow, type RadioOption } from '../components/controls/RadioRow'
import { downloadTextFile, responseToCsv } from '../export/csv'
import { exportFilename, type ExportName } from '../export/filename'
import { formatCount } from '../format'
import { defaultLevel, groupValueLabel, outcomeLevels, scaleSubtitle } from '../labels'
import { DEFAULT_DIR, reversed, sortAtlasRows } from '../sortRows'
import { searchNavigation } from '../state/navigate'
import { atlasRequest, atlasSearchParams, type AtlasSearch } from '../state/search'
import { NARROW_VIEWPORT, useMediaQuery } from '../useMediaQuery'
import { WAVE_CHIPS, WAVE_TITLES, yearNote } from '../waves'
import styles from './AtlasView.module.css'
import { countriesPhrase, keyCiLevel, orderPhrase, stateLine } from './viewState'

const route = getRouteApi('/')

export function AtlasView() {
  const search = route.useSearch()
  const yearNoteId = useId()
  const navigate = route.useNavigate()
  const meta = useMeta()
  const health = useHealth()
  const boot = useBootStatus()
  const variables = useVariables()
  const variable = variables.data?.byName[search.outcome]
  const chartable = variable !== undefined && variable.servable
  const detailQuery = useVariable(chartable ? search.outcome : null)
  const detail = detailQuery.data?.detail

  const setSearch = (patch: Partial<AtlasSearch>) => {
    void navigate(searchNavigation(atlasSearchParams({ ...search, ...patch })))
  }

  const metaForSort = meta.data?.meta
  const dir = search.dir ?? DEFAULT_DIR
  const narrow = useMediaQuery(NARROW_VIEWPORT)
  const isCategorical = variable?.default_stat === 'proportion'
  const levels = useMemo(() => outcomeLevels(detail), [detail])
  // A categorical question's every answer, as stacked bars (ADR-0025):
  // offered where the ramp tells its answers apart (still loading its
  // answers counts — the chart waits for them); otherwise a link's
  // `stat=distribution` shows the share view.
  const answersAvailable =
    isCategorical && (detail === undefined || (levels.length >= 2 && levels.length <= MAX_ANSWERS))
  // A median is the live service's alone: while it is down (or has no
  // data) a median link shows the mean, and says why (F13) — no fault of
  // the link's. Still deciding (health pending) keeps the link's ask.
  const liveDown = health.isError || (health.isSuccess && health.data.data !== 'ok')
  const medianOffline = search.stat === 'quantile' && liveDown
  const defaultStat = (variable?.default_stat as Stat | undefined) ?? 'mean'
  const requested: Stat = medianOffline ? defaultStat : (search.stat ?? defaultStat)
  const stat: Stat =
    isCategorical && requested === 'distribution' && !answersAvailable ? 'proportion' : requested
  const allAnswers = isCategorical && stat === 'distribution'
  const activeLevel = search.level ?? defaultLevel(detail)
  const levelLabel = levels.find((entry) => entry.value === activeLevel)?.label
  // A derived score's distribution bins arrive as its value labels
  // ("0–1" … "9–10", the server's rule — ADR-0015); an item's answer
  // codes wear their own labels in the hover cards (ADR-0016).
  const binLabel = (level: number) => levels.find((entry) => entry.value === level)?.label
  const derivedBins = variable?.is_derived && levels.length > 0

  const request = chartable
    ? atlasRequest(medianOffline ? { ...search, stat: undefined } : search, variable)
    : null
  const estimates = useEstimates(request)
  const response = estimates.data?.response

  const displayRows = useMemo(() => {
    if (!response) return []
    let rows = response.rows
    if (allAnswers) {
      // Every answer for every country shown, countries in the order of
      // the chosen answer's share, answers in code order.
      if (search.countries.length) {
        rows = rows.filter((row) => search.countries.includes(Number(row.group['country_code'])))
      }
      const level = search.level ?? defaultLevel(detail, rows)
      const ordered = metaForSort
        ? sortAtlasRows(
            rows.filter((row) => row.level === level),
            metaForSort,
            dir,
          )
        : []
      const rank = new Map(ordered.map((row, index) => [row.group['country_code'], index]))
      const at = (row: (typeof rows)[number]) =>
        rank.get(row.group['country_code']) ?? Number.MAX_SAFE_INTEGER
      return rows
        .filter((row) => row.level !== null && row.level !== undefined)
        .sort((a, b) => at(a) - at(b) || (a.level ?? 0) - (b.level ?? 0))
    }
    if (stat === 'proportion') {
      const level = search.level ?? defaultLevel(detail, rows)
      if (level !== undefined) rows = rows.filter((row) => row.level === level)
    }
    if (stat === 'distribution') {
      return rows.filter((row) =>
        search.countries.slice(0, 4).includes(Number(row.group['country_code'])),
      )
    }
    if (search.countries.length) {
      rows = rows.filter((row) => search.countries.includes(Number(row.group['country_code'])))
    }
    // One ordering for the chart and the CSV (items 5/13).
    if (!metaForSort) return rows
    return sortAtlasRows(rows, metaForSort, dir)
  }, [response, stat, allAnswers, activeLevel, search.countries, metaForSort, dir])
  const countryOrder = useMemo(
    () =>
      metaForSort && allAnswers
        ? [
            ...new Set(
              displayRows.map((row) =>
                groupValueLabel('country_code', row.group['country_code'] ?? null, metaForSort),
              ),
            ),
          ]
        : [],
    [displayRows, metaForSort, allAnswers],
  )

  if (meta.isPending || variables.isPending) {
    return (
      <section>
        <h2>Atlas</h2>
        <Skeleton height={420} label="Loading the Atlas" />
      </section>
    )
  }
  if (meta.isError || variables.isError || !meta.data || !variables.data) {
    return (
      <section>
        <h2>Atlas</h2>
        <ErrorState apiReachable={boot.apiReachable} error={meta.error ?? variables.error} />
      </section>
    )
  }

  const handlePick = ({ outcome }: { outcome: string }) => {
    const target = variables.data.byName[outcome]
    const wave =
      target && !target.waves_available.includes(search.wave)
        ? (target.waves_available[0] as AtlasSearch['wave'] | undefined)
        : search.wave
    setSearch({
      outcome,
      topic: undefined,
      wave: wave ?? search.wave,
      stat: undefined,
      level: undefined,
      invalid: undefined,
      invalidRaw: undefined,
    })
  }

  const countryCount = meta.data.meta.countries.length
  const waveOptions: RadioOption<AtlasSearch['wave']>[] = meta.data.meta.waves.map((wave) => ({
    value: wave as AtlasSearch['wave'],
    label: WAVE_CHIPS[wave] ?? wave,
    disabled: variable ? !variable.waves_available.includes(wave) : false,
  }))
  // Why a year is unavailable, or what Midyear is: under the whole bar.
  const yearNoteText = yearNote(waveOptions)

  const statOptions: RadioOption<string>[] | null =
    variable && variable.scale_type === 'scale_0_10'
      ? [
          { value: 'default', label: 'Mean' },
          { value: 'distribution', label: 'Distribution' },
          { value: 'quantile', label: 'Median', disabled: liveDown },
        ]
      : variable && variable.scale_type === 'count'
        ? [
            { value: 'default', label: 'Mean' },
            { value: 'quantile', label: 'Median', disabled: liveDown },
          ]
        : answersAvailable
          ? [
              { value: 'default', label: 'Share' },
              { value: 'distribution', label: 'Distribution' },
            ]
          : null

  // The title is the measure alone; the wave clause rides last in the
  // subtitle, which therefore always shows (§7).
  const title = variable?.display_name ?? search.outcome
  const waveTitle = WAVE_TITLES[search.wave] ?? search.wave
  const subtitleBase =
    stat === 'proportion'
      ? levelLabel
        ? `share answering “${levelLabel}”`
        : undefined
      : allAnswers
        ? 'share giving each answer'
        : stat === 'distribution'
          ? undefined
          : variable
            ? scaleSubtitle(variable, stat, detail)
            : undefined
  // The state, in the controls' words (ADR-0029): the year, the
  // countries, the order.
  const ordered = stat !== 'distribution' || allAnswers
  const orderState =
    allAnswers && levelLabel ? `by “${levelLabel}”, ${orderPhrase(dir)}` : orderPhrase(dir)
  const subtitle = stateLine(
    subtitleBase,
    waveTitle,
    countriesPhrase(search.countries.length, countryCount),
    ordered && orderState,
  )
  // The chart's key, in its header: the mark, and its interval when the
  // marks carry one.
  const chartKey =
    stat === 'distribution' && !allAnswers ? (
      <ChartKey
        mark="bar"
        label="share of people"
        color={variable ? outcomeColor(variable.name) : undefined}
        ciLevel={keyCiLevel(displayRows)}
      />
    ) : allAnswers ? undefined : (
      <ChartKey
        mark={stat === 'proportion' ? 'bar' : 'dot'}
        label={stat === 'proportion' ? 'share' : stat === 'quantile' ? 'median' : 'mean'}
        color={variable ? outcomeColor(variable.name) : undefined}
        ciLevel={keyCiLevel(displayRows)}
      />
    )

  // What a download is called, in words (ADR-0016); the server names its
  // CSV the same way.
  const exportName: ExportName = {
    measure: title,
    view: 'By country',
    waves: WAVE_CHIPS[search.wave] ?? search.wave,
  }
  const csv: CsvExport | undefined =
    request === null
      ? undefined
      : health.isSuccess && health.data.data === 'ok'
        ? { kind: 'server', href: exportCsvUrl(request) }
        : response && estimates.data?.source === 'static'
          ? {
              kind: 'client',
              onDownload: () =>
                downloadTextFile(exportFilename(exportName, 'csv'), responseToCsv(response)),
            }
          : undefined

  // Statistic, Order, Countries and Answer level fold into a
  // disclosure under 40rem (§8), Topic + search first inside it; Measure
  // and Wave stay visible so the chart starts within the first phone
  // screen.
  const countryFilter = (
    <CountryFilter
      countries={meta.data.meta.countries}
      selected={search.countries}
      onChange={(countries) => setSearch({ countries })}
    />
  )
  // How the chart is drawn, in its header's toolbar (ADR-0029).
  const chartControls = (
    <>
      {statOptions && (
        <RadioRow
          legend="Show"
          name="stat"
          inline
          selectOnNarrow
          options={statOptions}
          value={medianOffline ? 'default' : (search.stat ?? 'default')}
          onChange={(value) =>
            setSearch({ stat: value === 'default' ? undefined : (value as Stat) })
          }
          note={
            statOptions.some((option) => option.disabled)
              ? 'Median — needs the live data service.'
              : undefined
          }
        />
      )}
      {isCategorical && levels.length > 0 && (
        <RadioRow
          legend={allAnswers ? 'Ordered by % who said' : 'Showing % who said'}
          name="level"
          inline
          options={levels.map((entry) => ({ value: String(entry.value), label: entry.label }))}
          value={String(activeLevel)}
          onChange={(value) => setSearch({ level: Number(value) })}
        />
      )}
    </>
  )
  // The order is the value label's (ADR-0029): a click reverses it, and
  // writes `dir` as the Order buttons did.
  const sortHead = ordered && (
    <SortHead
      names="Country"
      value={
        stat === 'proportion' || allAnswers ? 'Share' : stat === 'quantile' ? 'Median' : 'Mean'
      }
      dir={dir}
      onToggle={() => setSearch({ dir: reversed(dir) })}
    />
  )

  return (
    <section>
      <h2 className="visually-hidden">Atlas</h2>
      <p className={styles.deck}>
        <span className={styles.deckLong}>
          How{' '}
          <span className={styles.deckCount}>
            207,919 people across {formatCount(countryCount)} countries
          </span>{' '}
          rate their own lives — the Global Flourishing Study, 2023&ndash;2024. Pick a measure
          below; every number carries its sample size and margin of error.
        </span>
        <span className={styles.deckShort}>
          <span className={styles.deckCount}>
            207,919 people in {formatCount(countryCount)} countries
          </span>
          , 2023&ndash;2024. Every number shows how precise it is.
        </span>
      </p>
      <InvalidParamsNotice
        invalid={search.invalid}
        onDismiss={() =>
          void navigate(
            searchNavigation(
              atlasSearchParams({ ...search, invalid: undefined, invalidRaw: undefined }),
              { replace: true },
            ),
          )
        }
      />
      {medianOffline && (
        <StatusNotice>
          The live data service is offline, so medians can&rsquo;t be shown right now — showing the
          mean.
        </StatusNotice>
      )}
      {/* The question bar (ADR-0029): what, then when and where. */}
      <div className={styles.questionBar} data-bar="question">
        <QuestionPicker
          variant="field"
          label="Question"
          variables={variables.data.list}
          wave={search.wave}
          value={search.outcome}
          topic={search.topic}
          onPick={(outcome) => handlePick({ outcome })}
        />
        <RadioRow
          legend="Year"
          name="wave"
          options={waveOptions}
          value={search.wave}
          onChange={(wave) => setSearch({ wave })}
          noteId={yearNoteText ? yearNoteId : undefined}
        />
        {yearNoteText && (
          <p id={yearNoteId} className={styles.barNote}>
            {yearNoteText}
          </p>
        )}
        {narrow ? (
          <details className={styles.moreOptions}>
            <summary>More options — countries</summary>
            <div className={styles.moreBody}>{countryFilter}</div>
          </details>
        ) : (
          countryFilter
        )}
      </div>

      {!chartable ? (
        // No measure is selected — the state of the data service is
        // irrelevant when nothing has been asked for (F4).
        <EmptyState title="Choose a measure to begin">
          <p>
            {variable === undefined
              ? `The link asked for “${search.outcome}”, which isn't in this release's codebook — `
              : `“${search.outcome}” can't be charted (its codebook entry says why) — `}
            pick a topic and measure above, or search all the measures.
          </p>
        </EmptyState>
      ) : (
        <>
          {stat === 'distribution' && !allAnswers && search.countries.length === 0 ? (
            <EmptyState title="Choose countries to compare">
              <p>
                The distribution view shows the full shape of answers for up to four countries —
                pick them with the Countries control above.
              </p>
            </EmptyState>
          ) : estimates.isPending ? (
            <LoadingBlock height={420} label="Loading estimates" />
          ) : estimates.isError ? (
            // No chart, no header: its controls stay reachable here, so a
            // failed statistic can be changed back.
            <>
              <div className={styles.controls}>{chartControls}</div>
              {estimates.error instanceof NetworkError && !boot.apiReachable ? (
                <OfflineLine except="/" className={styles.hint} />
              ) : (
                <ErrorState apiReachable={boot.apiReachable} error={estimates.error} />
              )}
            </>
          ) : response && variable ? (
            <>
              <p role="status" className="visually-hidden">
                Updated: {title}, {displayRows.length} rows shown.
              </p>
              <ChartFigure
                title={title}
                subtitle={subtitle}
                ariaLabel={
                  allAnswers
                    ? summarizeExtremes(
                        displayRows.filter((row) => row.level === activeLevel),
                        meta.data.meta,
                        `${title}: the share giving each of ${levels.length} answers (${levels.map((entry) => entry.label).join(', ')}) in each of ${countryOrder.length} countries, ${waveTitle}. Answering “${levelLabel ?? activeLevel}”:`,
                      )
                    : summarizeExtremes(
                        stat === 'distribution' ? [] : displayRows,
                        meta.data.meta,
                        `${title}${subtitle ? ` (${subtitle})` : ''} by country.`,
                      )
                }
                intro={
                  detail && (
                    <div className={styles.wording}>
                      <WordingPanel detail={detail} />
                    </div>
                  )
                }
                toolbar={chartControls}
                chartKey={chartKey}
                sortHead={sortHead}
                csv={csv}
                exportName={exportName}
                isRefreshing={estimates.isPlaceholderData}
              >
                {allAnswers ? (
                  levels.length > 0 ? (
                    <StackedShares
                      rows={displayRows}
                      meta={meta.data.meta}
                      answers={levels}
                      polarity={variable.polarity}
                      countryOrder={countryOrder}
                      sortedBy={activeLevel}
                    />
                  ) : (
                    <LoadingBlock height={420} label="Loading the answers" />
                  )
                ) : stat === 'distribution' ? (
                  <>
                    <Histogram
                      rows={displayRows}
                      meta={meta.data.meta}
                      responseMeta={response.meta}
                      variable={variable}
                      color={outcomeColor(variable.name)}
                      {...(derivedBins
                        ? {
                            levels: levels.map((entry) => entry.value),
                            levelLabel: (level: number) => binLabel(level) ?? String(level),
                            xLabel: `Score (${variable.min ?? 0}–${variable.max ?? 10}), 1-point bins`,
                          }
                        : {})}
                    />
                    {search.countries.length > 4 && (
                      <p className={styles.hint}>Showing the first four selected countries.</p>
                    )}
                  </>
                ) : (
                  <RankedBar
                    rows={displayRows}
                    meta={meta.data.meta}
                    responseMeta={response.meta}
                    variable={variable}
                    color={outcomeColor(variable.name)}
                    levelLabel={levelLabel}
                  />
                )}
              </ChartFigure>
            </>
          ) : null}
        </>
      )}
    </section>
  )
}
