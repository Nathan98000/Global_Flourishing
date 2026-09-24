// Compare (Phase 5): two to five countries — or one demographic's levels
// within each — across the six SFI domains, plus any measure the reader
// adds. Ordinary cross-sections through the existing static-first
// estimates path (six requests, one per domain); the domain ids come
// from the engine's registry (charts/theme.ts SFI_DOMAINS) and every
// name from the catalog. A dumbbell per domain reading down the page —
// never a radar.

import { getRouteApi } from '@tanstack/react-router'
import { useMemo } from 'react'
import { NetworkError } from '../api/errors'
import { useEstimatesMany, type EstimatesManyResult } from '../api/estimates'
import { useBootStatus, useMeta } from '../api/meta'
import type { EstimateResponse, EstimateRow, Stat, VariableSummary } from '../api/types'
import { useVariable, useVariables } from '../api/variables'
import { useWarmApi } from '../api/warm'
import { ChartFigure, type CsvExport } from '../charts/ChartFigure'
import { CompareDomains } from '../charts/CompareDomains'
import { measureBounds } from '../charts/domain'
import type { LevelLabeler } from '../charts/DotPlot'
import { SFI_DOMAINS } from '../charts/theme'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingBlock } from '../components/Loading'
import { InvalidParamsNotice } from '../components/Notice'
import { CountryFilter } from '../components/controls/CountryFilter'
import { OutcomePicker } from '../components/controls/OutcomePicker'
import { RadioRow, type RadioOption } from '../components/controls/RadioRow'
import { csvFilename, downloadTextFile, responseToCsv } from '../export/csv'
import { columnLabel, levelDomain, outcomeLevels, scaleSubtitle } from '../labels'
import {
  COMPARE_MAX_COUNTRIES,
  COMPARE_MIN_COUNTRIES,
  compareRequest,
  compareSearchParams,
  type CompareSearch,
} from '../state/search'
import { NARROW_VIEWPORT, useMediaQuery } from '../useMediaQuery'
import { WAVE_CHIPS, WAVE_TITLES } from '../waves'
import { combineRows, compareUnits } from './compareRows'
import styles from './AtlasView.module.css'

const route = getRouteApi('/compare')

export function CompareView() {
  useWarmApi()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const meta = useMeta()
  const boot = useBootStatus()
  const variables = useVariables()
  const narrow = useMediaQuery(NARROW_VIEWPORT)
  const byName = useMemo(() => variables.data?.byName ?? {}, [variables.data])
  const ready = search.countries.length >= COMPARE_MIN_COUNTRIES

  const setSearch = (patch: Partial<CompareSearch>) => {
    void navigate({ search: compareSearchParams({ ...search, ...patch }) as never })
  }

  const domainRequests = useMemo(
    () =>
      ready ? SFI_DOMAINS.map((domain) => compareRequest(search, domain, byName[domain])) : [],
    [ready, search, byName],
  )
  const domains = useEstimatesMany(domainRequests)
  const extra: VariableSummary | undefined =
    search.outcome !== undefined && byName[search.outcome]?.servable
      ? byName[search.outcome]
      : undefined
  const extraRequests = useMemo(
    () => (ready && extra ? [compareRequest(search, extra.name, extra)] : []),
    [ready, extra, search],
  )
  const extraQuery = useEstimatesMany(extraRequests)
  const extraDetail = useVariable(extra ? extra.name : null).data?.detail
  const splitDetail = useVariable(
    search.by !== undefined && byName[search.by] !== undefined ? search.by : null,
  ).data?.detail

  const metaData = meta.data?.meta
  const units = useMemo(
    () => (metaData ? compareUnits(search.countries, metaData) : []),
    [search.countries, metaData],
  )
  const domainRows = useMemo(
    () =>
      combineRows(
        domains.results.map((result) => result?.response),
        SFI_DOMAINS,
        search.countries,
      ),
    [domains.results, search.countries],
  )
  const extraRows = useMemo(
    () =>
      extra
        ? combineRows(
            extraQuery.results.map((result) => result?.response),
            [extra.name],
            search.countries,
          )
        : [],
    [extra, extraQuery.results, search.countries],
  )
  // Level labels for a survey-variable split come from its own value
  // labels (server truth); demographics are labelled by meta.
  const labeler: LevelLabeler | undefined = useMemo(() => {
    if (!splitDetail) return undefined
    const levels = new Map(outcomeLevels(splitDetail).map((level) => [level.value, level.label]))
    return (column, value) =>
      column === splitDetail.name && typeof value === 'number' ? levels.get(value) : undefined
  }, [splitDetail])

  if (meta.isPending || variables.isPending) {
    return (
      <section>
        <h2>Compare</h2>
        <LoadingBlock height={420} label="Loading the Compare view" />
      </section>
    )
  }
  if (meta.isError || variables.isError || !meta.data || !variables.data) {
    return (
      <section>
        <h2>Compare</h2>
        <ErrorState error={meta.error ?? variables.error} />
      </section>
    )
  }
  const served = meta.data.meta

  const domainVariables = SFI_DOMAINS.map((domain) => byName[domain]).filter(
    (variable): variable is VariableSummary => variable !== undefined,
  )
  const outcomeLabel = (outcome: string) => byName[outcome]?.display_name ?? outcome
  const waveOptions: RadioOption<CompareSearch['wave']>[] = served.waves.map((wave) => {
    const missing = domainVariables.some((variable) => !variable.waves_available.includes(wave))
    return {
      value: wave as CompareSearch['wave'],
      label: WAVE_CHIPS[wave] ?? wave,
      disabled: missing,
      title: missing
        ? `The domains are not asked in ${WAVE_TITLES[wave] ?? wave}`
        : WAVE_TITLES[wave],
    }
  })
  const demographics = served.breakdowns.filter((column) => column !== 'country_code')
  const waveTitle = WAVE_TITLES[search.wave] ?? search.wave
  const splitDomain = search.by ? levelDomain(search.by, served, splitDetail) : undefined
  const splitClause = search.by ? ` · split by ${columnLabel(search.by, served)}` : ''
  const firstDomain = domainVariables[0]
  const domainsSubtitle = firstDomain
    ? `${scaleSubtitle(firstDomain, 'mean')}${splitClause} · ${waveTitle}`
    : waveTitle
  const extraStat: Stat = (extra?.default_stat as Stat | undefined) ?? 'mean'
  const extraLevel = extraRows.length ? extraRows[0]?.level : undefined
  const extraLevelLabel =
    extraDetail && extraLevel !== undefined && extraLevel !== null
      ? outcomeLevels(extraDetail).find((level) => level.value === extraLevel)?.label
      : undefined
  const extraSubtitle = extra
    ? `${
        extraStat === 'proportion'
          ? extraLevelLabel
            ? `share answering “${extraLevelLabel}”`
            : 'weighted share'
          : scaleSubtitle(extra, extraStat)
      }${splitClause} · ${waveTitle}`
    : ''

  const responseFor = (
    rows: EstimateRow[],
    outcomes: readonly string[],
    source: EstimatesManyResult,
  ) => {
    const first = source.results.find((result) => result !== undefined)?.response
    const by = ['outcome', 'country_code', ...(search.by ? [search.by] : [])]
    const base = first ? first.meta : { ...domains.results[0]?.response.meta }
    return {
      meta: { ...(base as EstimateResponse['meta']), outcome: outcomes.join(','), by },
      rows,
    } as EstimateResponse
  }
  const csvFor = (response: EstimateResponse, stem: string): CsvExport => ({
    kind: 'client',
    onDownload: () =>
      downloadTextFile(
        csvFilename(stem, search.wave, response.meta.stat, response.meta.data_version),
        responseToCsv(response),
      ),
  })
  const groupLabel = (column: string, value: string | number) =>
    column === 'outcome' ? outcomeLabel(String(value)) : labeler?.(column, value)

  const handlePick = ({ outcome, topic }: { outcome?: string; topic?: string }) => {
    if (outcome === undefined) setSearch({ topic })
    else setSearch({ outcome, topic: undefined })
  }

  const displayOptions = (
    <>
      <RadioRow
        legend="Wave"
        name="wave"
        options={waveOptions}
        value={search.wave}
        onChange={(wave) => setSearch({ wave })}
      />
      <label className={styles.oriented}>
        Split each country by{' '}
        <select
          value={search.by ?? ''}
          onChange={(event) => setSearch({ by: event.target.value || undefined })}
        >
          <option value="">— nothing —</option>
          {demographics.map((column) => (
            <option key={column} value={column}>
              {columnLabel(column, served)}
            </option>
          ))}
        </select>
      </label>
      <div className={styles.addMeasure}>
        <span className={styles.addLabel}>Add a measure</span>
        <OutcomePicker
          variables={variables.data.list}
          value={search.outcome ?? ''}
          topic={search.topic}
          onSelect={handlePick}
        />
        {extra && (
          <button
            type="button"
            className={styles.textButton}
            onClick={() => setSearch({ outcome: undefined, topic: undefined })}
          >
            Remove {extra.display_name}
          </button>
        )}
      </div>
    </>
  )

  const figureFor = (
    title: string,
    subtitle: string,
    outcomes: readonly string[],
    rows: EstimateRow[],
    source: EstimatesManyResult,
    stem: string,
    bounds: readonly [number, number] | undefined,
  ) => {
    const response = responseFor(rows, outcomes, source)
    return (
      <ChartFigure
        title={title}
        subtitle={subtitle}
        ariaLabel={`${title} for ${units.join(', ')}, ${waveTitle}: one panel per measure, ${
          search.by
            ? `the levels of ${columnLabel(search.by, served)} in each country`
            : 'a row per country'
        }, dots with confidence intervals. The data table below carries every number.`}
        marks="dots"
        response={response}
        meta={served}
        csv={csvFor(response, stem)}
        isRefreshing={source.isPlaceholderData}
        groupLabel={groupLabel}
      >
        <CompareDomains
          rows={rows}
          meta={served}
          outcomes={outcomes}
          outcomeLabel={outcomeLabel}
          units={units}
          split={search.by}
          splitDomain={splitDomain}
          labeler={labeler}
          bounds={bounds}
        />
      </ChartFigure>
    )
  }

  return (
    <section>
      <h2 className="visually-hidden">Compare</h2>
      <p className={styles.deck}>
        <span className={styles.deckLong}>
          Two to five countries side by side across the six domains of flourishing — happiness,
          health, meaning, character, relationships and finances — and any measure you add.
        </span>
        <span className={styles.deckShort}>
          Up to five countries across the six domains of flourishing.
        </span>
      </p>
      <InvalidParamsNotice
        invalid={search.invalid}
        onDismiss={() =>
          void navigate({
            search: compareSearchParams({
              ...search,
              invalid: undefined,
              invalidRaw: undefined,
            }) as never,
            replace: true,
          })
        }
      />
      <div className={styles.controls}>
        <CountryFilter
          countries={served.countries}
          selected={search.countries}
          onChange={(countries) => setSearch({ countries })}
          max={COMPARE_MAX_COUNTRIES}
          capMessage={`Up to ${COMPARE_MAX_COUNTRIES} countries at a time — clear one to add another.`}
        />
        {narrow ? (
          <details className={styles.moreOptions}>
            <summary>More options — wave, split, add a measure</summary>
            <div className={styles.moreBody}>{displayOptions}</div>
          </details>
        ) : (
          displayOptions
        )}
      </div>

      {!ready ? (
        <EmptyState title="Choose two to five countries">
          <p>
            Pick the countries to set side by side with the control above — every domain is shown
            for each, with its confidence interval.
          </p>
        </EmptyState>
      ) : domains.isPending ? (
        <LoadingBlock height={720} label="Loading estimates" />
      ) : domains.isError ? (
        domains.error instanceof NetworkError && boot.state !== 'ready' ? (
          <p className={styles.hint} role="status">
            This view needs the live data service, which is offline right now — the Atlas and
            Breakdowns still work.
          </p>
        ) : (
          <ErrorState error={domains.error} />
        )
      ) : (
        <>
          <p role="status" className="visually-hidden">
            Updated: {units.length} countries across {SFI_DOMAINS.length} domains.
          </p>
          {figureFor(
            'Six domains of flourishing',
            domainsSubtitle,
            SFI_DOMAINS,
            domainRows,
            domains,
            'sfi-domains',
            measureBounds('mean', firstDomain ?? { min: 0, max: 10 }),
          )}
          {extra &&
            (extraQuery.isPending ? (
              <LoadingBlock height={220} label="Loading the added measure" />
            ) : extraQuery.isError ? (
              <ErrorState error={extraQuery.error} />
            ) : (
              figureFor(
                extra.display_name,
                extraSubtitle,
                [extra.name],
                extraRows,
                extraQuery,
                extra.name,
                measureBounds(extraStat, extra),
              )
            ))}
        </>
      )}
    </section>
  )
}
