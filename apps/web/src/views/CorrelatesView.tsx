// Correlates (Phase 6): what goes with a measure. Its views, one on
// screen at a time (`view`, owner decision 25 Sept 2026): the ranked list
// for one country (the server sweeps every other ordered item, ranks by
// strength and cuts the list), the same items across every country, the
// measure beside one other question (Compare two: y's average for each
// answer to x), and a table of several (Compare several: every pair
// among 2–10 questions) — a view that is not on screen mounts nothing
// and fetches nothing beyond the ranked list its defaults come from.
// Correlations are point estimates, so no interval is ever drawn for
// them. The adjusted models are not offered here (ADR-0018). Every number
// is the server's; this view chooses, labels and renders. Associations,
// not causes — said in the deck and in the footnote, in plain sentences.

import { getRouteApi } from '@tanstack/react-router'
import { useId, useMemo } from 'react'
import { predictorOrder, useCorrelates, type CorrelationMethod } from '../api/correlates'
import { useCorrelationTable, usePair } from '../api/correlations'
import { NetworkError } from '../api/errors'
import { useBootStatus, useMeta } from '../api/meta'
import type {
  CorrelationsResponse,
  Country,
  EstimateResponse,
  EstimateRow,
  PairResponse,
  VariableDetail,
  VariableSummary,
  Wave,
} from '../api/types'
import { WAVES } from '../api/types'
import { useVariable, useVariables } from '../api/variables'
import { useWarmApi } from '../api/warm'
import { BinnedScatter, type BinnedPoint } from '../charts/BinnedScatter'
import { ChartFigure } from '../charts/ChartFigure'
import { measureBounds } from '../charts/domain'
import { RankedBar } from '../charts/RankedBar'
import { DIVERGING_RAMP, divergingTint, signMark } from '../charts/theme'
import { HeatTable, intervalText } from '../charts/TransitionTable'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingBlock } from '../components/Loading'
import { InvalidParamsNotice } from '../components/Notice'
import { WordingPanel } from '../components/WordingPanel'
import { Disclosure } from '../components/controls/Disclosure'
import { QuestionSearch } from '../components/controls/QuestionSearch'
import { OutcomePicker } from '../components/controls/OutcomePicker'
import { RadioRow, type RadioOption } from '../components/controls/RadioRow'
import { correlationTableToCsv, downloadTextFile, responseToCsv } from '../export/csv'
import { exportFilename, type ExportName } from '../export/filename'
import { formatCount, formatEstimate } from '../format'
import { groupValueLabel, outcomeLevels } from '../labels'
import { searchNavigation } from '../state/navigate'
import {
  correlatesAcrossCountries,
  correlatesRequest,
  correlatesSearchParams,
  pairRequest,
  tableRequest,
  TABLE_MAX,
  TABLE_MIN,
  type CorrelatesSearch,
  type CorrelatesViewName,
} from '../state/search'
import { NARROW_VIEWPORT, useMediaQuery } from '../useMediaQuery'
import { WAVE_CHIPS, WAVE_TITLES } from '../waves'
import {
  METHOD_HINT,
  acrossSubtitle,
  CORRELATION_SCALE,
  axisEnds,
  belowFloor,
  countriesByName,
  defaultCountry,
  excludedNote,
  heatCells,
  heatKey,
  hollowNote,
  legendEnds,
  methodLabel,
  pairSubtitle,
  pairTip,
  overlapNote,
  pinnedFirst,
  rankedSubtitle,
  rankedTip,
  shortName,
  statisticPhrase,
  tintExtent,
  waveNote,
} from './correlatesRows'
import styles from './AtlasView.module.css'

const route = getRouteApi('/correlates')

/** The one sentence this view owes its reader, in both places. */
const NOT_CAUSES =
  'Associations, not causes: two answers moving together in one survey, at one time, says nothing about which one moves the other.'

/** The Compare with picker's fields, apart from the Measure's. */
const COMPARE_LABELS = {
  topic: 'Compare with: topic',
  subtopic: 'Compare with: subtopic',
  measure: 'Compare with',
  search: 'Or search to compare',
}

const METHOD_OPTIONS: RadioOption<CorrelationMethod>[] = [
  { value: 'pearson', label: 'Straight-line (Pearson)' },
  { value: 'spearman', label: 'By rank (Spearman)' },
]

export function CorrelatesView() {
  useWarmApi()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const meta = useMeta()
  const boot = useBootStatus()
  const variables = useVariables()
  const variable = variables.data?.byName[search.outcome]
  const ordered = variable !== undefined && variable.servable && variable.scale_type !== 'nominal'
  const askedAtWave = ordered && variable.waves_available.includes(search.wave)
  const detailQuery = useVariable(ordered ? search.outcome : null)
  const detail = detailQuery.data?.detail
  const narrow = useMediaQuery(NARROW_VIEWPORT)
  const served = meta.data?.meta
  const country = search.country ?? (served ? defaultCountry(served) : undefined)
  const countries = useMemo(() => (served ? countriesByName(served.countries) : []), [served])
  const chipsLabel = useId()

  const setSearch = (patch: Partial<CorrelatesSearch>) => {
    void navigate(searchNavigation(correlatesSearchParams({ ...search, ...patch })))
  }

  const byName = variables.data?.byName
  // Compare two: the question set beside the measure, else its
  // top-ranked correlate (which needs the ranked list).
  const needsRanked =
    search.view === 'ranked' ||
    search.view === 'countries' ||
    (search.view === 'pair' && search.x === undefined) ||
    (search.view === 'matrix' && search.vars === undefined)
  const rankedRequest =
    askedAtWave && country !== undefined ? correlatesRequest(search, country) : null
  const ranked = useCorrelates(rankedRequest, { enabled: needsRanked })
  const rankedResponse = ranked.data
  const predictors = useMemo(
    () => (rankedResponse ? predictorOrder(rankedResponse.rows) : []),
    [rankedResponse],
  )
  const acrossRequest =
    rankedRequest !== null && predictors.length > 0
      ? correlatesAcrossCountries(search, predictors)
      : null
  const across = useCorrelates(acrossRequest, { enabled: search.view === 'countries' })
  const acrossResponse = across.data
  const rankedRows = rankedResponse?.rows ?? []
  const acrossRows = useMemo(() => acrossResponse?.rows ?? [], [acrossResponse])
  const cells = useMemo(() => heatCells(acrossRows), [acrossRows])
  const xName = search.x ?? predictors[0]
  const xVariable = xName !== undefined ? byName?.[xName] : undefined
  const xUsable =
    xVariable !== undefined &&
    xVariable.servable &&
    xVariable.scale_type !== 'nominal' &&
    xVariable.waves_available.includes(search.wave) &&
    xVariable.name !== search.outcome
  const pair = usePair(
    askedAtWave && country !== undefined && xUsable && xName !== undefined
      ? pairRequest(search, xName, country)
      : null,
    { enabled: search.view === 'pair' },
  )
  // Compare several: the table's questions, else the measure and its
  // top five correlates (after the overlap dedupe) — never empty.
  const tableVars = useMemo(
    () => search.vars ?? (predictors.length > 0 ? [search.outcome, ...predictors.slice(0, 5)] : []),
    [search.vars, search.outcome, predictors],
  )
  const usableVars = useMemo(
    () =>
      tableVars.filter((name) => {
        const candidate = byName?.[name]
        return (
          candidate !== undefined &&
          candidate.servable &&
          candidate.scale_type !== 'nominal' &&
          candidate.waves_available.includes(search.wave)
        )
      }),
    [tableVars, byName, search.wave],
  )
  const leftOut = tableVars.filter((name) => !usableVars.includes(name))
  const table = useCorrelationTable(
    askedAtWave && country !== undefined && usableVars.length >= TABLE_MIN
      ? tableRequest(search, usableVars, country)
      : null,
    { enabled: search.view === 'matrix' },
  )

  if (meta.isPending || variables.isPending) {
    return (
      <section>
        <h2>Correlates</h2>
        <LoadingBlock height={420} label="Loading the Correlates view" />
      </section>
    )
  }
  if (meta.isError || variables.isError || !served || !variables.data) {
    return (
      <section>
        <h2>Correlates</h2>
        <ErrorState apiReachable={boot.apiReachable} error={meta.error ?? variables.error} />
      </section>
    )
  }

  const nameOf = (name: string) => variables.data.byName[name]?.display_name ?? name
  const countryName = country !== undefined ? groupValueLabel('country_code', country, served) : ''
  const title = variable?.display_name ?? search.outcome
  const short = variable ? shortName(variable) : title

  const handlePick = ({ outcome }: { outcome: string }) => {
    const target = variables.data.byName[outcome]
    const waves = target?.waves_available ?? []
    setSearch({
      outcome,
      topic: undefined,
      // Keep the wave when the new measure was asked then; else its first.
      wave: waves.includes(search.wave)
        ? search.wave
        : ((waves[0] as Wave | undefined) ?? search.wave),
      // A new measure starts from its own defaults: its top correlate,
      // its own table.
      x: undefined,
      vars: undefined,
      invalid: undefined,
      invalidRaw: undefined,
    })
  }
  // A wave the compared question was not asked in drops it; the table
  // keeps the questions asked then (its default, when fewer than two).
  const pickWave = (wave: Wave) => {
    const asked = (name: string) =>
      variables.data.byName[name]?.waves_available.includes(wave) ?? false
    const x = search.x !== undefined && asked(search.x) ? search.x : undefined
    const kept = search.vars?.filter(asked)
    setSearch({ wave, x, vars: kept && kept.length >= TABLE_MIN ? kept : undefined })
  }

  const viewOptions: RadioOption<CorrelatesViewName>[] = [
    { value: 'ranked', label: countryName ? `In ${countryName}` : 'In one country' },
    { value: 'countries', label: 'Across countries' },
    { value: 'pair', label: 'Compare two' },
    { value: 'matrix', label: 'Compare several' },
  ]

  // What the measure can be set beside: every other ordered question
  // asked at the wave (the server refuses one built from its answers).
  const pairCandidates = variables.data.list.filter(
    (candidate) =>
      candidate.servable &&
      candidate.scale_type !== 'nominal' &&
      candidate.waves_available.includes(search.wave) &&
      candidate.name !== search.outcome,
  )

  // An option the measure was not asked in stays in the row, disabled,
  // and the line under the row says why.
  const waveOptions: RadioOption<Wave>[] = WAVES.map((wave) => ({
    value: wave,
    label: WAVE_CHIPS[wave] ?? wave,
    disabled: variable !== undefined && !variable.waves_available.includes(wave),
  }))

  // What a download is called, in words (ADR-0016): the ranked list for
  // one country, or the same measures across countries.
  const rankedName: ExportName = {
    measure: title,
    view: 'Correlates',
    waves: WAVE_CHIPS[search.wave] ?? search.wave,
    ...(countryName ? { country: countryName } : {}),
  }
  const acrossName: ExportName = {
    measure: title,
    view: 'Correlates across countries',
    waves: WAVE_CHIPS[search.wave] ?? search.wave,
  }
  const csvFor = (response: EstimateResponse, name: ExportName) => ({
    kind: 'client' as const,
    onDownload: () => downloadTextFile(exportFilename(name, 'csv'), responseToCsv(response)),
  })
  const footnote = (response: EstimateResponse) => {
    const excluded = excludedNote(response.meta)
    return (
      <>
        {NOT_CAUSES} {excluded ? `${excluded} ` : ''}
      </>
    )
  }
  const offline = (error: unknown) =>
    error instanceof NetworkError && !boot.apiReachable ? (
      <p className={styles.hint} role="status">
        This view needs the live data service, which is offline right now — the Atlas and Segments
        still work.
      </p>
    ) : (
      <ErrorState apiReachable={boot.apiReachable} error={error} />
    )
  // The ranked list's rows: each opens Compare two with this measure on
  // y and that row's measure on x.
  const labelOfRow = (row: EstimateRow) => nameOf(row.predictor ?? '')
  const colorOfRow = (row: EstimateRow) => signMark(row.estimate)
  const openPair = (row: EstimateRow) => {
    if (row.predictor) setSearch({ view: 'pair', x: row.predictor })
  }
  const rowName = (row: EstimateRow, label: string) =>
    `${label}, ${formatEstimate(row.estimate, row.stat)}: see it beside ${title}`
  const ends = axisEnds(short)
  const overlap = overlapNote(rankedResponse?.meta.dropped_overlap, variables.data.byName)
  const strongest = rankedRows.find((row) => row.estimate !== null)
  const rankedAria = `${title}: the ${predictors.length} measures most strongly associated with it in ${countryName}, ${WAVE_TITLES[search.wave] ?? search.wave}, ${statisticPhrase(search.method)}.${
    strongest?.predictor
      ? ` Strongest: ${nameOf(strongest.predictor)} ${formatEstimate(strongest.estimate, strongest.stat)}.`
      : ''
  } The data table below carries every number.`

  return (
    <section>
      <h2 className="visually-hidden">Correlates</h2>
      <p className={styles.deck}>
        <span className={styles.deckLong}>
          Pick a question to see which other answers tend to go with it, in one country. Things that
          go together aren&rsquo;t necessarily cause and effect.
        </span>
        <span className={styles.deckShort}>
          Which other answers go with the one you pick, in one country.
        </span>
      </p>
      <InvalidParamsNotice
        invalid={search.invalid}
        onDismiss={() =>
          void navigate(
            searchNavigation(
              correlatesSearchParams({ ...search, invalid: undefined, invalidRaw: undefined }),
              { replace: true },
            ),
          )
        }
      />
      {/* Every control sits under its own label line, so the row aligns
          on the labels and the wave's note hangs below it. */}
      <div className={`${styles.controls} ${styles.controlsTop}`}>
        <OutcomePicker
          variables={variables.data.list}
          value={search.outcome}
          topic={search.topic}
          onSelect={handlePick}
          pairs
        />
        <RadioRow
          legend="Wave"
          name="wave"
          options={waveOptions}
          value={search.wave}
          onChange={pickWave}
          note={variable ? waveNote(variable.waves_available) : undefined}
        />
        <div className={styles.pairRow}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Country</span>
            <select
              value={country ?? ''}
              onChange={(event) =>
                setSearch({
                  country:
                    Number(event.target.value) === defaultCountry(served)
                      ? undefined
                      : Number(event.target.value),
                })
              }
            >
              {countries.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.field}>
            {/* An empty label line keeps the button level with the selects. */}
            <span className={styles.fieldLabel} aria-hidden="true">
              &nbsp;
            </span>
            <Disclosure label={methodLabel(search.method)}>
              <RadioRow<CorrelationMethod>
                legend="Correlation type"
                name="method"
                options={METHOD_OPTIONS}
                value={search.method ?? 'pearson'}
                onChange={(value) =>
                  setSearch({ method: value === 'spearman' ? 'spearman' : undefined })
                }
              />
              <p className={styles.methodHint}>{METHOD_HINT}</p>
            </Disclosure>
          </div>
        </div>
      </div>
      <div className={styles.controls}>
        <RadioRow
          legend="View"
          name="view"
          options={viewOptions}
          value={search.view}
          onChange={(view) => setSearch({ view })}
        />
      </div>
      {search.view === 'matrix' && askedAtWave && tableVars.length > 0 && (
        <div className={`${styles.controls} ${styles.controlsTop}`}>
          <div className={styles.field}>
            <span className={styles.fieldLabel} id={chipsLabel}>
              Questions in this table
            </span>
            <ol className={styles.chips} aria-labelledby={chipsLabel}>
              {usableVars.map((name, index) => (
                <li key={name} className={styles.chip}>
                  <span>
                    {index + 1} · {nameOf(name)}
                  </span>
                  <button
                    type="button"
                    className={styles.chipRemove}
                    aria-label={`Remove ${nameOf(name)}`}
                    disabled={usableVars.length <= TABLE_MIN}
                    onClick={() =>
                      setSearch({ vars: usableVars.filter((entry) => entry !== name) })
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ol>
            {leftOut.length > 0 && (
              <span className={styles.reason}>
                Left out, not asked in {WAVE_TITLES[search.wave] ?? search.wave}:{' '}
                {leftOut.map(nameOf).join(', ')}.
              </span>
            )}
          </div>
          <QuestionSearch
            label="Add a question"
            candidates={pairCandidates.filter((candidate) => !usableVars.includes(candidate.name))}
            onAdd={(name) => setSearch({ vars: [...usableVars, name] })}
            full={usableVars.length >= TABLE_MAX ? `Up to ${TABLE_MAX} questions` : undefined}
          />
        </div>
      )}
      {search.view === 'pair' && askedAtWave && (
        <div className={`${styles.controls} ${styles.controlsTop}`}>
          <OutcomePicker
            variables={pairCandidates}
            value={xName ?? ''}
            onSelect={({ outcome }) => setSearch({ x: outcome })}
            labels={COMPARE_LABELS}
            pairs
          />
          <div className={styles.field}>
            <span className={styles.fieldLabel} aria-hidden="true">
              &nbsp;
            </span>
            <button
              type="button"
              className={styles.swap}
              disabled={!xUsable}
              onClick={() => {
                if (xUsable && xName !== undefined)
                  setSearch({ outcome: xName, x: search.outcome, topic: undefined })
              }}
            >
              <span aria-hidden="true">⇄ </span>Swap
            </button>
          </div>
        </div>
      )}

      {!ordered ? (
        <EmptyState title="Choose a measure to begin">
          <p>
            {variable === undefined
              ? `The link asked for “${search.outcome}”, which isn't in this release's codebook — `
              : variable.scale_type === 'nominal'
                ? `“${title}” is a set of categories with no order, so it has no correlation — `
                : `“${search.outcome}” can't be charted (its codebook entry says why) — `}
            pick a topic and measure above, or search all the measures.
          </p>
        </EmptyState>
      ) : !askedAtWave ? (
        <EmptyState title={`Not asked in ${WAVE_TITLES[search.wave] ?? search.wave}`}>
          <p>
            {title} was asked in{' '}
            {variable.waves_available.map((wave) => WAVE_TITLES[wave] ?? wave).join(' and ')} — pick
            one of those waves above.
          </p>
        </EmptyState>
      ) : search.view === 'matrix' ? (
        search.vars === undefined && ranked.isPending ? (
          <LoadingBlock height={420} label="Loading the ranked list" />
        ) : search.vars === undefined && ranked.isError ? (
          offline(ranked.error)
        ) : usableVars.length < TABLE_MIN ? (
          <EmptyState title="Pick two questions or more">
            <p>
              A table needs at least two questions asked in{' '}
              {WAVE_TITLES[search.wave] ?? search.wave} — add them under “Add a question”.
            </p>
          </EmptyState>
        ) : table.isPending ? (
          <LoadingBlock height={420} label="Loading the table" />
        ) : table.isError ? (
          offline(table.error)
        ) : table.data ? (
          <TableFigure
            table={table.data}
            vars={usableVars}
            nameOf={nameOf}
            countryName={countryName}
            wave={search.wave}
            method={search.method}
            isRefreshing={table.isPlaceholderData}
            served={served}
            onOpenPair={(y, x) =>
              setSearch({ view: 'pair', outcome: y, x, vars: usableVars, topic: undefined })
            }
          />
        ) : null
      ) : search.view === 'pair' ? (
        search.x === undefined && ranked.isPending ? (
          <LoadingBlock height={420} label="Loading the ranked list" />
        ) : search.x === undefined && ranked.isError ? (
          offline(ranked.error)
        ) : xName === undefined ? (
          <EmptyState title="Nothing to compare with">
            <p>
              No other question has enough respondents in {countryName} to set beside {title} — pick
              another measure or country above.
            </p>
          </EmptyState>
        ) : !xUsable ? (
          <EmptyState title="Pick a question to compare with">
            <p>
              {xVariable === undefined
                ? `The link asked to compare with “${xName}”, which isn't in this release's codebook`
                : xVariable.scale_type === 'nominal'
                  ? `“${xVariable.display_name}” is a set of categories with no order`
                  : xVariable.name === search.outcome
                    ? `That is ${title} itself`
                    : `“${xVariable.display_name}” wasn't asked in ${WAVE_TITLES[search.wave] ?? search.wave}`}{' '}
              — choose another question under “Compare with”.
            </p>
          </EmptyState>
        ) : pair.isPending ? (
          <LoadingBlock height={420} label="Loading the two questions" />
        ) : pair.isError ? (
          offline(pair.error)
        ) : pair.data && variable && xVariable ? (
          <PairFigure
            pair={pair.data}
            y={variable}
            x={xVariable}
            yDetail={detail}
            countryName={countryName}
            wave={search.wave}
            method={search.method}
            isRefreshing={pair.isPlaceholderData}
            served={served}
            csvFor={csvFor}
          />
        ) : null
      ) : ranked.isPending ? (
        <LoadingBlock height={520} label="Loading the ranked list" />
      ) : ranked.isError ? (
        offline(ranked.error)
      ) : rankedResponse && variable ? (
        search.view === 'ranked' ? (
          <>
            <p role="status" className="visually-hidden">
              Updated: {title}, {predictors.length} measures ranked for {countryName}.
            </p>
            <ChartFigure
              title={`What goes with ${title}`}
              subtitle={rankedSubtitle(countryName, search.method, search.wave)}
              ariaLabel={rankedAria}
              marks="dots"
              interactive
              intro={
                <>
                  {detail && (
                    <div className={styles.wording}>
                      <WordingPanel detail={detail} />
                    </div>
                  )}
                  {/* The two hues, said before the rows that wear them. */}
                  <p className={styles.signKey}>
                    <span>
                      <span
                        className={styles.keyDot}
                        style={{ background: signMark(1) }}
                        aria-hidden="true"
                      />
                      Goes with higher {short}
                    </span>
                    <span>
                      <span
                        className={styles.keyDot}
                        style={{ background: signMark(-1) }}
                        aria-hidden="true"
                      />
                      Goes with lower {short}
                    </span>
                  </p>
                </>
              }
              response={rankedResponse}
              meta={served}
              csv={csvFor(rankedResponse, rankedName)}
              exportName={rankedName}
              isRefreshing={ranked.isPlaceholderData}
              predictorLabel={nameOf}
              footnote={
                <>
                  {footnote(rankedResponse)}
                  {overlap ? `${overlap} ` : ''}
                </>
              }
            >
              <RankedBar
                rows={rankedRows}
                meta={served}
                responseMeta={rankedResponse.meta}
                variable={variable}
                color={signMark(1)}
                labelOf={labelOfRow}
                colorOf={colorOfRow}
                zeroRule
                labelFontSize={narrow ? 12 : 13.5}
                fixedScale={CORRELATION_SCALE}
                axisEnds={ends}
                fitLabels
                stackOnNarrow
                tipOf={rankedTip}
                onSelectRow={openPair}
                rowName={rowName}
              />
              <p className={styles.hint}>Select a row to see the two questions together.</p>
            </ChartFigure>
          </>
        ) : predictors.length === 0 ? (
          <EmptyState title="Nothing ranked">
            <p>
              No measure has enough respondents in {countryName} to rank against {title}, so there
              is nothing to set across countries.
            </p>
          </EmptyState>
        ) : across.isPending ? (
          <LoadingBlock height={360} label="Loading the cross-country matrix" />
        ) : across.isError ? (
          offline(across.error)
        ) : acrossResponse ? (
          <ChartFigure
            title={`${title}, across countries`}
            subtitle={acrossSubtitle(predictors.length, countryName, search.wave, search.method)}
            ariaLabel={`${title}: the ${predictors.length} measures ranked for ${countryName}, in each of ${served.countries.length} countries, as a matrix — ${countryName} first, the rest A to Z. Rust cells go with lower ${short}, teal cells with higher; the data table below carries every number.`}
            marks="table"
            response={acrossResponse}
            meta={served}
            csv={csvFor(acrossResponse, acrossName)}
            exportName={acrossName}
            isRefreshing={across.isPlaceholderData}
            predictorLabel={nameOf}
            footnote={footnote(acrossResponse)}
            wide
          >
            <CountryMatrix
              predictors={predictors}
              rows={acrossRows}
              cells={cells}
              minN={acrossResponse.meta.min_n}
              nameOf={nameOf}
              countries={pinnedFirst(served.countries, country)}
              chosen={country}
              short={short}
            />
          </ChartFigure>
        ) : null
      ) : null}
    </section>
  )
}

/** Compare two: the measure's average (or share answering yes) for each
 * answer to the compared question — or each range of a long one — as a
 * binned scatter, with its data table and downloads. */
function PairFigure({
  pair,
  y,
  x,
  yDetail,
  countryName,
  wave,
  method,
  isRefreshing,
  served,
  csvFor,
}: {
  pair: PairResponse
  y: VariableSummary
  x: VariableSummary
  yDetail: VariableDetail | undefined
  countryName: string
  wave: Wave
  method: CorrelationMethod | undefined
  isRefreshing: boolean
  served: NonNullable<ReturnType<typeof useMeta>['data']>['meta']
  csvFor: (
    response: EstimateResponse,
    name: ExportName,
  ) => {
    kind: 'client'
    onDownload: () => void
  }
}) {
  const binary = pair.means.meta.stat === 'proportion'
  const binned = pair.grouping === 'bins'
  const yShort = shortName(y)
  const points: BinnedPoint[] = useMemo(
    () =>
      pair.groups.flatMap((group, index) => {
        const row = pair.means.rows[index]
        return row
          ? [
              {
                key: String(index),
                label: group.label,
                row,
                share: group.share,
                hollow: group.below_min_n,
              },
            ]
          : []
      }),
    [pair],
  )
  // Up is always more of what the measure names: a descending item's
  // axis runs from its highest code up to its lowest (its means stay as
  // coded), and the label above the axis says, in the item's own words,
  // what the top is.
  const reverse = y.polarity === 'descending' && !binary
  // A derived score's "value labels" are its histogram bins, not words.
  const levels = y.is_derived ? [] : outcomeLevels(yDetail)
  const topLabel = (reverse ? levels[0] : levels[levels.length - 1])?.label.trim()
  const yLabel = binary ? '↑ % answering yes' : topLabel ? `↑ ${topLabel}` : `↑ higher ${yShort}`
  const bounds = measureBounds(pair.means.meta.stat, y) ?? [0, 10]
  const tipOf = useMemo(
    () => (point: BinnedPoint) => pairTip(point, { yShort, binary, binned }),
    [yShort, binary, binned],
  )
  const minN = pair.means.meta.min_n ?? 0
  const hollow = hollowNote(
    points.filter((point) => point.hollow).map((point) => point.label),
    minN,
    binned,
  )
  const labelByCode = new Map(pair.groups.map((group) => [String(group.code), group.label]))
  const name: ExportName = {
    measure: y.display_name,
    view: `Compared with ${x.display_name}`,
    waves: WAVE_CHIPS[wave] ?? wave,
    ...(countryName ? { country: countryName } : {}),
  }
  const first = points.find((point) => point.row.estimate !== null)
  const last = [...points].reverse().find((point) => point.row.estimate !== null)
  const valueOf = (point: BinnedPoint) => formatEstimate(point.row.estimate, point.row.stat)
  const ariaLabel = `${y.display_name} by ${x.display_name} in ${countryName}: ${
    binary ? 'the share answering yes' : `the average ${y.display_name}`
  } for each of ${points.length} ${binned ? 'ranges' : 'answers'} of ${x.display_name}${
    first && last
      ? `, from ${first.label} (${valueOf(first)}) to ${last.label} (${valueOf(last)})`
      : ''
  }; correlation ${formatEstimate(pair.correlation.estimate, pair.correlation.stat)}. The data table below carries every number.`
  return (
    <ChartFigure
      title={`${y.display_name} by ${x.display_name}`}
      subtitle={pairSubtitle({
        countryName,
        wave,
        y: y.display_name,
        x: x.display_name,
        binary,
        binned,
        correlation: pair.correlation,
        method,
      })}
      ariaLabel={ariaLabel}
      marks="dots"
      intro={
        <p className={styles.sizeKey}>
          <span className={styles.sizeDots} aria-hidden="true">
            <span />
            <span />
          </span>
          {binned
            ? 'Larger dot = more people in that range'
            : 'Larger dot = more people gave that answer'}
        </p>
      }
      response={pair.means}
      meta={served}
      csv={csvFor(pair.means, name)}
      exportName={name}
      isRefreshing={isRefreshing}
      groupLabel={(column, value) =>
        column === x.name ? labelByCode.get(String(value)) : undefined
      }
      columnName={(column) => (column === x.name ? x.display_name : undefined)}
      footnote={
        <>
          Each dot is an average of people&rsquo;s answers, not individual people. Associations
          aren&rsquo;t cause and effect. {hollow ? `${hollow} ` : ''}
        </>
      }
    >
      <BinnedScatter
        points={points}
        yDomain={bounds[0] === bounds[1] ? [bounds[0], bounds[0] + 1] : bounds}
        reverse={reverse}
        yLabel={yLabel}
        tipOf={tipOf}
      />
    </ChartFigure>
  )
}

/** Compare several: every pair among the table's questions as a
 * lower-triangle matrix — rows "1 · name", columns numbered (their full
 * names in the tooltip and the accessible name) — tinted on the
 * diverging ramp; a pair built from the same answers reads a muted "·",
 * one resting on too few people a muted "—"; selecting a cell opens
 * Compare two with that pair (row on y, column on x). */
function TableFigure({
  table,
  vars,
  nameOf,
  countryName,
  wave,
  method,
  isRefreshing,
  served,
  onOpenPair,
}: {
  table: CorrelationsResponse
  vars: readonly string[]
  nameOf: (name: string) => string
  countryName: string
  wave: Wave
  method: CorrelationMethod | undefined
  isRefreshing: boolean
  served: NonNullable<ReturnType<typeof useMeta>['data']>['meta']
  onOpenPair: (y: string, x: string) => void
}) {
  const pairs = new Map(table.pairs.map((pair) => [`${pair.a}|${pair.b}`, pair]))
  const counted = table.pairs.flatMap((pair) =>
    pair.correlation && !pair.below_min_n ? [pair.correlation] : [],
  )
  const extent = tintExtent(counted)
  const minN = table.meta.min_n
  const name: ExportName = {
    measure: `Correlations among ${vars.length} questions`,
    view: 'Compare several',
    waves: WAVE_CHIPS[wave] ?? wave,
    ...(countryName ? { country: countryName } : {}),
  }
  // The data table: one row per pair with a correlation, named in words.
  const response: EstimateResponse = {
    meta: {
      data_version: table.meta.data_version,
      outcome: table.meta.vars.join(','),
      scale_type: 'correlation table',
      direction: 'none',
      stat: table.meta.stat,
      waves: [table.meta.wave],
      scope: 'global',
      oriented: false,
      weight_key: table.meta.weight_key,
      weight: table.meta.weight,
      se_method: 'none',
      ci_level: table.meta.ci_level,
      suppression: table.meta.suppression,
      n_frame: table.meta.n_frame,
      // (Not shown: each pair's own n is on its row.)
      n_valid: 0,
      by: ['question', 'with'],
      filters: table.meta.filters,
      min_n: minN,
    },
    rows: table.pairs.flatMap((pair) =>
      pair.correlation
        ? [{ ...pair.correlation, predictor: null, group: { question: pair.b, with: pair.a } }]
        : [],
    ),
  }
  const strongest = [...counted].sort(
    (a, b) => Math.abs(b.estimate ?? 0) - Math.abs(a.estimate ?? 0),
  )[0]
  const strongestPair = strongest
    ? table.pairs.find((pair) => pair.correlation === strongest)
    : undefined
  return (
    <ChartFigure
      title={`Correlations among ${vars.length} questions`}
      subtitle={`${countryName} · ${WAVE_TITLES[wave] ?? wave} · ${statisticPhrase(method)}`}
      ariaLabel={`Correlations among ${vars.length} questions in ${countryName}, as a table: ${vars
        .map((entry, index) => `${index + 1}, ${nameOf(entry)}`)
        .join('; ')}.${
        strongestPair && strongest
          ? ` Strongest: ${nameOf(strongestPair.a)} and ${nameOf(strongestPair.b)}, ${formatEstimate(strongest.estimate, strongest.stat)}.`
          : ''
      } Select a cell to see the two questions together; the data table below carries every number.`}
      marks="table"
      interactive
      response={response}
      meta={served}
      csv={{
        kind: 'client',
        onDownload: () =>
          downloadTextFile(exportFilename(name, 'csv'), correlationTableToCsv(table)),
      }}
      exportName={name}
      isRefreshing={isRefreshing}
      groupLabel={(column, value) =>
        column === 'question' || column === 'with' ? nameOf(String(value)) : undefined
      }
      columnName={(column) =>
        column === 'question' ? 'Question' : column === 'with' ? 'Correlated with' : undefined
      }
      footnote={<>{NOT_CAUSES} </>}
    >
      <HeatTable
        caption={
          <DivergingLegend
            extent={extent}
            stat={table.meta.stat}
            hues="rust: as one goes up, the other goes down · teal: they go up together"
            extra="· built from the same answers"
          />
        }
        corner="Question ↓ · with →"
        rows={vars.map((entry, index) => ({
          key: entry,
          label: `${index + 1} · ${nameOf(entry)}`,
        }))}
        columns={vars.map((entry, index) => ({
          key: entry,
          label: String(index + 1),
          title: `${index + 1} · ${nameOf(entry)}`,
        }))}
        cellAt={(row, column) => {
          const i = vars.indexOf(row.key)
          const j = vars.indexOf(column.key)
          if (j >= i) return { text: '', title: '', tint: 'transparent', blank: true }
          const pair = pairs.get(`${column.key}|${row.key}`)
          if (!pair) return undefined
          const [y, x] = [nameOf(row.key), nameOf(column.key)]
          if (pair.shares_answers || !pair.correlation) {
            return {
              text: '·',
              title: `${y} · ${x}\nBuilt from the same answers: not correlated`,
              tint: 'transparent',
              muted: true,
              hidden: ', built from the same answers',
            }
          }
          const correlation = pair.correlation
          const value = formatEstimate(correlation.estimate, correlation.stat)
          const people = `${formatCount(correlation.n)} people answered both`
          const muted = pair.below_min_n
          return {
            text: muted ? '—' : value,
            title: muted
              ? `Too few respondents (fewer than ${formatCount(minN)})\n${value}  ${y} · ${x}\n${people}`
              : `${value}  ${y} · ${x}\n${people}`,
            tint: divergingTint(correlation.estimate, extent),
            muted,
            hidden: muted ? ', too few respondents' : undefined,
            onSelect: () => onOpenPair(row.key, column.key),
            name: `${y} and ${x}, ${muted ? 'too few respondents' : value}: see the two questions together`,
          }
        }}
      />
      <p className={styles.hint}>Select a cell to see the two questions together.</p>
    </ChartFigure>
  )
}

/** The key to a diverging matrix, in its caption's place (outside the
 * scroll box, regular weight): the eleven ramp tokens between the
 * window's two ends — the tokens themselves, so it reads true in either
 * theme — what the two hues mean, and the dash. */
export function DivergingLegend({
  extent,
  stat,
  short,
  hues,
  extra,
}: {
  extent: number
  stat: string
  /** The measure the hues are read against ("goes with higher …"). */
  short?: string
  /** The hues in words when there is no one measure (Compare several). */
  hues?: string
  /** One more entry after the dash's (Compare several's "·"). */
  extra?: string
}) {
  const [lo, hi] = legendEnds(extent, stat)
  return (
    <span className={`${styles.legend} ${styles.legendRow}`}>
      <span className={styles.legendKey}>
        <span>{lo}</span>
        <span className={`${styles.ramp} ${styles.rampFramed}`} aria-hidden="true">
          {DIVERGING_RAMP.map((token) => (
            <span key={token} style={{ background: token }} />
          ))}
        </span>
        <span>{hi}</span>
      </span>
      <span>
        {hues ?? `rust: goes with lower ${short ?? ''} · teal: goes with higher ${short ?? ''}`}
      </span>
      <span>— too few respondents</span>
      {extra && <span>{extra}</span>}
    </span>
  )
}

function CountryMatrix({
  predictors,
  rows,
  cells,
  minN,
  nameOf,
  countries,
  chosen,
  short,
}: {
  predictors: readonly string[]
  rows: readonly EstimateRow[]
  cells: Map<string, EstimateRow>
  /** The server's ranking floor: cells below it read a muted "—". */
  minN: number | null | undefined
  nameOf: (name: string) => string
  /** The columns: the chosen country, then the rest A–Z. */
  countries: readonly Country[]
  chosen: number | undefined
  short: string
}) {
  // The tint window fits the cells that count; a cell below the floor
  // reads a muted dash, its number in the tooltip and the data table.
  const ranked = rows.filter((row) => !belowFloor(row, minN))
  const extent = tintExtent(ranked)
  const stat = rows[0]?.stat ?? 'pearson_r'
  return (
    <HeatTable
      caption={<DivergingLegend extent={extent} stat={stat} short={short} />}
      corner="Measure ↓ · country →"
      rows={predictors.map((name) => ({ key: name, label: nameOf(name) }))}
      columns={countries.map((country) => ({
        key: String(country.code),
        label: country.name,
      }))}
      highlight={chosen !== undefined ? String(chosen) : undefined}
      wide
      cellAt={(row, column) => {
        const country = countries.find((entry) => String(entry.code) === column.key)
        const cell = country ? cells.get(heatKey(row.key, country)) : undefined
        if (!cell) return undefined
        const muted = belowFloor(cell, minN)
        return {
          text: muted ? '—' : formatEstimate(cell.estimate, cell.stat),
          title: muted
            ? `Too few respondents to rank (fewer than ${formatCount(minN ?? 0)})\n${formatEstimate(cell.estimate, cell.stat)}  ${row.label} · ${column.label}\n${intervalText(cell)}`
            : `${formatEstimate(cell.estimate, cell.stat)}  ${row.label} · ${column.label}\n${intervalText(cell)}`,
          tint: divergingTint(cell.estimate, extent),
          hidden: muted ? ', too few respondents' : undefined,
          muted,
        }
      }}
    />
  )
}
