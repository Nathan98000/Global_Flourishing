// US States (Phase 5): state-by-state estimates on the state-calibrated
// weights (/v1/states), as a choropleth or a ranked chart, beside the
// US overall figure from the national cross-section the Atlas shows —
// the state-vs-national comparison. `adj` selects the adjusted weight
// variants, which the release has no Wave 1 version of: the control is
// unavailable there, with the reason, rather than asked for and
// refused. States are labelled by the server's own codes (two-letter
// states and the four pooled small-state groups); the 157 US
// respondents without a state are simply absent.

import { getRouteApi } from '@tanstack/react-router'
import { Suspense, lazy, useMemo } from 'react'
import { NetworkError } from '../api/errors'
import { useEstimates } from '../api/estimates'
import { useBootStatus, useMeta } from '../api/meta'
import { NO_ADJUSTED_WEIGHT_WAVE, adjustedWeightsExist, useStates } from '../api/states'
import type { EstimateRow, Stat } from '../api/types'
import { useVariable, useVariables } from '../api/variables'
import { useWarmApi } from '../api/warm'
import { ChartFigure, type ChartMarks } from '../charts/ChartFigure'
import { RankedBar, type Reference } from '../charts/RankedBar'
import { outcomeColor, plotValue } from '../charts/theme'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingBlock } from '../components/Loading'
import { InvalidParamsNotice } from '../components/Notice'
import { Skeleton } from '../components/Skeleton'
import { Stat as StatLine } from '../components/Stat'
import { WordingPanel } from '../components/WordingPanel'
import { OutcomePicker } from '../components/controls/OutcomePicker'
import { RadioRow, type RadioOption } from '../components/controls/RadioRow'
import { downloadTextFile, responseToCsv } from '../export/csv'
import { exportFilename, type ExportName } from '../export/filename'
import { ciLabel, formatCI, formatCount, formatEstimate } from '../format'
import { groupValueLabel, highestLevel, outcomeLevels, scaleSubtitle } from '../labels'
import { defaultDir } from '../sortRows'
import { searchNavigation } from '../state/navigate'
import { statesRequest, statesSearchParams, type StatesSearch } from '../state/search'
import { NARROW_VIEWPORT, useMediaQuery } from '../useMediaQuery'
import { WAVE_CHIPS, WAVE_TITLES } from '../waves'
import { US_COUNTRY_CODE, sortStateRows } from './stateRows'
import styles from './AtlasView.module.css'

const StatesMapPanel = lazy(() => import('./StatesMapPanel'))

const route = getRouteApi('/states')

export function StatesView() {
  useWarmApi()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const meta = useMeta()
  const boot = useBootStatus()
  const variables = useVariables()
  const variable = variables.data?.byName[search.outcome]
  const chartable = variable !== undefined && variable.servable
  const detailQuery = useVariable(chartable ? search.outcome : null)
  const detail = detailQuery.data?.detail
  const narrow = useMediaQuery(NARROW_VIEWPORT)
  const dir = search.dir ?? defaultDir(search.sort)
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
    return sortStateRows(rows, search.sort, dir, stateName)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response, stat, activeLevel, search.sort, dir, served])

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
    title:
      variable && !variable.waves_available.includes(wave)
        ? `Not asked in ${WAVE_TITLES[wave] ?? wave}`
        : WAVE_TITLES[wave],
  }))
  const statOptions: RadioOption<string>[] | null =
    variable && (variable.scale_type === 'scale_0_10' || variable.scale_type === 'count')
      ? [
          { value: 'default', label: 'Mean' },
          { value: 'quantile', label: 'Median' },
        ]
      : null
  const adjAvailable = adjustedWeightsExist(search.wave)
  const adjReason = `The release has no adjusted state weight for ${WAVE_TITLES[NO_ADJUSTED_WEIGHT_WAVE] ?? NO_ADJUSTED_WEIGHT_WAVE}.`

  const title = variable?.display_name ?? search.outcome
  const waveTitle = WAVE_TITLES[search.wave] ?? search.wave
  const weights = `state weights${search.adj ? ', adjusted' : ''}`
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
  const subtitle = [subtitleBase, weights, waveTitle].filter(Boolean).join(' · ')
  const marks: ChartMarks =
    search.view === 'map' ? 'state-map' : stat === 'proportion' ? 'bars' : 'dots'
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
        }, n = ${formatCount(nationalRow.n)}.`
      : undefined
  const extremes = (() => {
    const valid = displayRows.filter((row) => row.estimate !== null)
    if (valid.length === 0) return 'No estimates to show.'
    const sorted = [...valid].sort((a, b) => (b.estimate ?? 0) - (a.estimate ?? 0))
    const top = sorted[0] as EstimateRow
    const bottom = sorted[sorted.length - 1] as EstimateRow
    return `Highest: ${stateName(String(top.group['state']))} ${formatEstimate(top.estimate, top.stat)}; lowest: ${stateName(String(bottom.group['state']))} ${formatEstimate(bottom.estimate, bottom.stat)}.`
  })()

  const displayOptions = (
    <>
      {statOptions && (
        <RadioRow
          legend="Statistic"
          name="stat"
          options={statOptions}
          value={search.stat ?? 'default'}
          onChange={(value) =>
            setSearch({ stat: value === 'default' ? undefined : (value as Stat) })
          }
        />
      )}
      <RadioRow
        legend="View"
        name="view"
        options={[
          { value: 'map', label: 'Map' },
          { value: 'bars', label: 'Chart' },
        ]}
        value={search.view}
        onChange={(view) => setSearch({ view })}
      />
      {search.view === 'bars' && (
        <>
          <RadioRow
            legend="Sort"
            name="sort"
            options={[
              { value: 'estimate', label: 'By value' },
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
        </>
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
      <label className={styles.oriented} title={adjAvailable ? undefined : adjReason}>
        <input
          type="checkbox"
          checked={search.adj ?? false}
          disabled={!adjAvailable}
          onChange={(event) => setSearch({ adj: event.target.checked || undefined })}
        />{' '}
        Adjusted state weights
        {!adjAvailable && <span className={styles.reason}>{adjReason}</span>}
      </label>
    </>
  )

  return (
    <section>
      <h2 className="visually-hidden">US States</h2>
      <p className={styles.deck}>
        <span className={styles.deckLong}>
          The United States state by state, on weights calibrated to each state&rsquo;s adult
          population, beside the country&rsquo;s overall figure. Small states are pooled into groups
          so every estimate rests on enough people.
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
      <div className={styles.controls}>
        <OutcomePicker
          variables={variables.data.list}
          value={search.outcome}
          topic={search.topic}
          onSelect={handlePick}
          fields={narrow ? 'measure' : 'all'}
        />
        <RadioRow
          legend="Wave"
          name="wave"
          options={waveOptions}
          value={search.wave}
          onChange={(wave) =>
            setSearch({ wave, adj: adjustedWeightsExist(wave) ? search.adj : undefined })
          }
        />
        {narrow ? (
          <details className={styles.moreOptions}>
            <summary>More options — view, sort, weights</summary>
            <div className={styles.moreBody}>
              <OutcomePicker
                variables={variables.data.list}
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
      ) : states.isPending ? (
        <LoadingBlock height={480} label="Loading estimates" />
      ) : states.isError ? (
        states.error instanceof NetworkError && !boot.apiReachable ? (
          <p className={styles.hint} role="status">
            This view needs the live data service, which is offline right now — the Atlas and
            Segments still work.
          </p>
        ) : (
          <ErrorState apiReachable={boot.apiReachable} error={states.error} />
        )
      ) : response && variable ? (
        <>
          <p role="status" className="visually-hidden">
            Updated: {title}, {displayRows.length} states shown.
          </p>
          <ChartFigure
            title={title}
            subtitle={subtitle}
            ariaLabel={`${title} by US state (${subtitle}). ${extremes} The data table below carries every number.`}
            marks={marks}
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
              </>
            }
            response={{ ...response, rows: displayRows }}
            meta={served}
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
            unit="state"
            footnote={nationalNote}
          >
            {search.view === 'map' ? (
              <Suspense fallback={<Skeleton height={450} label="Loading the map of states" />}>
                <StatesMapPanel rows={displayRows} responseMeta={response.meta} meta={served} />
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
