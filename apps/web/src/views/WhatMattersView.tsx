// What Matters (Phase 5): the midyear survey — what people said mattered
// most, as one matrix of countries × the seven importance items (the
// tinted-table component the Correlates view uses); how that ranking
// shifts within one country by age band (or another demographic); and
// the family's other questions, chartable one at a time. The item list
// comes from the catalog by family; the ranking set is navigation copy
// in topics.ts.

import { getRouteApi } from '@tanstack/react-router'
import { useMemo } from 'react'
import { NetworkError } from '../api/errors'
import { useEstimatesMany } from '../api/estimates'
import { useBootStatus, useMeta } from '../api/meta'
import type { EstimateResponse, EstimateRow, Meta, Stat, VariableSummary } from '../api/types'
import { useVariable, useVariables } from '../api/variables'
import { useWarmApi } from '../api/warm'
import { ChartFigure, type CsvExport } from '../charts/ChartFigure'
import type { LevelLabeler } from '../charts/DotPlot'
import { RankedBar } from '../charts/RankedBar'
import { SmallMultiples } from '../charts/SmallMultiples'
import { summarizeExtremes } from '../charts/summary'
import { SERIES, outcomeColor, quantizeSequential } from '../charts/theme'
import { HeatTable, intervalText } from '../charts/TransitionTable'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingBlock } from '../components/Loading'
import { InvalidParamsNotice } from '../components/Notice'
import { WordingPanel } from '../components/WordingPanel'
import { RadioRow } from '../components/controls/RadioRow'
import { csvFilename, downloadTextFile, responseToCsv } from '../export/csv'
import { formatEstimate } from '../format'
import {
  columnLabel,
  groupValueLabel,
  highestLevel,
  levelDomain,
  outcomeLevels,
  scaleSubtitle,
} from '../labels'
import { defaultDir, sortAtlasRows } from '../sortRows'
import { searchNavigation } from '../state/navigate'
import {
  whatMattersRequest,
  whatMattersSearchParams,
  type WhatMattersSearch,
} from '../state/search'
import { splitMidyear } from '../topics'
import { NARROW_VIEWPORT, useMediaQuery } from '../useMediaQuery'
import { WAVE_TITLES } from '../waves'
import { matrixCountryOrder, matrixRange, orderMatrixRows, rankingRows } from './whatMattersRows'
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
  // The country order: A–Z, or by one importance item's value.
  const sortKey = search.sort === 'name' ? 'name' : 'estimate'
  const dir = search.dir ?? defaultDir(sortKey)

  const setSearch = (patch: Partial<WhatMattersSearch>) => {
    void navigate(searchNavigation(whatMattersSearchParams({ ...search, ...patch })))
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
  // 3. One chartable item by country.
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
  const countryOrder = useMemo(
    () => (metaData ? matrixCountryOrder(rankingAll, metaData, search.sort, dir) : []),
    [rankingAll, metaData, search.sort, dir],
  )
  const rankingOrdered = useMemo(
    () => orderMatrixRows(rankingAll, countryOrder, ranking),
    [rankingAll, countryOrder, ranking],
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
    return sortAtlasRows(rows, metaData, sortKey, dir)
  }, [itemQuery.results, metaData, item, search.level, sortKey, dir, itemLevels])

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
        <ErrorState apiReachable={boot.apiReachable} error={meta.error ?? variables.error} />
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
    ? `${scaleSubtitle(first, 'mean')} · ${MIDYEAR_TITLE}`
    : MIDYEAR_TITLE
  const csvFor = (response: EstimateResponse, stem: string): CsvExport => ({
    kind: 'client',
    onDownload: () =>
      downloadTextFile(
        csvFilename(stem, 'MY', response.meta.stat, response.meta.data_version),
        responseToCsv(response),
      ),
  })
  const rankingResponse = withMeta(
    rankingOrdered,
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
    error instanceof NetworkError && !boot.apiReachable ? (
      <p className={styles.hint} role="status">
        This view needs the live data service, which is offline right now — the Atlas and Breakdowns
        still work.
      </p>
    ) : (
      <ErrorState apiReachable={boot.apiReachable} error={error} />
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
          : scaleSubtitle(item, itemStat, itemDetail)
      } · ${MIDYEAR_TITLE}`
    : ''
  const itemResponse = itemQuery.results[0]?.response

  const rankingOptions = (
    <>
      <label className={styles.oriented}>
        Sort countries{' '}
        <select
          value={ranking.some((item) => item.name === search.sort) ? search.sort : 'name'}
          onChange={(event) => setSearch({ sort: event.target.value, dir: undefined })}
        >
          <option value="name">A–Z</option>
          {ranking.map((item) => (
            <option key={item.name} value={item.name}>
              By {item.display_name}
            </option>
          ))}
        </select>
      </label>
      <RadioRow
        legend="Order"
        name="dir"
        options={
          sortKey === 'name'
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
          faith, happiness, being a good person — in the midyear survey (Nov 2023–Dec 2024), and how
          that differs by country and by age.
        </span>
        <span className={styles.deckShort}>
          What people said mattered most, in the midyear survey, by country and by age.
        </span>
      </p>
      <nav className={styles.anchors} aria-label="On this page">
        <a href="#by-country">By country</a>
        <a href="#within-country">Within a country</a>
        <a href="#other-questions">The other midyear questions</a>
      </nav>
      <InvalidParamsNotice
        invalid={search.invalid}
        onDismiss={() =>
          void navigate(
            searchNavigation(
              whatMattersSearchParams({ ...search, invalid: undefined, invalidRaw: undefined }),
              { replace: true },
            ),
          )
        }
      />

      {ranking.length === 0 ? (
        <EmptyState title="No midyear questions in this release">
          <p>The catalog lists no midyear items to rank.</p>
        </EmptyState>
      ) : (
        <>
          <h3 className={styles.sectionTitle} id="by-country">
            By country
          </h3>
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
              ariaLabel={`How important people rate ${ranking.length} things in each of ${countryOrder.length} countries, as a matrix: a row per country, a column per thing, deeper tint for higher importance, ${MIDYEAR_TITLE}. The data table below carries every number, with its n.`}
              marks="table"
              response={rankingResponse}
              meta={served}
              csv={csvFor(rankingResponse, 'what-matters')}
              isRefreshing={rankingQuery.isPlaceholderData}
              groupLabel={groupLabel}
            >
              <ImportanceMatrix
                rows={rankingAll}
                items={ranking}
                countryOrder={countryOrder}
                served={served}
              />
            </ChartFigure>
          )}

          <h3 className={styles.sectionTitle} id="within-country">
            Within a country
          </h3>
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
              ariaLabel={`${countryName(search.country)}: how important people rate ${ranking.length} things, one panel per ${columnLabel(search.by, served).toLowerCase()}, ${MIDYEAR_TITLE}. The data table below carries every number.`}
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

      {chartable.length > 0 && item && (
        <>
          <h3 className={styles.sectionTitle} id="other-questions">
            The other midyear questions
          </h3>
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

/** Countries × the importance items: each cell the weighted mean with a
 * sequential tint over the matrix's range, the interval and n in its
 * tooltip; the first column stays put while a phone scrolls the rest. */
function ImportanceMatrix({
  rows,
  items,
  countryOrder,
  served,
}: {
  rows: readonly EstimateRow[]
  items: readonly VariableSummary[]
  countryOrder: readonly number[]
  served: Meta
}) {
  const cells = new Map<string, EstimateRow>()
  for (const row of rows)
    cells.set(`${String(row.group['outcome'])}:${String(row.group['country_code'])}`, row)
  const [lo, hi] = matrixRange(rows)
  const tint = quantizeSequential([lo, hi])
  return (
    <HeatTable
      caption={`Deeper tint, higher importance (${formatEstimate(lo, 'mean')}–${formatEstimate(hi, 'mean')})`}
      corner="Country ↓ · what matters →"
      columnNoun="things"
      rows={countryOrder.map((code) => ({
        key: String(code),
        label: groupValueLabel('country_code', code, served),
      }))}
      columns={items.map((item) => ({ key: item.name, label: item.display_name }))}
      cellAt={(row, column) => {
        const cell = cells.get(`${column.key}:${row.key}`)
        if (!cell) return undefined
        return {
          text: formatEstimate(cell.estimate, cell.stat),
          title: `${formatEstimate(cell.estimate, cell.stat)}  ${row.label} · ${column.label}\n${intervalText(cell)}`,
          tint: cell.estimate === null ? 'transparent' : tint(cell.estimate),
        }
      }}
    />
  )
}
