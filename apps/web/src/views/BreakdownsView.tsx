// Breakdowns (§2.6), shown to readers as Segments at /segments
// (ADR-0017): outcome × one demographic as small multiples by
// country, sortable, every cell shown with its n. A second breakdown —
// another demographic, or one categorical survey variable — is answered
// by the live service only (the static tier facets by one demographic).

import { getRouteApi } from '@tanstack/react-router'
import { useId, useMemo } from 'react'
import { exportCsvUrl, useEstimates } from '../api/estimates'
import { NetworkError } from '../api/errors'
import { useBootStatus, useHealth, useMeta } from '../api/meta'
import type { Stat } from '../api/types'
import { useVariable, useVariables } from '../api/variables'
import { ChartFigure, type CsvExport } from '../charts/ChartFigure'
import { ChartKey } from '../charts/ChartKey'
import type { LevelLabeler } from '../charts/DotPlot'
import { SmallMultiples, facetOrder } from '../charts/SmallMultiples'
import { outcomeColor } from '../charts/theme'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingBlock } from '../components/Loading'
import { InvalidParamsNotice } from '../components/Notice'
import { OfflineLine } from '../components/StillWorks'
import { Skeleton } from '../components/Skeleton'
import { WordingPanel } from '../components/WordingPanel'
import { CountryFilter } from '../components/controls/CountryFilter'
import { OptionsSheet } from '../components/controls/OptionsSheet'
import { QuestionPicker } from '../components/controls/QuestionPicker'
import { RadioRow, type RadioOption } from '../components/controls/RadioRow'
import { downloadTextFile, responseToCsv } from '../export/csv'
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
import {
  BREAKDOWNS_DEFAULTS,
  breakdownsRequest,
  breakdownsSearchParams,
  type BreakdownsSearch,
} from '../state/search'
import { NARROW_VIEWPORT, useMediaQuery } from '../useMediaQuery'
import { WAVE_CHIPS, WAVE_TITLES, yearNote } from '../waves'
import styles from './AtlasView.module.css'
import { countriesPhrase, keyCiLevel, keyThinBelow, orderPhrase, stateLine } from './viewState'

const route = getRouteApi('/segments')

export function BreakdownsView() {
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

  const request = chartable ? breakdownsRequest(search, variable) : null
  const estimates = useEstimates(request)
  const response = estimates.data?.response
  const dir = search.dir ?? DEFAULT_DIR
  const metaForSort = meta.data?.meta
  const narrow = useMediaQuery(NARROW_VIEWPORT)

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
    // same facetOrder call the chart makes, then the served level order.
    if (!metaForSort) return rows
    const served = metaForSort
    return sortBreakdownRows(
      rows,
      served,
      (input) => facetOrder(input, served, 'country_code', search.sort, dir),
      (row) => groupValueLabel(primary, row.group[primary] ?? null, served, labeler),
      levelDomain(primary, served, detail),
    )
  }, [
    response,
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

  if (meta.isPending || variables.isPending) {
    return (
      <section>
        <h2>Segments</h2>
        <Skeleton height={420} label="Loading segments" />
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

  // The title names the splits in words ("Life satisfaction by gender
  // and age band"); the wave rides last in the subtitle (§7).
  const title = `${variable?.display_name ?? search.outcome} by ${[primary, secondary]
    .filter((column): column is string => column !== undefined)
    .map((column) => lowerFirst(columnLabel(column, meta.data.meta)))
    .join(' and ')}`
  const stat: Stat = (variable?.default_stat as Stat | undefined) ?? 'mean'
  // The state, in the controls' words (ADR-0029): the year, the
  // countries, their order.
  const subtitle = stateLine(
    isCategorical
      ? levelLabel
        ? `share answering “${levelLabel}”`
        : null
      : variable
        ? scaleSubtitle(variable, stat, detail)
        : null,
    WAVE_TITLES[search.wave] ?? search.wave,
    countriesPhrase(search.countries.length, meta.data.meta.countries.length),
    search.sort === 'gap' ? 'biggest gap first' : orderPhrase(dir),
  )

  // What a download is called, in words (ADR-0016): the measure, then
  // `by-<breakdown>` for the split; the server names its CSV the same way.
  const exportName: ExportName = {
    measure: variable?.display_name ?? search.outcome,
    view: 'By country',
    waves: WAVE_CHIPS[search.wave] ?? search.wave,
    breakdown: search.by.map((column) => columnLabel(column, meta.data.meta)).join(' and '),
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
  const chartControls = (inline: boolean) => (
    <>
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
  // The phone's line: how the chart is drawn, in the controls' words.
  const phoneSummary = stateLine(
    isCategorical ? 'Share' : 'Mean',
    countriesPhrase(search.countries.length, meta.data.meta.countries.length),
    search.sort === 'gap' ? 'biggest gap first' : orderPhrase(dir),
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
        invalid={search.invalid}
        onDismiss={() =>
          void navigate(
            searchNavigation(
              breakdownsSearchParams({ ...search, invalid: undefined, invalidRaw: undefined }),
              { replace: true },
            ),
          )
        }
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
          noteId={yearNoteText ? yearNoteId : undefined}
        />
        {yearNoteText && (
          <p id={yearNoteId} className={styles.barNote}>
            {yearNoteText}
          </p>
        )}
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
          {estimates.isPending ? (
            <LoadingBlock height={420} label="Loading estimates" />
          ) : estimates.isError ? (
            estimates.error instanceof NetworkError && !boot.apiReachable ? (
              <OfflineLine except="/segments" className={styles.hint} />
            ) : (
              <ErrorState apiReachable={boot.apiReachable} error={estimates.error} />
            )
          ) : response && variable ? (
            <>
              <p role="status" className="visually-hidden">
                Updated: {title}, {displayRows.length} cells.
              </p>
              <ChartFigure
                title={title}
                subtitle={subtitle}
                ariaLabel={`${title}: one panel per country, ${levelDomain(primary, meta.data.meta).length} levels each.`}
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
              >
                <SmallMultiples
                  rows={displayRows}
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
