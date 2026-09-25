// Atlas (§2.5): pick a measure and a wave, see ranked dots/bars or the
// distribution — CI on every value, n in the data table, the question on
// the page, weight and suppression rule in plain words under the chart,
// coverage on Y2/MY, the URL carrying all of it. Statistics come from
// the server; this view only chooses, filters and renders.

import { getRouteApi } from '@tanstack/react-router'
import { useMemo } from 'react'
import { exportCsvUrl, useEstimates } from '../api/estimates'
import { NetworkError } from '../api/errors'
import { useBootStatus, useHealth, useMeta } from '../api/meta'
import type { Stat } from '../api/types'
import { useVariable, useVariables } from '../api/variables'
import { ChartFigure, type ChartMarks, type CsvExport } from '../charts/ChartFigure'
import { Histogram } from '../charts/Histogram'
import { RankedBar } from '../charts/RankedBar'
import { summarizeExtremes } from '../charts/summary'
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
import { formatCount } from '../format'
import { defaultLevel, outcomeLevels, scaleSubtitle } from '../labels'
import { defaultDir, sortAtlasRows } from '../sortRows'
import { searchNavigation } from '../state/navigate'
import { atlasRequest, atlasSearchParams, type AtlasSearch } from '../state/search'
import { NARROW_VIEWPORT, useMediaQuery } from '../useMediaQuery'
import { WAVE_CHIPS, WAVE_TITLES } from '../waves'
import styles from './AtlasView.module.css'

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
  const dir = search.dir ?? defaultDir(search.sort)
  const narrow = useMediaQuery(NARROW_VIEWPORT)
  const stat: Stat = search.stat ?? (variable?.default_stat as Stat | undefined) ?? 'mean'
  const isCategorical = variable?.default_stat === 'proportion'
  const levels = useMemo(() => outcomeLevels(detail), [detail])
  const activeLevel = search.level ?? defaultLevel(detail)
  const levelLabel = levels.find((entry) => entry.value === activeLevel)?.label
  // A derived score's distribution bins arrive as its value labels
  // ("0–1" … "9–10", the server's rule — ADR-0015); an item's own answer
  // codes label themselves.
  const binLabel = (level: number) => levels.find((entry) => entry.value === level)?.label
  const derivedBins = variable?.is_derived && levels.length > 0

  const request = chartable ? atlasRequest(search, variable) : null
  const estimates = useEstimates(request)
  const response = estimates.data?.response

  const displayRows = useMemo(() => {
    if (!response) return []
    let rows = response.rows
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
    // One ordering for the chart and the data table (items 5/13).
    if (!metaForSort) return rows
    return sortAtlasRows(rows, metaForSort, search.sort, dir)
  }, [response, stat, activeLevel, search.countries, metaForSort, search.sort, dir])

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

  const handlePick = ({ outcome, topic }: { outcome?: string; topic?: string }) => {
    if (outcome === undefined) {
      setSearch({ topic })
      return
    }
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
    title:
      variable && !variable.waves_available.includes(wave)
        ? `Not asked in ${WAVE_TITLES[wave] ?? wave}`
        : WAVE_TITLES[wave],
  }))

  const statOptions: RadioOption<string>[] | null =
    variable && variable.scale_type === 'scale_0_10'
      ? [
          { value: 'default', label: 'Mean' },
          { value: 'distribution', label: 'Distribution' },
          { value: 'quantile', label: 'Median', title: 'Computed live by the data service' },
        ]
      : variable && variable.scale_type === 'count'
        ? [
            { value: 'default', label: 'Mean' },
            { value: 'quantile', label: 'Median', title: 'Computed live by the data service' },
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
      : stat === 'distribution'
        ? undefined
        : variable
          ? scaleSubtitle(variable, stat, detail)
          : undefined
  const subtitle = subtitleBase ? `${subtitleBase} · ${waveTitle}` : waveTitle
  const marks: ChartMarks =
    stat === 'distribution' ? 'bins' : stat === 'proportion' ? 'bars' : 'dots'

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
                  csvFilename(
                    request.outcome,
                    request.wave,
                    request.stat,
                    response.meta.data_version,
                  ),
                  responseToCsv(response),
                ),
            }
          : undefined

  // Statistic, Sort, Order, Countries and Answer level fold into a
  // disclosure under 40rem (§8), Topic + search first inside it; Measure
  // and Wave stay visible so the chart starts within the first phone
  // screen.
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
          selectOnNarrow
        />
      )}
      {stat !== 'distribution' && (
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
      <CountryFilter
        countries={meta.data.meta.countries}
        selected={search.countries}
        onChange={(countries) => setSearch({ countries })}
      />
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
    </>
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
        {narrow ? (
          <details className={styles.moreOptions}>
            <summary>More options — chart, sort, countries</summary>
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
          {stat === 'distribution' && search.countries.length === 0 ? (
            <EmptyState title="Choose countries to compare">
              <p>
                The distribution view shows the full shape of answers for up to four countries —
                pick them with the control above that reads “Countries: all{' '}
                {meta.data.meta.countries.length}”.
              </p>
            </EmptyState>
          ) : estimates.isPending ? (
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
                Updated: {title}, {displayRows.length} rows shown.
              </p>
              <ChartFigure
                title={title}
                subtitle={subtitle}
                ariaLabel={summarizeExtremes(
                  stat === 'distribution' ? [] : displayRows,
                  meta.data.meta,
                  `${title}${subtitle ? ` (${subtitle})` : ''} by country.`,
                )}
                marks={marks}
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
                levelLabel={stat === 'distribution' && derivedBins ? binLabel : undefined}
              >
                {stat === 'distribution' ? (
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
