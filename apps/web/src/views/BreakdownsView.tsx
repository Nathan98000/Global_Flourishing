// Breakdowns (§2.6), shown to readers as Segments at /segments
// (ADR-0017): outcome × one demographic as small multiples by
// country, sortable, every cell shown with its n. A second breakdown —
// another demographic, or one categorical survey variable — is answered
// by the live service only (the static tier facets by one demographic).

import { getRouteApi } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useEstimates } from '../api/estimates'
import { NetworkError } from '../api/errors'
import { useBootStatus, useMeta } from '../api/meta'
import type { Stat } from '../api/types'
import { useVariable, useVariables } from '../api/variables'
import { ChartFigure, type CsvExport } from '../charts/ChartFigure'
import { ChartKey } from '../charts/ChartKey'
import type { LevelLabeler } from '../charts/DotPlot'
import { SmallMultiples, countryEstimates, facetOrder } from '../charts/SmallMultiples'
import { summarizeCells } from '../charts/summary'
import { outcomeColor } from '../charts/theme'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { PagePlaceholder } from '../components/PagePlaceholder'
import { LoadingBlock } from '../components/Loading'
import { InvalidParamsNotice } from '../components/Notice'
import { OfflineLine } from '../components/StillWorks'
import { WordingPanel } from '../components/WordingPanel'
import { CountryFilter } from '../components/controls/CountryFilter'
import { OptionsSheet } from '../components/controls/OptionsSheet'
import { QuestionPicker } from '../components/controls/QuestionPicker'
import { RadioRow, type RadioOption } from '../components/controls/RadioRow'
import { csvLabels, downloadTextFile, responseToCsv } from '../export/csv'
import { exportFilename, type ExportName } from '../export/filename'
import {
  columnLabel,
  groupValueLabel,
  lowerFirst,
  highestLevel,
  levelDomain,
  outcomeLevels,
  scaleSubtitle,
} from '../labels'
import { DEFAULT_DIR, VALUE_ORDER, sortBreakdownRows } from '../sortRows'
import { searchNavigation } from '../state/navigate'
import { useNearestAskedYear, withMovedYear } from '../state/nearestYear'
import {
  BREAKDOWNS_DEFAULTS,
  breakdownsRequest,
  breakdownsSearchParams,
  type BreakdownsSearch,
} from '../state/search'
import { NARROW_VIEWPORT, useMediaQuery } from '../useMediaQuery'
import { WAVE_CHIPS, WAVE_TITLES, yearNote, yearReason } from '../waves'
import styles from './AtlasView.module.css'
import {
  countOf,
  countriesPhrase,
  keyCiLevel,
  keyThinBelow,
  noAnswers,
  noAnswersLine,
  orderPhrase,
  stateLine,
  updatedLine,
} from './viewState'

const route = getRouteApi('/segments')

export function BreakdownsView() {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const meta = useMeta()
  const boot = useBootStatus()
  const variables = useVariables()
  const variable = variables.data?.byName[search.outcome]
  const chartable = variable !== undefined && variable.servable
  const detailQuery = useVariable(chartable ? search.outcome : null)
  const detail = detailQuery.data?.detail

  const primary = search.by[0] ?? BREAKDOWNS_DEFAULTS.by[0] ?? 'age_band'
  const secondary = search.by[1]
  const secondaryIsVariable = Boolean(secondary && variables.data?.byName[secondary] !== undefined)
  const secondaryDetailQuery = useVariable(secondaryIsVariable ? (secondary as string) : null)
  const secondaryDetail = secondaryDetailQuery.data?.detail

  const setSearch = (patch: Partial<BreakdownsSearch>) => {
    void navigate(searchNavigation(breakdownsSearchParams({ ...search, ...patch })))
  }

  const isCategorical = variable?.default_stat === 'proportion'
  const outcomeLevelOptions = useMemo(() => outcomeLevels(detail), [detail])
  const activeLevel = search.level ?? outcomeLevelOptions[0]?.value
  const levelLabel = outcomeLevelOptions.find((entry) => entry.value === activeLevel)?.label

  // A link's year the question wasn't asked in opens the nearest one it
  // was, with the link notice (H14) — no request for the year it lacks.
  const yearMove = useNearestAskedYear(
    search.wave,
    chartable ? variable.waves_available : undefined,
    (wave) =>
      void navigate(
        searchNavigation(breakdownsSearchParams({ ...search, wave }), { replace: true }),
      ),
  )
  const yearAsked = chartable && variable.waves_available.includes(search.wave)
  const request = yearAsked ? breakdownsRequest(search, variable) : null
  const estimates = useEstimates(request)
  const response = estimates.data?.response
  // Each country's own estimate, the same question, year and statistic —
  // the Atlas's file — orders the panels (ADR-0031): never an average of
  // the groups, which a one-person group could swing.
  const countryRequest = request ? { ...request, by: ['country_code'] } : null
  const countryQuery = useEstimates(countryRequest)
  const countryRows = countryQuery.data?.response.rows
  const dir = search.dir ?? DEFAULT_DIR
  const metaForSort = meta.data?.meta
  const narrow = useMediaQuery(NARROW_VIEWPORT)
  // On a phone with two splits, one country at a time (H11): the one in
  // view, stepped from the summary line — view state, not in the URL.
  const [stepCountry, setStepCountry] = useState<string | undefined>()

  // Level labels for a variable-valued second dimension come from that
  // variable's own value labels (server truth, fetched once).
  const labeler: LevelLabeler | undefined = useMemo(() => {
    if (!secondaryIsVariable || !secondaryDetail) return undefined
    const levels = new Map(
      outcomeLevels(secondaryDetail).map((level) => [level.value, level.label]),
    )
    return (column, value) =>
      column === secondaryDetail.name && typeof value === 'number' ? levels.get(value) : undefined
  }, [secondaryIsVariable, secondaryDetail])

  const displayRows = useMemo(() => {
    if (!response) return []
    let rows = response.rows
    if (isCategorical) {
      const level = activeLevel ?? highestLevel(rows)
      if (level !== undefined) rows = rows.filter((row) => row.level === level)
    }
    if (search.countries.length) {
      rows = rows.filter((row) => search.countries.includes(Number(row.group['country_code'])))
    }
    // One ordering for the panels and the CSV (items 5/13): the
    // facet order the chart is handed, then the served level order.
    if (!metaForSort) return rows
    const served = metaForSort
    const overall = countryRows
      ? countryEstimates(countryRows, served, isCategorical ? activeLevel : undefined)
      : undefined
    return sortBreakdownRows(
      rows,
      served,
      (input) => facetOrder(input, served, 'country_code', search.sort, dir, overall),
      (row) => groupValueLabel(primary, row.group[primary] ?? null, served, labeler),
      levelDomain(primary, served, detail),
    )
  }, [
    response,
    countryRows,
    isCategorical,
    activeLevel,
    search.countries,
    metaForSort,
    search.sort,
    dir,
    primary,
    labeler,
    detail,
  ])
  // The panels in that same order: each country once, as the rows run.
  const panelOrder = useMemo(() => {
    if (!metaForSort) return undefined
    const served = metaForSort
    return [
      ...new Set(
        displayRows.map((row) =>
          groupValueLabel('country_code', row.group['country_code'] ?? null, served),
        ),
      ),
    ]
  }, [displayRows, metaForSort])

  // The countries one at a time on a phone with two splits, in the
  // chosen order (H11): about 22 screens became one country's panel.
  const stepped = narrow && secondary !== undefined && (panelOrder?.length ?? 0) > 1
  const stepAt = stepped ? Math.max(0, panelOrder?.indexOf(stepCountry ?? '') ?? 0) : 0
  const shownCountry = stepped ? panelOrder?.[stepAt] : undefined
  const chartRows =
    shownCountry !== undefined && metaForSort
      ? displayRows.filter(
          (row) =>
            groupValueLabel('country_code', row.group['country_code'] ?? null, metaForSort) ===
            shownCountry,
        )
      : displayRows

  if (meta.isPending || variables.isPending) {
    return (
      <section>
        <h2 className="visually-hidden">Segments</h2>
        <PagePlaceholder label="Loading segments" />
      </section>
    )
  }
  if (meta.isError || variables.isError || !meta.data || !variables.data) {
    return (
      <section>
        <h2>Segments</h2>
        <ErrorState apiReachable={boot.apiReachable} error={meta.error ?? variables.error} />
      </section>
    )
  }

  const handlePick = ({ outcome }: { outcome: string }) => {
    const target = variables.data.byName[outcome]
    const wave =
      target && !target.waves_available.includes(search.wave)
        ? (target.waves_available[0] as BreakdownsSearch['wave'] | undefined)
        : search.wave
    setSearch({
      outcome,
      topic: undefined,
      wave: wave ?? search.wave,
      level: undefined,
      invalid: undefined,
      invalidRaw: undefined,
    })
  }

  const demographics = meta.data.meta.breakdowns.filter((column) => column !== 'country_code')
  const demographicOptions: RadioOption<string>[] = demographics.map((column) => ({
    value: column,
    label: columnLabel(column, meta.data.meta),
  }))
  const categoricalVariables = variables.data.list.filter(
    (candidate) =>
      candidate.servable &&
      !candidate.is_derived &&
      candidate.default_stat === 'proportion' &&
      candidate.name !== search.outcome,
  )

  const waveOptions: RadioOption<BreakdownsSearch['wave']>[] = meta.data.meta.waves.map((wave) => ({
    value: wave as BreakdownsSearch['wave'],
    label: WAVE_CHIPS[wave] ?? wave,
    disabled: variable ? !variable.waves_available.includes(wave) : false,
  }))
  // Why a year is unavailable, or what Midyear is: under the whole bar.
  const yearNoteText = yearNote(waveOptions)
  const yearReasonText = yearReason(waveOptions)

  // The title names the splits in words ("Life satisfaction by gender
  // and age band"); the wave rides last in the subtitle (§7).
  const title = `${variable?.display_name ?? search.outcome} by ${[primary, secondary]
    .filter((column): column is string => column !== undefined)
    .map((column) => lowerFirst(columnLabel(column, meta.data.meta)))
    .join(' and ')}`
  const stat: Stat = (variable?.default_stat as Stat | undefined) ?? 'mean'
  // The state, in the controls' words (ADR-0029): the year, the
  // countries, their order.
  const units = isCategorical
    ? levelLabel
      ? `share answering “${levelLabel}”`
      : null
    : variable
      ? scaleSubtitle(variable, stat, detail)
      : null
  const waveTitle = WAVE_TITLES[search.wave] ?? search.wave
  const subtitle = stateLine(
    units,
    waveTitle,
    countriesPhrase(search.countries.length, meta.data.meta.countries.length),
    search.sort === 'gap' ? 'biggest gap first' : orderPhrase(dir),
  )
  // On a phone the summary line says the countries and the order (G3).
  const narrowSubtitle = stateLine(units, waveTitle)

  // What a download is called, in words (ADR-0016): the measure, then
  // `by-<breakdown>` for the split; the server names its CSV the same way.
  const exportName: ExportName = {
    measure: variable?.display_name ?? search.outcome,
    view: 'By country',
    waves: WAVE_CHIPS[search.wave] ?? search.wave,
    breakdown: search.by.map((column) => columnLabel(column, meta.data.meta)).join(' and '),
  }
  // The CSV is the chart's own rows (G8): the countries chosen, in the
  // chart's order, each code followed by its words — whichever tier
  // answered.
  const csv: CsvExport | undefined =
    request === null || !response
      ? undefined
      : {
          kind: 'client',
          onDownload: () =>
            downloadTextFile(
              exportFilename(exportName, 'csv'),
              responseToCsv({ ...response, rows: displayRows }, csvLabels(meta.data.meta)),
            ),
        }

  // The split, sorts, country filter and answer level fold into a
  // disclosure under 40rem (§8), Topic + search first inside it;
  // Measure, Wave and the breakdown itself stay visible.
  // "Split by [ ] then by [ ]": the second split's label above its select,
  // as every other label is (F15).
  const thenBy = (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>then by</span>
      <select
        value={secondary ?? ''}
        onChange={(event) =>
          setSearch({
            by: event.target.value ? [primary, event.target.value] : [primary],
          })
        }
      >
        <option value="">Nothing</option>
        <optgroup label="demographics">
          {demographics
            .filter((column) => column !== primary)
            .map((column) => (
              <option key={column} value={column}>
                {columnLabel(column, meta.data.meta)}
              </option>
            ))}
        </optgroup>
        <optgroup label="survey variables">
          {categoricalVariables.map((candidate) => (
            <option key={candidate.name} value={candidate.name}>
              {candidate.display_name}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  )
  const countryFilter = (
    <CountryFilter
      countries={meta.data.meta.countries}
      selected={search.countries}
      onChange={(countries) => setSearch({ countries })}
    />
  )
  // How the chart is drawn, in its header's toolbar (ADR-0029): the
  // panels have no value column to sort from, so one "Order countries"
  // select writes `sort` and `dir` — by value either way, or by the gap.
  // One country needs no order (H17).
  const oneCountry = (panelOrder?.length ?? 0) === 1
  const chartControls = (inline: boolean) => (
    <>
      {!oneCountry && (
        <label className={inline ? styles.inlineField : styles.field}>
          <span className={styles.fieldLabel}>Order countries</span>
          <select
            value={search.sort === 'gap' ? 'gap' : dir}
            onChange={(event) => {
              const value = event.target.value
              setSearch(
                value === 'gap'
                  ? { sort: 'gap', dir: undefined }
                  : { sort: 'estimate', dir: value === 'asc' ? 'asc' : undefined },
              )
            }}
          >
            {VALUE_ORDER.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            <option value="gap">Biggest gap first</option>
          </select>
        </label>
      )}
      {isCategorical && outcomeLevelOptions.length > 0 && (
        <RadioRow
          legend="Showing % who said"
          name="outcome-level"
          inline={inline}
          wide={!inline}
          selectOnNarrow
          options={outcomeLevelOptions.map((entry) => ({
            value: String(entry.value),
            label: entry.label,
          }))}
          value={String(activeLevel)}
          onChange={(value) => setSearch({ level: Number(value) })}
        />
      )}
    </>
  )
  // The phone's line: how the chart is drawn, in the controls' words —
  // or, with two splits, which country is in view, stepped from it.
  const panels = panelOrder ?? []
  const phoneSummary =
    stepped && shownCountry !== undefined ? (
      <span className={styles.stepper}>
        <button
          type="button"
          className={styles.step}
          aria-label="Previous country"
          disabled={stepAt === 0}
          onClick={() => setStepCountry(panels[stepAt - 1])}
        >
          ‹
        </button>
        <span aria-live="polite">
          {shownCountry} · {stepAt + 1} of {panels.length}
        </span>
        <button
          type="button"
          className={styles.step}
          aria-label="Next country"
          disabled={stepAt === panels.length - 1}
          onClick={() => setStepCountry(panels[stepAt + 1])}
        >
          ›
        </button>
      </span>
    ) : (
      stateLine(
        isCategorical ? 'Share' : 'Mean',
        countriesPhrase(search.countries.length, meta.data.meta.countries.length),
        search.sort === 'gap' ? 'biggest gap first' : orderPhrase(dir),
      )
    )

  return (
    <section>
      <h2 className="visually-hidden">Segments</h2>
      <p className={styles.deck}>
        {/* What you can see, then how it is laid out (F18). */}
        <span className={styles.deckLong}>
          One question, split into groups of people — by age, gender, income and more — country by
          country.
        </span>
        <span className={styles.deckShort}>
          One question, split into groups of people, country by country.
        </span>
      </p>
      <InvalidParamsNotice
        invalid={withMovedYear(search.invalid, yearMove.moved)}
        onDismiss={() => {
          yearMove.dismiss()
          void navigate(
            searchNavigation(
              breakdownsSearchParams({ ...search, invalid: undefined, invalidRaw: undefined }),
              { replace: true },
            ),
          )
        }}
      />
      {/* The question bar (ADR-0029): what — the question and its split —
          then when and where. */}
      <div className={styles.questionBar} data-bar="question">
        <QuestionPicker
          variant="field"
          label="Question"
          variables={variables.data.list}
          wave={search.wave}
          value={search.outcome}
          topic={search.topic}
          fieldWidth="18rem"
          onPick={(outcome) => handlePick({ outcome })}
        />
        <RadioRow
          legend="Split by"
          name="by"
          wide
          selectOnNarrow
          options={demographicOptions}
          value={primary}
          onChange={(column) => setSearch({ by: secondary ? [column, secondary] : [column] })}
        />
        {thenBy}
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
          <CountryFilter
            variant="panel"
            countries={meta.data.meta.countries}
            selected={search.countries}
            onChange={(countries) => setSearch({ countries })}
          />
          {chartControls(false)}
        </OptionsSheet>
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
      ) : (
        <>
          {estimates.isPending || countryQuery.isPending ? (
            <LoadingBlock height={420} label="Loading estimates" />
          ) : estimates.isError ? (
            estimates.error instanceof NetworkError && !boot.apiReachable ? (
              <OfflineLine except="/segments" className={styles.hint} />
            ) : (
              <ErrorState apiReachable={boot.apiReachable} error={estimates.error} />
            )
          ) : response && variable && noAnswers(search.countries, displayRows) ? (
            <EmptyState
              title={noAnswersLine(
                search.countries.map((code) =>
                  groupValueLabel('country_code', code, meta.data.meta),
                ),
              )}
            >
              <p>Choose other countries with Countries{narrow ? ' in Options' : ''}.</p>
            </EmptyState>
          ) : response && variable ? (
            <>
              <p role="status" className="visually-hidden">
                {updatedLine(
                  title,
                  subtitle,
                  countOf(panelOrder?.length ?? 0, 'countries'),
                  countOf(displayRows.length, 'groups'),
                )}
              </p>
              <ChartFigure
                title={title}
                subtitle={subtitle}
                narrowSubtitle={narrowSubtitle}
                ariaLabel={summarizeCells(
                  displayRows,
                  (row) =>
                    [
                      groupValueLabel(
                        'country_code',
                        row.group['country_code'] ?? null,
                        meta.data.meta,
                      ),
                      ...[primary, secondary]
                        .filter((column): column is string => column !== undefined)
                        .map((column) =>
                          groupValueLabel(
                            column,
                            row.group[column] ?? null,
                            meta.data.meta,
                            labeler,
                          ),
                        ),
                    ].join(', '),
                  `${title} (${subtitle}): one panel per country, a row per ${lowerFirst(columnLabel(primary, meta.data.meta))}${secondary ? `, a column per ${lowerFirst(columnLabel(secondary, meta.data.meta))}` : ''}.`,
                )}
                intro={
                  detail && (
                    <div className={styles.wording}>
                      <WordingPanel detail={detail} />
                    </div>
                  )
                }
                toolbar={narrow ? undefined : chartControls(true)}
                chartKey={
                  <ChartKey
                    mark="dot"
                    label={isCategorical ? 'share' : 'mean'}
                    color={outcomeColor(variable.name)}
                    ciLevel={keyCiLevel(displayRows)}
                    thinBelow={keyThinBelow(displayRows, meta.data.meta.suppression)}
                  />
                }
                csv={csv}
                exportName={exportName}
                isRefreshing={estimates.isPlaceholderData}
                // Each panel's groups are read by keyboard (ADR-0032, ADR-0033).
                interactive
              >
                <SmallMultiples
                  rows={chartRows}
                  meta={meta.data.meta}
                  responseMeta={response.meta}
                  variable={variable}
                  color={outcomeColor(variable.name)}
                  levelColumn={primary}
                  levelDomain={levelDomain(primary, meta.data.meta)}
                  seriesColumn={secondary}
                  seriesDomain={
                    secondary ? levelDomain(secondary, meta.data.meta, secondaryDetail) : undefined
                  }
                  facetDomain={shownCountry !== undefined ? [shownCountry] : panelOrder}
                  sort={search.sort}
                  dir={dir}
                  labeler={labeler}
                  answer={isCategorical ? levelLabel : undefined}
                />
              </ChartFigure>
            </>
          ) : null}
        </>
      )}
    </section>
  )
}
