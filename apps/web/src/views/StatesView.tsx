// US States (Phase 5): state-by-state estimates on the state-calibrated
// weights (/v1/states), as a choropleth or a ranked chart, beside the
// US overall figure from the national cross-section the Atlas shows —
// the state-vs-national comparison. `adj` selects the adjusted weight
// variants, which the release has no Wave 1 version of: the control is
// unavailable there, with the reason, rather than asked for and
// refused. States are labelled by the server's own codes, every state
// its own (ADR-0028); the 157 US respondents without a state are simply
// absent.

import { getRouteApi } from '@tanstack/react-router'
import { Suspense, lazy, useId, useMemo } from 'react'
import { NetworkError } from '../api/errors'
import { useEstimates } from '../api/estimates'
import { useBootStatus, useHealth, useMeta } from '../api/meta'
import { NO_ADJUSTED_WEIGHT_WAVE, adjustedWeightsExist, useStates } from '../api/states'
import type { EstimateRow, Stat } from '../api/types'
import { useVariable, useVariables } from '../api/variables'
import { useWarmApi } from '../api/warm'
import { ChartFigure } from '../charts/ChartFigure'
import { ChartKey } from '../charts/ChartKey'
import { RankedBar, type Reference } from '../charts/RankedBar'
import { outcomeColor, people, plotValue } from '../charts/theme'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingBlock } from '../components/Loading'
import { InvalidParamsNotice } from '../components/Notice'
import { OfflineLine } from '../components/StillWorks'
import { Skeleton } from '../components/Skeleton'
import { Stat as StatLine } from '../components/Stat'
import { WordingPanel } from '../components/WordingPanel'
import { QuestionPicker } from '../components/controls/QuestionPicker'
import { RadioRow, type RadioOption } from '../components/controls/RadioRow'
import { downloadTextFile, responseToCsv } from '../export/csv'
import { exportFilename, type ExportName } from '../export/filename'
import { ciLabel, formatCI, formatEstimate } from '../format'
import { groupValueLabel, highestLevel, outcomeLevels, scaleSubtitle } from '../labels'
import { DEFAULT_DIR, VALUE_ORDER } from '../sortRows'
import { searchNavigation } from '../state/navigate'
import { statesRequest, statesSearchParams, type StatesSearch } from '../state/search'
import { NARROW_VIEWPORT, useMediaQuery } from '../useMediaQuery'
import { WAVE_CHIPS, WAVE_TITLES, yearNote } from '../waves'
import { US_COUNTRY_CODE, sortStateRows } from './stateRows'
import styles from './AtlasView.module.css'
import { keyCiLevel, orderPhrase, stateLine } from './viewState'

const StatesMapPanel = lazy(() => import('./StatesMapPanel'))

const route = getRouteApi('/states')

export function StatesView() {
  useWarmApi()
  const search = route.useSearch()
  const yearNoteId = useId()
  const navigate = route.useNavigate()
  const meta = useMeta()
  const boot = useBootStatus()
  const health = useHealth()
  const adjReasonId = useId()
  // Every state figure is the live service's: while it is down (or has
  // no data) the page says so, and Median says why it can't be chosen.
  const liveDown = health.isError || (health.isSuccess && health.data.data !== 'ok')
  const variables = useVariables()
  const variable = variables.data?.byName[search.outcome]
  const chartable = variable !== undefined && variable.servable
  const detailQuery = useVariable(chartable ? search.outcome : null)
  const detail = detailQuery.data?.detail
  const narrow = useMediaQuery(NARROW_VIEWPORT)
  const dir = search.dir ?? DEFAULT_DIR
  const stat: Stat = search.stat ?? (variable?.default_stat as Stat | undefined) ?? 'mean'
  const isCategorical = variable?.default_stat === 'proportion'
  const levels = useMemo(() => outcomeLevels(detail), [detail])
  const activeLevel = search.level ?? levels[0]?.value
  const levelLabel = levels.find((entry) => entry.value === activeLevel)?.label

  const setSearch = (patch: Partial<StatesSearch>) => {
    void navigate(searchNavigation(statesSearchParams({ ...search, ...patch })))
  }

  const request = chartable ? statesRequest(search, variable) : null
  const states = useStates(request)
  const response = states.data
  // The US overall figure the states are read against: the whole US on
  // the same state weight (the server resolves it from the weight
  // table for the state scope) — so the reference and the rows share a
  // weight. The national-weight figure (the Atlas's, from the static
  // tier) goes in the footnote.
  const overall = useEstimates(
    chartable
      ? {
          outcome: search.outcome,
          wave: search.wave,
          stat,
          by: [],
          scope: search.adj ? 'us_state_adj' : 'us_state',
        }
      : null,
  )
  const national = useEstimates(
    chartable ? { outcome: search.outcome, wave: search.wave, stat, by: ['country_code'] } : null,
  )
  const pickLevel = (rows: readonly EstimateRow[]) => {
    const level = isCategorical ? (activeLevel ?? highestLevel([...rows])) : undefined
    return rows.find((row) => level === undefined || row.level === level)
  }
  const overallRow = useMemo(
    () => pickLevel(overall.data?.response.rows ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overall.data, isCategorical, activeLevel],
  )
  const nationalRow = useMemo(
    () =>
      pickLevel(
        (national.data?.response.rows ?? []).filter(
          (row) => Number(row.group['country_code']) === US_COUNTRY_CODE,
        ),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [national.data, isCategorical, activeLevel],
  )
  const served = meta.data?.meta
  const stateName = (code: string) => (served ? groupValueLabel('state', code, served) : code)

  const displayRows = useMemo(() => {
    if (!response) return []
    let rows = response.rows
    if (stat === 'proportion') {
      const level = activeLevel ?? highestLevel(rows)
      if (level !== undefined) rows = rows.filter((row) => row.level === level)
    }
    return sortStateRows(rows, dir, stateName)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response, stat, activeLevel, dir, served])

  if (meta.isPending || variables.isPending) {
    return (
      <section>
        <h2>US States</h2>
        <LoadingBlock height={420} label="Loading the US States view" />
      </section>
    )
  }
  if (meta.isError || variables.isError || !served || !variables.data) {
    return (
      <section>
        <h2>US States</h2>
        <ErrorState apiReachable={boot.apiReachable} error={meta.error ?? variables.error} />
      </section>
    )
  }

  const handlePick = ({ outcome }: { outcome: string }) => {
    const target = variables.data.byName[outcome]
    const wave =
      target && !target.waves_available.includes(search.wave)
        ? (target.waves_available[0] as StatesSearch['wave'] | undefined)
        : search.wave
    const nextWave = wave ?? search.wave
    setSearch({
      outcome,
      topic: undefined,
      wave: nextWave,
      adj: adjustedWeightsExist(nextWave) ? search.adj : undefined,
      stat: undefined,
      level: undefined,
      invalid: undefined,
      invalidRaw: undefined,
    })
  }

  const waveOptions: RadioOption<StatesSearch['wave']>[] = served.waves.map((wave) => ({
    value: wave as StatesSearch['wave'],
    label: WAVE_CHIPS[wave] ?? wave,
    disabled: variable ? !variable.waves_available.includes(wave) : false,
  }))
  // Why a year is unavailable, or what Midyear is: under the whole bar.
  const yearNoteText = yearNote(waveOptions)
  const statOptions: RadioOption<string>[] | null =
    variable && (variable.scale_type === 'scale_0_10' || variable.scale_type === 'count')
      ? [
          { value: 'default', label: 'Mean' },
          { value: 'quantile', label: 'Median', disabled: liveDown },
        ]
      : null
  const adjAvailable = adjustedWeightsExist(search.wave)
  const adjReason = `The release has no adjusted state weight for ${WAVE_TITLES[NO_ADJUSTED_WEIGHT_WAVE] ?? NO_ADJUSTED_WEIGHT_WAVE}.`

  const title = variable?.display_name ?? search.outcome
  const waveTitle = WAVE_TITLES[search.wave] ?? search.wave
  // What a download is called, in words (ADR-0016).
  const exportName: ExportName = {
    measure: title,
    view: search.adj ? 'By state, adjusted weights' : 'By state',
    waves: WAVE_CHIPS[search.wave] ?? search.wave,
  }
  const subtitleBase =
    stat === 'proportion'
      ? levelLabel
        ? `share answering “${levelLabel}”`
        : undefined
      : variable
        ? scaleSubtitle(variable, stat, detail)
        : undefined
  // The state, in the controls' words (ADR-0029); every state figure is
  // on its state weight, so only the adjustment is said.
  const subtitle = stateLine(
    subtitleBase,
    search.adj && 'adjusted for who answered in each state',
    waveTitle,
    search.view === 'bars' && orderPhrase(dir),
  )
  const reference: Reference | undefined =
    overallRow && overallRow.estimate !== null
      ? { value: plotValue(overallRow) as number, label: 'US overall (state weights)' }
      : undefined
  const nationalNote =
    nationalRow && nationalRow.estimate !== null
      ? `On the national weight, the US overall figure is ${formatEstimate(nationalRow.estimate, nationalRow.stat)}${
          nationalRow.ci_lo !== null && nationalRow.ci_hi !== null
            ? ` ${formatCI(nationalRow)} (${ciLabel(nationalRow.ci_level)})`
            : ''
        }, based on ${people(nationalRow.n)}.`
      : undefined
  const extremes = (() => {
    const valid = displayRows.filter((row) => row.estimate !== null)
    if (valid.length === 0) return 'No estimates to show.'
    const sorted = [...valid].sort((a, b) => (b.estimate ?? 0) - (a.estimate ?? 0))
    const top = sorted[0] as EstimateRow
    const bottom = sorted[sorted.length - 1] as EstimateRow
    return `Highest: ${stateName(String(top.group['state']))} ${formatEstimate(top.estimate, top.stat)}; lowest: ${stateName(String(bottom.group['state']))} ${formatEstimate(bottom.estimate, bottom.stat)}.`
  })()

  // How the chart is drawn, in its header's toolbar (ADR-0029).
  const chartControls = (
    <>
      {statOptions && (
        <RadioRow
          legend="Show"
          name="stat"
          inline
          options={statOptions}
          value={search.stat ?? 'default'}
          onChange={(value) =>
            setSearch({ stat: value === 'default' ? undefined : (value as Stat) })
          }
          note={liveDown ? 'Median — needs the live data service.' : undefined}
        />
      )}
      <RadioRow
        legend="View"
        name="view"
        inline
        options={[
          { value: 'map', label: 'Map' },
          { value: 'bars', label: 'Chart' },
        ]}
        value={search.view}
        onChange={(view) => setSearch({ view })}
      />
      {isCategorical && levels.length > 0 && (
        <RadioRow
          legend="Showing % who said"
          name="level"
          inline
          options={levels.map((entry) => ({ value: String(entry.value), label: entry.label }))}
          value={String(activeLevel)}
          onChange={(value) => setSearch({ level: Number(value) })}
        />
      )}
      {/* The switch with its reason in view when it is off (F6). */}
      <span className={styles.switch}>
        <label className={styles.oriented}>
          <input
            type="checkbox"
            checked={search.adj ?? false}
            disabled={!adjAvailable}
            aria-describedby={adjAvailable ? undefined : adjReasonId}
            onChange={(event) => setSearch({ adj: event.target.checked || undefined })}
          />{' '}
          Adjust for who answered in each state
        </label>
        {!adjAvailable && (
          <span id={adjReasonId} className={styles.reason}>
            {adjReason}
          </span>
        )}
      </span>
    </>
  )
  const displayOptions = search.view === 'bars' && (
    <RadioRow
      legend="Order"
      name="dir"
      options={VALUE_ORDER}
      value={dir}
      onChange={(value) => setSearch({ dir: value })}
    />
  )

  return (
    <section>
      <h2 className="visually-hidden">US States</h2>
      <p className={styles.deck}>
        <span className={styles.deckLong}>
          The United States state by state, on the survey&rsquo;s state weights, beside the
          country&rsquo;s overall figure. Every state stands on its own; the smallest rest on fewer
          people, so their intervals are wider.
        </span>
        <span className={styles.deckShort}>
          The United States state by state, beside the national figure.
        </span>
      </p>
      <InvalidParamsNotice
        invalid={search.invalid}
        onDismiss={() =>
          void navigate(
            searchNavigation(
              statesSearchParams({ ...search, invalid: undefined, invalidRaw: undefined }),
              { replace: true },
            ),
          )
        }
      />
      {/* The question bar (ADR-0029): what, then when (one country). */}
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
          noteId={yearNoteText ? yearNoteId : undefined}
          value={search.wave}
          onChange={(wave) =>
            setSearch({ wave, adj: adjustedWeightsExist(wave) ? search.adj : undefined })
          }
        />
        {yearNoteText && (
          <p id={yearNoteId} className={styles.barNote}>
            {yearNoteText}
          </p>
        )}
        {narrow && displayOptions && (
          <details className={styles.moreOptions}>
            <summary>More options — order</summary>
            <div className={styles.moreBody}>{displayOptions}</div>
          </details>
        )}
      </div>
      {!narrow && displayOptions && <div className={styles.controls}>{displayOptions}</div>}

      {!chartable ? (
        <EmptyState title="Choose a measure to begin">
          <p>
            {variable === undefined
              ? `The link asked for “${search.outcome}”, which isn't in this release's codebook — `
              : `“${search.outcome}” can't be charted (its codebook entry says why) — `}
            pick a topic and measure above, or search all the measures.
          </p>
        </EmptyState>
      ) : states.isPending ? (
        <LoadingBlock height={480} label="Loading estimates" />
      ) : states.isError ? (
        // No chart, no header: its controls stay reachable here.
        <>
          <div className={styles.controls}>{chartControls}</div>
          {states.error instanceof NetworkError && !boot.apiReachable ? (
            <OfflineLine className={styles.hint} />
          ) : (
            <ErrorState apiReachable={boot.apiReachable} error={states.error} />
          )}
        </>
      ) : response && variable ? (
        <>
          <p role="status" className="visually-hidden">
            Updated: {title}, {displayRows.length} states shown.
          </p>
          <ChartFigure
            title={title}
            subtitle={subtitle}
            ariaLabel={`${title} by US state (${subtitle}). ${extremes}`}
            intro={
              <>
                {detail && (
                  <div className={styles.wording}>
                    <WordingPanel detail={detail} />
                  </div>
                )}
                {overallRow && (
                  <p className={styles.national}>
                    US overall (state weights): <StatLine row={overallRow} />
                  </p>
                )}
                {nationalNote && <p className={styles.national}>{nationalNote}</p>}
              </>
            }
            toolbar={chartControls}
            chartKey={
              search.view === 'bars' ? (
                <ChartKey
                  mark={stat === 'proportion' ? 'bar' : 'dot'}
                  label={stat === 'proportion' ? 'share' : stat === 'quantile' ? 'median' : 'mean'}
                  color={outcomeColor(variable.name)}
                  ciLevel={keyCiLevel(displayRows)}
                />
              ) : undefined
            }
            csv={{
              kind: 'client',
              onDownload: () =>
                downloadTextFile(
                  exportFilename(exportName, 'csv'),
                  responseToCsv({ ...response, rows: displayRows }),
                ),
            }}
            exportName={exportName}
            isRefreshing={states.isPlaceholderData}
          >
            {search.view === 'map' ? (
              <Suspense fallback={<Skeleton height={450} label="Loading the map of states" />}>
                <StatesMapPanel
                  rows={displayRows}
                  responseMeta={response.meta}
                  meta={served}
                  variable={variable}
                  answer={isCategorical ? levelLabel : undefined}
                />
              </Suspense>
            ) : (
              <RankedBar
                rows={displayRows}
                meta={served}
                responseMeta={response.meta}
                variable={variable}
                color={outcomeColor(variable.name)}
                levelLabel={levelLabel}
                labelColumn="state"
                reference={reference}
              />
            )}
          </ChartFigure>
        </>
      ) : null}
    </section>
  )
}
