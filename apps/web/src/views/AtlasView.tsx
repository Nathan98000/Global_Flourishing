// Atlas (§2.5): pick an outcome and a wave, see ranked bars, the map, or
// the distribution — CI and n on every value, wording one click away,
// weight and suppression rule under the chart, coverage on Y2/MY, the
// URL carrying all of it. Statistics come from the server; this view
// only chooses, filters and renders.

import { getRouteApi } from '@tanstack/react-router'
import { Suspense, lazy, useMemo } from 'react'
import { useEstimates } from '../api/estimates'
import { useHealth, useMeta } from '../api/meta'
import type { Stat } from '../api/types'
import { useVariable, useVariables } from '../api/variables'
import { ChartFigure, type CsvExport } from '../charts/ChartFigure'
import { Histogram } from '../charts/Histogram'
import { RankedBar } from '../charts/RankedBar'
import { summarizeExtremes } from '../charts/summary'
import { outcomeColor } from '../charts/theme'
import { CoverageBanner } from '../components/CoverageBanner'
import { ErrorState } from '../components/ErrorState'
import { InvalidParamsNotice } from '../components/Notice'
import { Skeleton } from '../components/Skeleton'
import { WordingPanel } from '../components/WordingPanel'
import { CountryFilter } from '../components/controls/CountryFilter'
import { OutcomePicker } from '../components/controls/OutcomePicker'
import { RadioRow, type RadioOption } from '../components/controls/RadioRow'
import { csvFilename, downloadTextFile, responseToCsv } from '../export/csv'
import { exportCsvUrl } from '../api/estimates'
import { highestLevel, outcomeLevels } from '../labels'
import { atlasRequest, atlasSearchParams, type AtlasSearch } from '../state/search'
import styles from './AtlasView.module.css'

const MapPanel = lazy(() => import('./MapPanel'))

const route = getRouteApi('/')

const WAVE_TITLES: Record<string, string> = {
  Y1: 'Wave 1 (2023)',
  MY: 'Midyear survey',
  Y2: 'Wave 2 (2024)',
}

export function AtlasView() {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const meta = useMeta()
  const health = useHealth()
  const variables = useVariables()
  const variable = variables.data?.byName[search.outcome]
  const detailQuery = useVariable(variables.isSuccess ? search.outcome : null)
  const detail = detailQuery.data?.detail

  const setSearch = (patch: Partial<AtlasSearch>) => {
    void navigate({
      search: atlasSearchParams({ ...search, ...patch }) as never,
    })
  }

  const stat: Stat = search.stat ?? (variable?.default_stat as Stat | undefined) ?? 'mean'
  const isCategorical = variable?.default_stat === 'proportion'
  const levels = useMemo(() => outcomeLevels(detail), [detail])
  const activeLevel = search.level ?? levels[0]?.value
  const levelLabel = levels.find((entry) => entry.value === activeLevel)?.label

  const request = variables.isSuccess ? atlasRequest(search, variable) : null
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
      const wanted = search.countries.length
        ? search.countries.slice(0, 4)
        : [meta.data?.meta.countries[0]?.code ?? 1]
      return rows.filter((row) => wanted.includes(Number(row.group['country_code'])))
    }
    if (search.countries.length) {
      rows = rows.filter((row) => search.countries.includes(Number(row.group['country_code'])))
    }
    return rows
  }, [response, stat, activeLevel, search.countries, meta.data])

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

  const waveOptions: RadioOption<AtlasSearch['wave']>[] = meta.data.meta.waves.map((wave) => ({
    value: wave as AtlasSearch['wave'],
    label: wave,
    disabled: variable ? !variable.waves_available.includes(wave) : false,
    title:
      variable && !variable.waves_available.includes(wave)
        ? `${variable.name} is not asked at ${wave}`
        : WAVE_TITLES[wave],
  }))

  const statOptions: RadioOption<string>[] | null =
    variable && variable.scale_type === 'scale_0_10'
      ? [
          { value: 'default', label: 'Mean' },
          { value: 'distribution', label: 'Distribution' },
          { value: 'quantile', label: 'Median', title: 'Computed live by the API' },
        ]
      : variable && variable.scale_type === 'count'
        ? [
            { value: 'default', label: 'Mean' },
            { value: 'quantile', label: 'Median', title: 'Computed live by the API' },
          ]
        : null

  const title = `${variable?.display_name ?? search.outcome} — ${WAVE_TITLES[search.wave] ?? search.wave}`
  const subtitle =
    stat === 'proportion' && levelLabel
      ? `share answering “${levelLabel}”`
      : stat === 'quantile'
        ? 'median'
        : undefined

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
      <InvalidParamsNotice
        invalid={search.invalid}
        onDismiss={() =>
          void navigate({
            search: atlasSearchParams({ ...search, invalid: undefined }) as never,
            replace: true,
          })
        }
      />
      <div className={styles.controls}>
        <OutcomePicker
          variables={variables.data.list}
          value={search.outcome}
          onChange={(outcome) => {
            const target = variables.data.byName[outcome]
            const wave =
              target && !target.waves_available.includes(search.wave)
                ? (target.waves_available[0] as AtlasSearch['wave'] | undefined)
                : search.wave
            setSearch({
              outcome,
              wave: wave ?? search.wave,
              stat: undefined,
              level: undefined,
              oriented: undefined,
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
              { value: 'bars', label: 'Ranked bars' },
              { value: 'map', label: 'Map' },
            ]}
            value={search.view}
            onChange={(view) => setSearch({ view })}
          />
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
            Orient so higher = better (reverses this item; computed live)
          </label>
        )}
      </div>

      {search.wave !== 'Y1' && detail && (
        <div className={styles.banner}>
          <CoverageBanner
            wave={search.wave}
            missingness={detail.missingness}
            countries={meta.data.meta.countries}
          />
        </div>
      )}

      {estimates.isPending ? (
        <Skeleton height={420} label="Loading estimates" />
      ) : estimates.isError ? (
        <ErrorState error={estimates.error} />
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
            tier={estimates.data.source}
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
                {search.countries.length === 0 && (
                  <p className={styles.hint}>
                    Showing {meta.data.meta.countries[0]?.name} — pick countries above to compare
                    (up to four).
                  </p>
                )}
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
                sort={search.sort}
                levelLabel={levelLabel}
              />
            )}
          </ChartFigure>
          {search.view === 'bars' && stat !== 'distribution' && (
            <div className={styles.sortRow}>
              <RadioRow
                legend="Sort"
                name="sort"
                options={[
                  { value: 'estimate', label: 'By value' },
                  { value: 'name', label: 'By country' },
                ]}
                value={search.sort}
                onChange={(sort) => setSearch({ sort })}
              />
            </div>
          )}
        </>
      ) : null}

      {detail && (
        <div className={styles.wording}>
          <WordingPanel detail={detail} />
        </div>
      )}
    </section>
  )
}
