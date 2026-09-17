// Atlas (§2.5): pick a measure and a wave, see ranked dots/bars, the
// map, or the distribution — CI and n on every value, the question on
// the page, weight and suppression rule in plain words under the chart,
// coverage on Y2/MY, the URL carrying all of it. Statistics come from
// the server; this view only chooses, filters and renders.

import { getRouteApi } from '@tanstack/react-router'
import { Suspense, lazy, useMemo } from 'react'
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
import { InvalidParamsNotice } from '../components/Notice'
import { Skeleton } from '../components/Skeleton'
import { WordingPanel } from '../components/WordingPanel'
import { CountryFilter } from '../components/controls/CountryFilter'
import { OutcomePicker } from '../components/controls/OutcomePicker'
import { RadioRow, type RadioOption } from '../components/controls/RadioRow'
import { csvFilename, downloadTextFile, responseToCsv } from '../export/csv'
import { formatCount } from '../format'
import { highestLevel, outcomeLevels, scaleSubtitle } from '../labels'
import { defaultDir, sortAtlasRows } from '../sortRows'
import { atlasRequest, atlasSearchParams, type AtlasSearch } from '../state/search'
import styles from './AtlasView.module.css'

const MapPanel = lazy(() => import('./MapPanel'))

const route = getRouteApi('/')

export const WAVE_TITLES: Record<string, string> = {
  Y1: 'Wave 1 (2023)',
  MY: 'Midyear survey',
  Y2: 'Wave 2 (2024)',
}

/** Human chip labels for the wave codes (F6). */
export const WAVE_CHIPS: Record<string, string> = {
  Y1: '2023',
  MY: 'Midyear',
  Y2: '2024',
}

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
    void navigate({
      search: atlasSearchParams({ ...search, ...patch }) as never,
    })
  }

  const metaForSort = meta.data?.meta
  const dir = search.dir ?? defaultDir(search.sort)
  const stat: Stat = search.stat ?? (variable?.default_stat as Stat | undefined) ?? 'mean'
  const isCategorical = variable?.default_stat === 'proportion'
  const levels = useMemo(() => outcomeLevels(detail), [detail])
  const activeLevel = search.level ?? levels[0]?.value
  const levelLabel = levels.find((entry) => entry.value === activeLevel)?.label

  const request = chartable ? atlasRequest(search, variable) : null
  const estimates = useEstimates(request)
  const response = estimates.data?.response

  const displayRows = useMemo(() => {
    if (!response) return []
    let rows = response.rows
    if (stat === 'proportion') {
      const level = activeLevel ?? highestLevel(rows)
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
        <ErrorState error={meta.error ?? variables.error} />
      </section>
    )
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

  const title = `${variable?.display_name ?? search.outcome} — ${WAVE_TITLES[search.wave] ?? search.wave}`
  const subtitle =
    stat === 'proportion'
      ? levelLabel
        ? `share answering “${levelLabel}”`
        : undefined
      : stat === 'distribution'
        ? undefined
        : variable
          ? scaleSubtitle(variable, stat, search.oriented ?? false)
          : undefined
  const marks: ChartMarks =
    stat === 'distribution'
      ? 'bins'
      : search.view === 'map'
        ? 'map'
        : stat === 'proportion'
          ? 'bars'
          : 'dots'

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

  return (
    <section>
      <h2 className="visually-hidden">Atlas</h2>
      <p className={styles.deck}>
        <span className={styles.deckLong}>
          How 207,919 people across {formatCount(countryCount)} countries rate their own lives — the
          Global Flourishing Study, 2023&ndash;2024. Pick a measure below; every number carries its
          sample size and margin of error.
        </span>
        <span className={styles.deckShort}>
          207,919 people in {formatCount(countryCount)} countries, 2023&ndash;2024. Every number
          shows how precise it is.
        </span>
      </p>
      <InvalidParamsNotice
        invalid={search.invalid}
        onDismiss={() =>
          void navigate({
            search: atlasSearchParams({
              ...search,
              invalid: undefined,
              invalidRaw: undefined,
            }) as never,
            replace: true,
          })
        }
      />
      <div className={styles.controls}>
        <OutcomePicker
          variables={variables.data.list}
          value={search.outcome}
          topic={search.topic}
          onSelect={({ outcome, topic }) => {
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
              oriented: undefined,
              invalid: undefined,
              invalidRaw: undefined,
            })
          }}
        />
        <RadioRow
          legend="Wave"
          name="wave"
          options={waveOptions}
          value={search.wave}
          onChange={(wave) => setSearch({ wave })}
        />
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
        {stat !== 'distribution' && (
          <RadioRow
            legend="View"
            name="view"
            options={[
              { value: 'bars', label: 'Chart' },
              { value: 'map', label: 'Map' },
            ]}
            value={search.view}
            onChange={(view) => setSearch({ view })}
          />
        )}
        {search.view === 'bars' && stat !== 'distribution' && (
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
                      { value: 'asc', label: 'A→Z' },
                      { value: 'desc', label: 'Z→A' },
                    ]
                  : [
                      { value: 'desc', label: 'High→low' },
                      { value: 'asc', label: 'Low→high' },
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
            options={levels.map((entry) => ({ value: String(entry.value), label: entry.label }))}
            value={String(activeLevel)}
            onChange={(value) => setSearch({ level: Number(value) })}
          />
        )}
        {variable && variable.direction === 'lower_better' && !variable.is_derived && (
          <label className={styles.oriented}>
            <input
              type="checkbox"
              checked={search.oriented ?? false}
              onChange={(event) => setSearch({ oriented: event.target.checked || undefined })}
            />{' '}
            Orient so higher = better (reverses this item; needs the live service)
          </label>
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
                pick them with the Countries control above.
              </p>
            </EmptyState>
          ) : estimates.isPending ? (
            <Skeleton height={420} label="Loading estimates" />
          ) : estimates.isError ? (
            estimates.error instanceof NetworkError && boot.state !== 'ready' ? (
              <p className={styles.hint} role="status">
                This view needs the live data service, which is offline right now — the standard
                views still work.
              </p>
            ) : (
              <ErrorState error={estimates.error} />
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
              >
                {stat === 'distribution' ? (
                  <>
                    <Histogram
                      rows={displayRows}
                      meta={meta.data.meta}
                      responseMeta={response.meta}
                      variable={variable}
                      color={outcomeColor(variable.name)}
                    />
                    {search.countries.length > 4 && (
                      <p className={styles.hint}>Showing the first four selected countries.</p>
                    )}
                  </>
                ) : search.view === 'map' ? (
                  <Suspense fallback={<Skeleton height={400} label="Loading the world map" />}>
                    <MapPanel
                      rows={
                        stat === 'proportion'
                          ? response.rows.filter(
                              (row) => row.level === (activeLevel ?? highestLevel(response.rows)),
                            )
                          : response.rows
                      }
                      meta={meta.data.meta}
                      responseMeta={response.meta}
                      variable={variable}
                      selected={search.countries}
                      levelLabel={levelLabel}
                    />
                  </Suspense>
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
