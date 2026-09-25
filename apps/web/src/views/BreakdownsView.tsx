// Breakdowns (§2.6): outcome × one demographic as small multiples by
// country, sortable, every cell shown with its n. A second breakdown —
// another demographic, or one categorical survey variable — is answered
// by the live service only (the static tier facets by one demographic).

import { getRouteApi } from '@tanstack/react-router'
import { useMemo } from 'react'
import { exportCsvUrl, useEstimates } from '../api/estimates'
import { NetworkError } from '../api/errors'
import { useBootStatus, useHealth, useMeta } from '../api/meta'
import type { Stat } from '../api/types'
import { useVariable, useVariables } from '../api/variables'
import { ChartFigure, type CsvExport } from '../charts/ChartFigure'
import type { LevelLabeler } from '../charts/DotPlot'
import { SmallMultiples, facetOrder } from '../charts/SmallMultiples'
import { outcomeColor } from '../charts/theme'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingBlock } from '../components/Loading'
import { InvalidParamsNotice } from '../components/Notice'
import { Skeleton } from '../components/Skeleton'
import { WordingPanel } from '../components/WordingPanel'
import { CountryFilter } from '../components/controls/CountryFilter'
import { OutcomePicker } from '../components/controls/OutcomePicker'
import { RadioRow, type RadioOption } from '../components/controls/RadioRow'
import { csvFilename, downloadTextFile, responseToCsv } from '../export/csv'
import {
  columnLabel,
  groupValueLabel,
  highestLevel,
  levelDomain,
  outcomeLevels,
  scaleSubtitle,
} from '../labels'
import { defaultDir, sortBreakdownRows } from '../sortRows'
import { searchNavigation } from '../state/navigate'
import {
  BREAKDOWNS_DEFAULTS,
  breakdownsRequest,
  breakdownsSearchParams,
  type BreakdownsSearch,
} from '../state/search'
import { NARROW_VIEWPORT, useMediaQuery } from '../useMediaQuery'
import { WAVE_CHIPS, WAVE_TITLES } from '../waves'
import styles from './AtlasView.module.css'

const route = getRouteApi('/breakdowns')

export function BreakdownsView() {
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
  const dir = search.dir ?? defaultDir(search.sort)
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
    // One ordering for the panels and the data table (items 5/13): the
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
        <h2>Breakdowns</h2>
        <Skeleton height={420} label="Loading breakdowns" />
      </section>
    )
  }
  if (meta.isError || variables.isError || !meta.data || !variables.data) {
    return (
      <section>
        <h2>Breakdowns</h2>
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
    title:
      variable && !variable.waves_available.includes(wave)
        ? `Not asked in ${WAVE_TITLES[wave] ?? wave}`
        : WAVE_TITLES[wave],
  }))

  // The title keeps its × clause but loses the wave, which rides last in
  // the subtitle instead (§7).
  const title = `${variable?.display_name ?? search.outcome} × ${columnLabel(primary, meta.data.meta)}`
  const stat: Stat = (variable?.default_stat as Stat | undefined) ?? 'mean'
  const subtitle = [
    isCategorical
      ? levelLabel
        ? `share answering “${levelLabel}”`
        : null
      : variable
        ? scaleSubtitle(variable, stat, detail)
        : null,
    secondary ? `split by ${columnLabel(secondary, meta.data.meta)}` : null,
    WAVE_TITLES[search.wave] ?? search.wave,
  ]
    .filter(Boolean)
    .join(' · ')

  const csv: CsvExport | undefined =
    request === null
      ? undefined
      : health.isSuccess && health.data.data === 'ok'
        ? { kind: 'server', href: exportCsvUrl(request) }
        : response && estimates.data?.source === 'static'
          ? {
              kind: 'client',
              onDownload: () =>
                downloadTextFile(
                  csvFilename(request.outcome, request.wave, stat, response.meta.data_version),
                  responseToCsv(response),
                ),
            }
          : undefined

  // The split, sorts, country filter and answer level fold into a
  // disclosure under 40rem (§8), Topic + search first inside it;
  // Measure, Wave and the breakdown itself stay visible.
  const displayOptions = (
    <>
      <label className={styles.oriented}>
        Second breakdown{' '}
        <select
          value={secondary ?? ''}
          onChange={(event) =>
            setSearch({
              by: event.target.value ? [primary, event.target.value] : [primary],
            })
          }
        >
          <option value="">—</option>
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
      <RadioRow
        legend="Sort countries"
        name="sort"
        options={[
          { value: 'estimate', label: 'By value' },
          { value: 'name', label: 'A–Z' },
          { value: 'gap', label: 'By gap' },
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
      <CountryFilter
        countries={meta.data.meta.countries}
        selected={search.countries}
        onChange={(countries) => setSearch({ countries })}
      />
      {isCategorical && outcomeLevelOptions.length > 0 && (
        <RadioRow
          legend="Answer level"
          name="outcome-level"
          wide
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

  return (
    <section>
      <h2 className="visually-hidden">Breakdowns</h2>
      <p className={styles.deck}>
        One measure split by a demographic, one panel per country — the Atlas&rsquo;s estimates, cut
        finer.
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
          onChange={(wave) => setSearch({ wave })}
        />
        <RadioRow
          legend="Break down by"
          name="by"
          wide
          selectOnNarrow
          options={demographicOptions}
          value={primary}
          onChange={(column) => setSearch({ by: secondary ? [column, secondary] : [column] })}
        />
        {narrow ? (
          <details className={styles.moreOptions}>
            <summary>More options — split, sort, countries</summary>
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
      ) : (
        <>
          {estimates.isPending ? (
            <LoadingBlock height={420} label="Loading estimates" />
          ) : estimates.isError ? (
            estimates.error instanceof NetworkError && !boot.apiReachable ? (
              <p className={styles.hint} role="status">
                This view needs the live data service, which is offline right now — the standard
                views still work.
              </p>
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
                ariaLabel={
                  `${title}: one panel per country, ` +
                  `${levelDomain(primary, meta.data.meta).length} levels each. ` +
                  `The data table below carries every number, with its n.`
                }
                marks="dots"
                levelLabel={(level) =>
                  outcomeLevelOptions.find((entry) => entry.value === level)?.label
                }
                intro={
                  detail && (
                    <div className={styles.wording}>
                      <WordingPanel detail={detail} />
                    </div>
                  )
                }
                response={{ ...response, rows: displayRows }}
                meta={meta.data.meta}
                csv={csv}
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
                />
              </ChartFigure>
            </>
          ) : null}
        </>
      )}
    </section>
  )
}
