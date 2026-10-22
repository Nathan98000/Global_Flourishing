// Atlas (§2.5): pick a measure and a wave, see ranked dots/bars or the
// distribution — CI on every value, n in the CSV, the question on
// the page, weight and suppression rule in plain words under the chart,
// coverage on Y2/MY, the URL carrying all of it. Statistics come from
// the server; this view only chooses, filters and renders.

import { getRouteApi } from '@tanstack/react-router'
import { useMemo, type ReactNode } from 'react'
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
import { OptionsSheet } from '../components/controls/OptionsSheet'
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
import { WAVE_CHIPS, WAVE_TITLES, yearNote, yearReason } from '../waves'
import styles from './AtlasView.module.css'
import { countriesPhrase, keyCiLevel, keyThinBelow, orderPhrase, stateLine } from './viewState'

const route = getRouteApi('/')

export function AtlasView() {
  const search = route.useSearch()
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
  // A numeric question's Distribution shows four countries at most. With
  // none chosen it is never a dead end (F9): the first four in the value
  // order the chart's other views use — the server's estimates of the
  // default statistic, ordered as the Atlas orders them.
  const firstFourNeeded = stat === 'distribution' && !allAnswers && search.countries.length === 0
  const orderEstimates = useEstimates(
    chartable && firstFourNeeded ? atlasRequest({ ...search, stat: undefined }, variable) : null,
  )
  const orderRows = orderEstimates.data?.response.rows
  const firstFour = useMemo(
    () =>
      orderRows && metaForSort
        ? sortAtlasRows(orderRows, metaForSort, dir)
            .slice(0, 4)
            .map((row) => Number(row.group['country_code']))
        : [],
    [orderRows, metaForSort, dir],
  )
  const distributionCountries = search.countries.length ? search.countries.slice(0, 4) : firstFour

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
      return rows.filter((row) => distributionCountries.includes(Number(row.group['country_code'])))
    }
    if (search.countries.length) {
      rows = rows.filter((row) => search.countries.includes(Number(row.group['country_code'])))
    }
    // One ordering for the chart and the CSV (items 5/13).
    if (!metaForSort) return rows
    return sortAtlasRows(rows, metaForSort, dir)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response, stat, allAnswers, activeLevel, search.countries, metaForSort, dir, firstFour])
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
  const yearReasonText = yearReason(waveOptions)

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
  const countriesState = firstFourNeeded
    ? 'first four countries'
    : countriesPhrase(search.countries.length, countryCount)
  const subtitle = stateLine(subtitleBase, waveTitle, countriesState, ordered && orderState)
  // On a phone the summary line says the countries and the order (G3).
  const narrowSubtitle = stateLine(subtitleBase, waveTitle)
  // The distribution's four countries, said in the header (ADR-0024: no
  // line under the chart).
  const distributionHint =
    stat !== 'distribution' || allAnswers
      ? undefined
      : firstFourNeeded
        ? 'Showing the first four countries — choose others with Countries.'
        : search.countries.length > 4
          ? 'Showing the first four of the countries chosen.'
          : undefined
  // The chart's key, in its header: the mark, and its interval when the
  // marks carry one.
  const chartKey =
    stat === 'distribution' && !allAnswers ? (
      <ChartKey
        mark="bar"
        label="share of people"
        color={variable ? outcomeColor(variable.name) : undefined}
        ciLevel={keyCiLevel(displayRows)}
        thinBelow={keyThinBelow(displayRows, meta.data.meta.suppression)}
      />
    ) : allAnswers ? undefined : (
      <ChartKey
        mark={stat === 'proportion' ? 'bar' : 'dot'}
        label={stat === 'proportion' ? 'share' : stat === 'quantile' ? 'median' : 'mean'}
        color={variable ? outcomeColor(variable.name) : undefined}
        ciLevel={keyCiLevel(displayRows)}
        thinBelow={keyThinBelow(displayRows, meta.data.meta.suppression)}
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
  // In the toolbar (`inline`), or — on a phone — in the options sheet,
  // full width with the Countries between them (ADR-0029).
  const chartControls = (inline: boolean, countries?: ReactNode) => (
    <>
      {statOptions && (
        <RadioRow
          legend="Show"
          name="stat"
          inline={inline}
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
      {countries}
      {isCategorical && levels.length > 0 && (
        <RadioRow
          legend={allAnswers ? 'Ordered by % who said' : 'Showing % who said'}
          name="level"
          inline={inline}
          wide={!inline}
          selectOnNarrow
          options={levels.map((entry) => ({ value: String(entry.value), label: entry.label }))}
          value={String(activeLevel)}
          onChange={(value) => setSearch({ level: Number(value) })}
        />
      )}
    </>
  )
  // The phone's line: how the chart is drawn, in the controls' words.
  const showWord =
    stat === 'proportion'
      ? 'Share'
      : stat === 'quantile'
        ? 'Median'
        : stat === 'distribution'
          ? 'Distribution'
          : 'Mean'
  const phoneSummary = stateLine(showWord, countriesState, ordered && orderPhrase(dir))
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
        {/* What you can see, then what to do (F18). */}
        <span className={styles.deckLong}>
          How people in{' '}
          <span className={styles.deckCount}>{formatCount(countryCount)} countries</span> rate their
          own lives, from the Global Flourishing Study (2023&ndash;2024). Choose a question to
          compare countries.
        </span>
        <span className={styles.deckShort}>
          How people in{' '}
          <span className={styles.deckCount}>{formatCount(countryCount)} countries</span> rate their
          own lives. Choose a question to compare them.
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
          note={yearReasonText}
          noteBeside
        />
        {yearNoteText && <p className={styles.barNote}>{yearNoteText}</p>}
        {!narrow && countryFilter}
      </div>
      {narrow && chartable && (
        <OptionsSheet summary={phoneSummary}>
          {chartControls(
            false,
            <CountryFilter
              variant="panel"
              countries={meta.data.meta.countries}
              selected={search.countries}
              onChange={(countries) => setSearch({ countries })}
            />,
          )}
        </OptionsSheet>
      )}

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
          {estimates.isPending || (firstFourNeeded && orderEstimates.isPending) ? (
            <LoadingBlock height={420} label="Loading estimates" />
          ) : estimates.isError ? (
            // No chart, no header: its controls stay reachable here, so a
            // failed statistic can be changed back.
            <>
              {!narrow && <div className={styles.controls}>{chartControls(true)}</div>}
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
                narrowSubtitle={narrowSubtitle}
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
                toolbar={narrow ? undefined : chartControls(true)}
                chartKey={chartKey}
                hint={distributionHint}
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
