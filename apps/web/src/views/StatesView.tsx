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
import { Suspense, lazy, useId, useMemo, useState } from 'react'
import { NetworkError } from '../api/errors'
import { useEstimates } from '../api/estimates'
import { useBootStatus, useHealth, useMeta } from '../api/meta'
import { NO_ADJUSTED_WEIGHT_WAVE, adjustedWeightsExist, useStates } from '../api/states'
import type { EstimateRow, Stat } from '../api/types'
import { useVariable, useVariables } from '../api/variables'
import { useWarmApi } from '../api/warm'
import { ChartFigure } from '../charts/ChartFigure'
import { ChartKey } from '../charts/ChartKey'
import { SortHead } from '../charts/SortHead'
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
import { OptionsSheet } from '../components/controls/OptionsSheet'
import { QuestionPicker } from '../components/controls/QuestionPicker'
import { RadioRow, type RadioOption } from '../components/controls/RadioRow'
import { downloadTextFile, responseToCsv } from '../export/csv'
import { exportFilename, type ExportName } from '../export/filename'
import { ciLabel, formatCI, formatEstimate } from '../format'
import { groupValueLabel, highestLevel, outcomeLevels, scaleSubtitle } from '../labels'
import { DEFAULT_DIR, reversed } from '../sortRows'
import { searchNavigation } from '../state/navigate'
import { statesRequest, statesSearchParams, type StatesSearch } from '../state/search'
import { NARROW_VIEWPORT, useMediaQuery } from '../useMediaQuery'
import { WAVE_CHIPS, WAVE_TITLES, yearNote, yearReason } from '../waves'
import { US_COUNTRY_CODE, sortStateRows } from './stateRows'
import styles from './AtlasView.module.css'
import { keyCiLevel, keyThinBelow, orderPhrase, stateLine } from './viewState'

const StatesMapPanel = lazy(() => import('./StatesMapPanel'))

/** The one US figure's name, on the chart's line and above it (F14). */
const US_OVERALL = 'United States overall'

const route = getRouteApi('/states')

export function StatesView() {
  useWarmApi()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const meta = useMeta()
  const boot = useBootStatus()
  const health = useHealth()
  const adjReasonId = useId()
  // Find a state: the state picked out, until cleared.
  const [found, setFound] = useState<string | undefined>()
  // Finding a state shows it (G5): once the chart has drawn its pinned
  // card (or the map its outline), that part of the chart comes to the
  // middle of the screen — smoothly, unless motion is reduced.
  const find = (code: string | undefined) => {
    setFound(code)
    if (code === undefined) return
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const chart = document.querySelector('main figure [role="img"]')
        // The pinned card: the tip that holds text (the hover tip is empty).
        const pinned = [...(chart?.querySelectorAll('g[aria-label="tip"]') ?? [])].find(
          (tip) => tip.textContent,
        )
        const target = pinned ?? chart
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        target?.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
      }),
    )
  }
  const narrow = useMediaQuery(NARROW_VIEWPORT)
  // Every state figure is the live service's: while it is down (or has
  // no data) the page says so, and Median says why it can't be chosen.
  const liveDown = health.isError || (health.isSuccess && health.data.data !== 'ok')
  const variables = useVariables()
  const variable = variables.data?.byName[search.outcome]
  const chartable = variable !== undefined && variable.servable
  const detailQuery = useVariable(chartable ? search.outcome : null)
  const detail = detailQuery.data?.detail
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
  const yearReasonText = yearReason(waveOptions)
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
  // On a phone the summary line says the order (G3).
  const narrowSubtitle = stateLine(
    subtitleBase,
    search.adj && 'adjusted for who answered in each state',
    waveTitle,
  )
  // One US figure (F14): the whole US on the states' own weight, the
  // line the states are read against.
  const reference: Reference | undefined =
    overallRow && overallRow.estimate !== null
      ? { value: plotValue(overallRow) as number, label: US_OVERALL }
      : undefined
  // The national-weight figure — the Atlas's — waits in a fold, its CI
  // and n intact.
  const nationalNote =
    nationalRow && nationalRow.estimate !== null
      ? `On the national weight — the Atlas's, made for the country as a whole — the United States overall is ${formatEstimate(nationalRow.estimate, nationalRow.stat)}${
          nationalRow.ci_lo !== null && nationalRow.ci_hi !== null
            ? ` (${ciLabel(nationalRow.ci_level)}: ${formatCI(nationalRow)})`
            : ''
        }, based on ${people(nationalRow.n)}.`
      : undefined
  // The states this chart has, by the server's names (a list to pick
  // from, A–Z — not a sort).
  const stateOptions = [...new Set(displayRows.map((row) => String(row.group['state'] ?? '')))]
    .filter(Boolean)
    .map((code) => ({ code, name: stateName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const extremes = (() => {
    const valid = displayRows.filter((row) => row.estimate !== null)
    if (valid.length === 0) return 'No estimates to show.'
    const sorted = [...valid].sort((a, b) => (b.estimate ?? 0) - (a.estimate ?? 0))
    const top = sorted[0] as EstimateRow
    const bottom = sorted[sorted.length - 1] as EstimateRow
    return `Highest: ${stateName(String(top.group['state']))} ${formatEstimate(top.estimate, top.stat)}; lowest: ${stateName(String(bottom.group['state']))} ${formatEstimate(bottom.estimate, bottom.stat)}.`
  })()

  // How the chart is drawn: in its header's toolbar (`inline`), or in
  // the phone's options sheet (ADR-0029).
  // The switch with its reason in view when it is off (F6); on a desktop
  // it sits on its own line under the toolbar's row (G4).
  const adjustSwitch = (row: boolean) => (
    <span className={styles.switch} data-row={row || undefined}>
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
  )

  const chartControls = (inline: boolean, withSwitch = true) => (
    <>
      {statOptions && (
        <RadioRow
          legend="Show"
          name="stat"
          inline={inline}
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
        inline={inline}
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
          inline={inline}
          wide={!inline}
          selectOnNarrow
          options={levels.map((entry) => ({ value: String(entry.value), label: entry.label }))}
          value={String(activeLevel)}
          onChange={(value) => setSearch({ level: Number(value) })}
        />
      )}
      {/* Find a state (F1): picked out on the map and the chart, its card
          held open — view state, not data, so not in the URL. */}
      <label className={inline ? styles.inlineField : styles.field}>
        <span className={styles.fieldLabel}>Find a state</span>
        <select value={found ?? ''} onChange={(event) => find(event.target.value || undefined)}>
          <option value="">Choose a state</option>
          {stateOptions.map((state) => (
            <option key={state.code} value={state.code}>
              {state.name}
            </option>
          ))}
        </select>
      </label>
      {withSwitch && adjustSwitch(false)}
    </>
  )

  // The phone's line: how the chart is drawn, in the controls' words.
  const phoneSummary = stateLine(
    stat === 'proportion' ? 'Share' : stat === 'quantile' ? 'Median' : 'Mean',
    search.view === 'map' ? 'map' : 'chart',
    search.adj && 'adjusted',
    search.view === 'bars' && orderPhrase(dir),
  )

  return (
    <section>
      <h2 className="visually-hidden">US States</h2>
      <p className={styles.deck}>
        {/* What you can see, then what it means for reading it (F18). */}
        <span className={styles.deckLong}>
          How each US state compares with the country as a whole. Smaller states rest on fewer
          people, so their intervals are wider.
        </span>
        <span className={styles.deckShort}>
          How each US state compares with the country as a whole.
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
          note={yearReasonText}
          noteBeside
          value={search.wave}
          onChange={(wave) =>
            setSearch({ wave, adj: adjustedWeightsExist(wave) ? search.adj : undefined })
          }
        />
        {yearNoteText && <p className={styles.barNote}>{yearNoteText}</p>}
      </div>
      {narrow && chartable && (
        <OptionsSheet summary={phoneSummary}>{chartControls(false)}</OptionsSheet>
      )}

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
          {!narrow && <div className={styles.controls}>{chartControls(true)}</div>}
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
            narrowSubtitle={narrowSubtitle}
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
                    {US_OVERALL}: <StatLine row={overallRow} />
                  </p>
                )}
                {nationalNote && (
                  <details className={styles.fold}>
                    <summary>Why two US figures?</summary>
                    <p>
                      The states are estimated on weights made for each state, so the United States
                      overall above is on the same weights — the figure to read them against.{' '}
                      {nationalNote}
                    </p>
                  </details>
                )}
              </>
            }
            toolbar={narrow ? undefined : chartControls(true, false)}
            afterToolbar={narrow ? undefined : adjustSwitch(true)}
            sortHead={
              // The chart's order is its value label's (ADR-0029).
              search.view === 'bars' ? (
                <SortHead
                  names="State"
                  value={stat === 'proportion' ? 'Share' : stat === 'quantile' ? 'Median' : 'Mean'}
                  dir={dir}
                  onToggle={() => setSearch({ dir: reversed(dir) })}
                />
              ) : undefined
            }
            chartKey={
              search.view === 'bars' ? (
                <ChartKey
                  mark={stat === 'proportion' ? 'bar' : 'dot'}
                  label={stat === 'proportion' ? 'share' : stat === 'quantile' ? 'median' : 'mean'}
                  color={outcomeColor(variable.name)}
                  ciLevel={keyCiLevel(displayRows)}
                  thinBelow={keyThinBelow(displayRows, served?.suppression)}
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
                  found={found}
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
                highlightOf={(row) => found !== undefined && row.group['state'] === found}
                pinnedOf={(row) => found !== undefined && row.group['state'] === found}
              />
            )}
          </ChartFigure>
        </>
      ) : null}
    </section>
  )
}
