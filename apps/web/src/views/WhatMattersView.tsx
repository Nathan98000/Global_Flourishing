// What Matters (Phase 5): the midyear survey — what people said mattered
// most, by country; how that ranking shifts within one country by age
// band (or another demographic); the two prepared crossings, each an
// ordinary breakdown request made only when the catalog offers both
// sides at one wave, with the Methods page's "associated with, not
// caused by" framing; and the family's other questions, chartable one
// at a time. The item list comes from the catalog by family; the
// ranking set and the crossings are navigation copy in topics.ts.

import { Link, getRouteApi } from '@tanstack/react-router'
import { useMemo } from 'react'
import { NetworkError } from '../api/errors'
import { useEstimatesMany, type AggregateRequest } from '../api/estimates'
import { useBootStatus, useMeta } from '../api/meta'
import type { EstimateResponse, EstimateRow, Meta, Stat, VariableSummary } from '../api/types'
import { useVariable, useVariableDetails, useVariables } from '../api/variables'
import { useWarmApi } from '../api/warm'
import { ChartFigure, type CsvExport } from '../charts/ChartFigure'
import type { LevelLabeler } from '../charts/DotPlot'
import { RankedBar } from '../charts/RankedBar'
import { SmallMultiples } from '../charts/SmallMultiples'
import { summarizeExtremes } from '../charts/summary'
import { SERIES, outcomeColor } from '../charts/theme'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingBlock } from '../components/Loading'
import { InvalidParamsNotice } from '../components/Notice'
import { WordingPanel } from '../components/WordingPanel'
import { RadioRow } from '../components/controls/RadioRow'
import { csvFilename, downloadTextFile, responseToCsv } from '../export/csv'
import {
  columnLabel,
  groupValueLabel,
  highestLevel,
  levelDomain,
  outcomeLevels,
  scaleSubtitle,
} from '../labels'
import { defaultDir, sortAtlasRows } from '../sortRows'
import {
  whatMattersRequest,
  whatMattersSearchParams,
  type WhatMattersSearch,
} from '../state/search'
import { WHAT_MATTERS_CROSSINGS, crossingWave, splitMidyear } from '../topics'
import { NARROW_VIEWPORT, useMediaQuery } from '../useMediaQuery'
import { WAVE_TITLES } from '../waves'
import { crossingUnavailableCopy, rankingRows } from './whatMattersRows'
import styles from './AtlasView.module.css'

const route = getRouteApi('/what-matters')

const MIDYEAR_TITLE = WAVE_TITLES['MY'] ?? 'Midyear survey'

function withMeta(
  rows: EstimateRow[],
  base: EstimateResponse | undefined,
  meta: Meta,
  outcome: string,
  by: string[],
): EstimateResponse {
  const fallback = {
    data_version: meta.data_version,
    outcome,
    scale_type: 'scale_0_10',
    direction: 'higher_better',
    stat: 'mean',
    waves: ['MY'],
    scope: 'global',
    oriented: false,
    weight_key: 'my',
    weight: 'w_l1m',
    se_method: 'taylor',
    ci_level: meta.ci_level,
    suppression: meta.suppression,
    n_frame: 0,
    n_valid: 0,
    by,
    filters: {},
  } satisfies EstimateResponse['meta']
  return { meta: { ...(base?.meta ?? fallback), outcome, by }, rows }
}

export function WhatMattersView() {
  useWarmApi()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const meta = useMeta()
  const boot = useBootStatus()
  const variables = useVariables()
  const narrow = useMediaQuery(NARROW_VIEWPORT)
  const byName = useMemo(() => variables.data?.byName ?? {}, [variables.data])
  const { ranking, chartable } = useMemo(
    () => splitMidyear(variables.data?.list ?? []),
    [variables.data],
  )
  const dir = search.dir ?? defaultDir(search.sort)

  const setSearch = (patch: Partial<WhatMattersSearch>) => {
    void navigate({ search: whatMattersSearchParams({ ...search, ...patch }) as never })
  }

  // 1. The ranking by country: one midyear cross-section per item.
  const rankingRequests = useMemo(
    () => ranking.map((item) => whatMattersRequest(item.name, item)),
    [ranking],
  )
  const rankingQuery = useEstimatesMany(rankingRequests)
  // 2. The same seven items split by a demographic, for one country.
  const splitRequests = useMemo(
    () =>
      search.country !== undefined
        ? ranking.map((item) => whatMattersRequest(item.name, item, search.by))
        : [],
    [ranking, search.country, search.by],
  )
  const splitQuery = useEstimatesMany(splitRequests)
  // 3. The prepared crossings, where the catalog allows them.
  const crossings = useMemo(
    () =>
      WHAT_MATTERS_CROSSINGS.map((crossing) => ({
        crossing,
        wave: crossingWave(crossing, byName),
      })),
    [byName],
  )
  const crossingRequests = useMemo(
    () =>
      crossings.flatMap(({ crossing, wave }): AggregateRequest[] =>
        wave === undefined
          ? []
          : [
              {
                outcome: crossing.outcome,
                wave: wave as AggregateRequest['wave'],
                stat: (byName[crossing.outcome]?.default_stat as Stat | undefined) ?? 'mean',
                by: ['country_code', crossing.by],
              },
            ],
      ),
    [crossings, byName],
  )
  const crossingQuery = useEstimatesMany(crossingRequests)
  const crossingDetails = useVariableDetails(
    crossings.filter(({ wave }) => wave !== undefined).map(({ crossing }) => crossing.by),
  )
  // 4. One chartable item by country.
  const item: VariableSummary | undefined =
    (search.item !== undefined ? byName[search.item] : undefined) ?? chartable[0]
  const itemRequests = useMemo(() => (item ? [whatMattersRequest(item.name, item)] : []), [item])
  const itemQuery = useEstimatesMany(itemRequests)
  const itemDetail = useVariable(item ? item.name : null).data?.detail
  const itemLevels = useMemo(() => outcomeLevels(itemDetail), [itemDetail])

  const metaData = meta.data?.meta
  const rankingAll = useMemo(
    () =>
      rankingRows(
        rankingQuery.results.map((result) => result?.response),
        ranking,
      ),
    [rankingQuery.results, ranking],
  )
  const splitAll = useMemo(
    () =>
      rankingRows(
        splitQuery.results.map((result) => result?.response),
        ranking,
        search.country !== undefined ? [search.country] : [],
      ),
    [splitQuery.results, ranking, search.country],
  )
  const itemRows = useMemo(() => {
    const response = itemQuery.results[0]?.response
    if (!response || !metaData) return []
    let rows = response.rows
    if (item?.default_stat === 'proportion') {
      const level = search.level ?? itemLevels[0]?.value ?? highestLevel(rows)
      if (level !== undefined) rows = rows.filter((row) => row.level === level)
    }
    return sortAtlasRows(rows, metaData, search.sort, dir)
  }, [itemQuery.results, metaData, item, search.level, search.sort, dir, itemLevels])

  if (meta.isPending || variables.isPending) {
    return (
      <section>
        <h2>What Matters</h2>
        <LoadingBlock height={420} label="Loading What Matters" />
      </section>
    )
  }
  if (meta.isError || variables.isError || !meta.data || !variables.data) {
    return (
      <section>
        <h2>What Matters</h2>
        <ErrorState error={meta.error ?? variables.error} />
      </section>
    )
  }
  const served = meta.data.meta
  const itemLabeler: LevelLabeler = (column, value) =>
    column === 'outcome' ? byName[String(value)]?.display_name : undefined
  const itemDomain = ranking.map((entry) => entry.display_name)
  const demographics = served.breakdowns.filter((column) => column !== 'country_code')
  const countryName = (code: number) => groupValueLabel('country_code', code, served)
  const first = ranking[0]
  const rankingSubtitle = first
    ? `${scaleSubtitle(first, 'mean')} · ${MIDYEAR_TITLE}, 2024`
    : `${MIDYEAR_TITLE}, 2024`
  const csvFor = (response: EstimateResponse, stem: string): CsvExport => ({
    kind: 'client',
    onDownload: () =>
      downloadTextFile(
        csvFilename(stem, 'MY', response.meta.stat, response.meta.data_version),
        responseToCsv(response),
      ),
  })
  const rankingResponse = withMeta(
    rankingAll,
    rankingQuery.results[0]?.response,
    served,
    ranking.map((entry) => entry.name).join(','),
    ['outcome', 'country_code'],
  )
  const splitResponse = withMeta(
    splitAll,
    splitQuery.results[0]?.response,
    served,
    ranking.map((entry) => entry.name).join(','),
    ['outcome', 'country_code', search.by],
  )
  const groupLabel = (column: string, value: string | number) =>
    column === 'outcome' ? byName[String(value)]?.display_name : undefined
  const offline = (error: unknown) =>
    error instanceof NetworkError && boot.state !== 'ready' ? (
      <p className={styles.hint} role="status">
        This view needs the live data service, which is offline right now — the Atlas and Breakdowns
        still work.
      </p>
    ) : (
      <ErrorState error={error} />
    )
  const itemStat: Stat = (item?.default_stat as Stat | undefined) ?? 'mean'
  const itemLevel = search.level ?? itemLevels[0]?.value
  const itemLevelLabel = itemLevels.find((level) => level.value === itemLevel)?.label
  const itemSubtitle = item
    ? `${
        itemStat === 'proportion'
          ? itemLevelLabel
            ? `share answering “${itemLevelLabel}”`
            : 'weighted share'
          : scaleSubtitle(item, itemStat)
      } · ${MIDYEAR_TITLE}, 2024`
    : ''
  const itemResponse = itemQuery.results[0]?.response

  const rankingOptions = (
    <>
      <RadioRow
        legend="Sort countries"
        name="sort"
        options={[
          { value: 'name', label: 'A–Z' },
          { value: 'estimate', label: 'By value' },
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
  )

  return (
    <section>
      <h2 className="visually-hidden">What Matters</h2>
      <p className={styles.deck}>
        <span className={styles.deckLong}>
          What people said mattered most in their lives — money, relationships, meaning, health,
          faith, happiness, being a good person — in the midyear survey of 2024, and how that
          differs by country and by age.
        </span>
        <span className={styles.deckShort}>
          What people said mattered most, midyear 2024, by country and by age.
        </span>
      </p>
      <InvalidParamsNotice
        invalid={search.invalid}
        onDismiss={() =>
          void navigate({
            search: whatMattersSearchParams({
              ...search,
              invalid: undefined,
              invalidRaw: undefined,
            }) as never,
            replace: true,
          })
        }
      />

      {ranking.length === 0 ? (
        <EmptyState title="No midyear questions in this release">
          <p>The catalog lists no midyear items to rank.</p>
        </EmptyState>
      ) : (
        <>
          <div className={styles.controls}>
            {narrow ? (
              <details className={styles.moreOptions}>
                <summary>Options — sort</summary>
                <div className={styles.moreBody}>{rankingOptions}</div>
              </details>
            ) : (
              rankingOptions
            )}
          </div>
          {rankingQuery.isPending ? (
            <LoadingBlock height={720} label="Loading estimates" />
          ) : rankingQuery.isError ? (
            offline(rankingQuery.error)
          ) : (
            <ChartFigure
              title="What matters most, by country"
              subtitle={rankingSubtitle}
              ariaLabel={`How important people rate ${ranking.length} things, one panel per country, ${MIDYEAR_TITLE} 2024. The data table below carries every number, with its n.`}
              marks="dots"
              response={rankingResponse}
              meta={served}
              csv={csvFor(rankingResponse, 'what-matters')}
              isRefreshing={rankingQuery.isPlaceholderData}
              groupLabel={groupLabel}
            >
              <SmallMultiples
                rows={rankingAll}
                meta={served}
                responseMeta={rankingResponse.meta}
                variable={first as VariableSummary}
                color={SERIES[0]}
                levelColumn="outcome"
                levelDomain={itemDomain}
                sort={search.sort}
                dir={dir}
                labeler={itemLabeler}
                labelWidth={230}
              />
            </ChartFigure>
          )}

          <h3 className={styles.sectionTitle}>How the ranking shifts within a country</h3>
          <div className={styles.controls}>
            <label className={styles.oriented}>
              Country{' '}
              <select
                value={search.country ?? ''}
                onChange={(event) =>
                  setSearch({
                    country: event.target.value ? Number(event.target.value) : undefined,
                  })
                }
              >
                <option value="">Choose a country…</option>
                {[...served.countries]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className={styles.oriented}>
              Split by{' '}
              <select value={search.by} onChange={(event) => setSearch({ by: event.target.value })}>
                {demographics.map((column) => (
                  <option key={column} value={column}>
                    {columnLabel(column, served)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {search.country === undefined ? (
            <p className={styles.hint}>
              Choose a country to see how the ranking shifts by{' '}
              {columnLabel(search.by, served).toLowerCase()}.
            </p>
          ) : splitQuery.isPending ? (
            <LoadingBlock height={520} label="Loading estimates" />
          ) : splitQuery.isError ? (
            offline(splitQuery.error)
          ) : (
            <ChartFigure
              title={`${countryName(search.country)} by ${columnLabel(search.by, served).toLowerCase()}`}
              subtitle={rankingSubtitle}
              ariaLabel={`${countryName(search.country)}: how important people rate ${ranking.length} things, one panel per ${columnLabel(search.by, served).toLowerCase()}, ${MIDYEAR_TITLE} 2024. The data table below carries every number.`}
              marks="dots"
              response={splitResponse}
              meta={served}
              csv={csvFor(splitResponse, `what-matters-${search.country}-${search.by}`)}
              isRefreshing={splitQuery.isPlaceholderData}
              groupLabel={groupLabel}
            >
              <SmallMultiples
                rows={splitAll}
                meta={served}
                responseMeta={splitResponse.meta}
                variable={first as VariableSummary}
                color={SERIES[0]}
                levelColumn="outcome"
                levelDomain={itemDomain}
                facetColumn={search.by}
                facetDomain={levelDomain(search.by, served)}
                sort="name"
                labeler={itemLabeler}
                labelWidth={230}
              />
            </ChartFigure>
          )}
        </>
      )}

      <h3 className={styles.sectionTitle}>Two things that travel together</h3>
      <p className={styles.hint}>
        Associated with, not caused by: people who answer one way also differ in a hundred
        unmeasured ways. <Link to="/methods">How these numbers are made</Link>
      </p>
      {crossings.map(({ crossing, wave }, index) => {
        if (wave === undefined) {
          return (
            <p key={crossing.key} className={styles.hint}>
              {crossingUnavailableCopy(crossing, byName)}
            </p>
          )
        }
        const position = crossings
          .slice(0, index)
          .filter((entry) => entry.wave !== undefined).length
        const response = crossingQuery.results[position]?.response
        const detail = crossingDetails.details[position]
        const outcome = byName[crossing.outcome]
        if (crossingQuery.isPending || !outcome) {
          return (
            <LoadingBlock key={crossing.key} height={520} label={`Loading ${crossing.title}`} />
          )
        }
        if (crossingQuery.isError || !response) {
          return <div key={crossing.key}>{offline(crossingQuery.error)}</div>
        }
        const levels = new Map(outcomeLevels(detail).map((level) => [level.value, level.label]))
        const labeler: LevelLabeler = (column, value) =>
          column === crossing.by && typeof value === 'number' ? levels.get(value) : undefined
        const rows =
          outcome.default_stat === 'proportion'
            ? response.rows.filter((row) => row.level === highestLevel(response.rows))
            : response.rows
        return (
          <ChartFigure
            key={crossing.key}
            title={crossing.title}
            subtitle={`${outcome.display_name} by ${byName[crossing.by]?.display_name ?? crossing.by} · ${WAVE_TITLES[wave] ?? wave}`}
            ariaLabel={`${crossing.title}: ${outcome.display_name} for each answer to ${byName[crossing.by]?.display_name ?? crossing.by}, one panel per country. Associated with, not caused by. The data table below carries every number.`}
            marks="dots"
            response={{ ...response, rows }}
            meta={served}
            csv={csvFor({ ...response, rows }, `${crossing.outcome}-by-${crossing.by}`)}
            isRefreshing={crossingQuery.isPlaceholderData}
            groupLabel={labeler}
          >
            <SmallMultiples
              rows={rows}
              meta={served}
              responseMeta={response.meta}
              variable={outcome}
              color={outcomeColor(outcome.name)}
              levelColumn={crossing.by}
              levelDomain={levelDomain(crossing.by, served, detail)}
              sort="name"
              labeler={labeler}
            />
          </ChartFigure>
        )
      })}

      {chartable.length > 0 && item && (
        <>
          <h3 className={styles.sectionTitle}>The other midyear questions</h3>
          <div className={styles.controls}>
            <label className={styles.oriented}>
              Question{' '}
              <select
                value={item.name}
                onChange={(event) => setSearch({ item: event.target.value, level: undefined })}
              >
                {chartable.map((candidate) => (
                  <option key={candidate.name} value={candidate.name}>
                    {candidate.display_name}
                  </option>
                ))}
              </select>
            </label>
            {itemStat === 'proportion' && itemLevels.length > 0 && (
              <RadioRow
                legend="Answer level"
                name="item-level"
                wide
                selectOnNarrow
                options={itemLevels.map((entry) => ({
                  value: String(entry.value),
                  label: entry.label,
                }))}
                value={String(itemLevel)}
                onChange={(value) => setSearch({ level: Number(value) })}
              />
            )}
          </div>
          {itemQuery.isPending ? (
            <LoadingBlock height={420} label="Loading estimates" />
          ) : itemQuery.isError ? (
            offline(itemQuery.error)
          ) : itemResponse ? (
            <ChartFigure
              title={item.display_name}
              subtitle={itemSubtitle}
              ariaLabel={summarizeExtremes(
                itemRows,
                served,
                `${item.display_name} (${itemSubtitle}) by country.`,
              )}
              marks={itemStat === 'proportion' ? 'bars' : 'dots'}
              intro={
                itemDetail && (
                  <div className={styles.wording}>
                    <WordingPanel detail={itemDetail} />
                  </div>
                )
              }
              response={{ ...itemResponse, rows: itemRows }}
              meta={served}
              csv={csvFor({ ...itemResponse, rows: itemRows }, item.name)}
              isRefreshing={itemQuery.isPlaceholderData}
            >
              <RankedBar
                rows={itemRows}
                meta={served}
                responseMeta={itemResponse.meta}
                variable={item}
                color={outcomeColor(item.name)}
                levelLabel={itemLevelLabel}
              />
            </ChartFigure>
          ) : null}
        </>
      )}
    </section>
  )
}
