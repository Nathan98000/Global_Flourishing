// What Matters (Phase 5): the midyear survey — what people said mattered
// most, as one matrix of countries × the seven importance items (the
// tinted-table component the Correlates view uses); how that ranking
// shifts within one country by age band (or another demographic); and
// the family's other questions, chartable one at a time. One of the
// three is on screen at a time (`view`, owner decision 25 Sept 2026):
// the others mount nothing and fetch nothing. The item list comes from
// the catalog by family; the ranking set is navigation copy in topics.ts.

import { getRouteApi, useLocation } from '@tanstack/react-router'
import { useEffect, useMemo } from 'react'
import { NetworkError } from '../api/errors'
import { useEstimatesMany } from '../api/estimates'
import { useBootStatus, useMeta } from '../api/meta'
import type { EstimateResponse, EstimateRow, Meta, Stat, VariableSummary } from '../api/types'
import { useVariable, useVariables } from '../api/variables'
import { useWarmApi } from '../api/warm'
import { ChartFigure, type CsvExport } from '../charts/ChartFigure'
import { RankedBar } from '../charts/RankedBar'
import { summarizeExtremes } from '../charts/summary'
import { SEQUENTIAL_RAMP, outcomeColor, quantizeSequential } from '../charts/theme'
import { HEAT_CELL_PAD, HeatTable, headerFont, intervalText } from '../charts/TransitionTable'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingBlock } from '../components/Loading'
import { InvalidParamsNotice } from '../components/Notice'
import { WordingPanel } from '../components/WordingPanel'
import { RadioRow, type RadioOption } from '../components/controls/RadioRow'
import { downloadTextFile, responseToCsv } from '../export/csv'
import { exportFilename, type ExportName } from '../export/filename'
import { formatEstimate } from '../format'
import { columnLabel, groupValueLabel, highestLevel, outcomeLevels, scaleSubtitle } from '../labels'
import { defaultDir, sortAtlasRows, type SortDir } from '../sortRows'
import { searchNavigation } from '../state/navigate'
import {
  whatMattersRequest,
  whatMattersSearchParams,
  type WhatMattersSearch,
} from '../state/search'
import { splitMidyear } from '../topics'
import { NARROW_VIEWPORT, useMediaQuery } from '../useMediaQuery'
import { WAVE_CHIPS, WAVE_TITLES } from '../waves'
import {
  columnRanges,
  defaultSplitCountry,
  itemLabel,
  matrixCountryOrder,
  narrowestWrap,
  orderMatrixRows,
  rankingRows,
  splitGroupOrder,
} from './whatMattersRows'
import styles from './AtlasView.module.css'

const route = getRouteApi('/what-matters')

const MIDYEAR_TITLE = WAVE_TITLES['MY'] ?? 'Midyear survey'

const VIEW_OPTIONS: RadioOption<WhatMattersSearch['view']>[] = [
  { value: 'country', label: 'By country' },
  { value: 'within', label: 'Within a country' },
  { value: 'questions', label: 'Other questions' },
]

/** The matrix's column width: seven columns beside the row labels fit
 * the 60rem page column with no sideways scroll, and every label wraps
 * to two lines at most ("A meaningful / life"). */
const MATRIX_COLUMN = 98

/** On a phone the matrix's columns narrow to the least width at which
 * every label wraps to at most three lines, measured in the header's
 * own face (the numbers need far less); elsewhere, MATRIX_COLUMN. */
function useMatrixColumn(labels: readonly string[], narrow: boolean): number {
  return useMemo(() => {
    if (!narrow) return MATRIX_COLUMN
    const context = document.createElement('canvas').getContext('2d')
    if (!context) return MATRIX_COLUMN
    context.font = headerFont()
    const text = narrowestWrap(labels, (value) => context.measureText(value).width, 3)
    return Math.ceil(text) + 2 * HEAT_CELL_PAD
  }, [labels, narrow])
}

/** The Order control's two readings: names A→Z, values high-first. */
const NAME_ORDER: RadioOption<SortDir>[] = [
  { value: 'asc', label: 'A to Z' },
  { value: 'desc', label: 'Z to A' },
]
const VALUE_ORDER: RadioOption<SortDir>[] = [
  { value: 'desc', label: 'High to low' },
  { value: 'asc', label: 'Low to high' },
]

/** The in-page anchors the page had before the view switcher: an old
 * link's hash picks the matching view. */
const HASH_VIEWS: Record<string, WhatMattersSearch['view']> = {
  'by-country': 'country',
  'within-country': 'within',
  'other-questions': 'questions',
}

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
  const hash = useLocation({ select: (location) => location.hash })
  const meta = useMeta()
  const boot = useBootStatus()
  const variables = useVariables()
  const narrow = useMediaQuery(NARROW_VIEWPORT)
  const byName = useMemo(() => variables.data?.byName ?? {}, [variables.data])
  const { ranking, chartable } = useMemo(
    () => splitMidyear(variables.data?.list ?? []),
    [variables.data],
  )
  const labels = useMemo(() => ranking.map((entry) => itemLabel(entry)), [ranking])
  const columnWidth = useMatrixColumn(labels, narrow)
  // The country order: A–Z, or by one importance item's value (a code
  // that names no item reads as A–Z).
  const matrixSort = ranking.some((entry) => entry.name === search.sort) ? search.sort : 'name'
  const sortKey = matrixSort === 'name' ? 'name' : 'estimate'
  const dir = search.dir ?? defaultDir(sortKey)
  // The other questions' chart keeps its own order (qsort/qdir).
  const qdir = search.qdir ?? defaultDir(search.qsort)

  const setSearch = (patch: Partial<WhatMattersSearch>) => {
    void navigate(searchNavigation(whatMattersSearchParams({ ...search, ...patch })))
  }

  // An old link's anchor (#within-country) selects its view; the hash
  // goes, replacing the entry rather than adding one.
  useEffect(() => {
    const view = HASH_VIEWS[hash]
    if (view === undefined) return
    void navigate(searchNavigation(whatMattersSearchParams({ ...search, view }), { replace: true }))
    // Only a new hash triggers this; the search it carries is current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash])

  // 1. The ranking by country: one midyear cross-section per item.
  const rankingRequests = useMemo(
    () => ranking.map((item) => whatMattersRequest(item.name, item)),
    [ranking],
  )
  const rankingQuery = useEstimatesMany(rankingRequests, { enabled: search.view === 'country' })
  // 2. The same seven items split by a demographic; one country's rows
  // are kept (the United States until another is chosen).
  const splitRequests = useMemo(
    () => ranking.map((item) => whatMattersRequest(item.name, item, search.by)),
    [ranking, search.by],
  )
  const splitQuery = useEstimatesMany(splitRequests, { enabled: search.view === 'within' })
  // 3. One chartable item by country.
  const item: VariableSummary | undefined =
    (search.item !== undefined ? byName[search.item] : undefined) ?? chartable[0]
  const itemRequests = useMemo(() => (item ? [whatMattersRequest(item.name, item)] : []), [item])
  const itemQuery = useEstimatesMany(itemRequests, { enabled: search.view === 'questions' })
  const itemDetail = useVariable(search.view === 'questions' && item ? item.name : null).data
    ?.detail
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
  const splitCountry = search.country ?? (metaData ? defaultSplitCountry(metaData) : undefined)
  const splitAll = useMemo(
    () =>
      rankingRows(
        splitQuery.results.map((result) => result?.response),
        ranking,
        splitCountry !== undefined ? [splitCountry] : [],
      ),
    [splitQuery.results, ranking, splitCountry],
  )
  const splitGroups = useMemo(
    () => (metaData ? splitGroupOrder(splitAll, search.by, metaData) : []),
    [splitAll, search.by, metaData],
  )
  const splitOrdered = useMemo(
    () => orderMatrixRows(splitAll, splitGroups, ranking, search.by),
    [splitAll, splitGroups, ranking, search.by],
  )
  const itemRows = useMemo(() => {
    const response = itemQuery.results[0]?.response
    if (!response || !metaData) return []
    let rows = response.rows
    if (item?.default_stat === 'proportion') {
      const level = search.level ?? itemLevels[0]?.value ?? highestLevel(rows)
      if (level !== undefined) rows = rows.filter((row) => row.level === level)
    }
    return sortAtlasRows(rows, metaData, search.qsort, qdir)
  }, [itemQuery.results, metaData, item, search.level, search.qsort, qdir, itemLevels])

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
  const demographics = served.breakdowns.filter((column) => column !== 'country_code')
  const countryName = (code: number) => groupValueLabel('country_code', code, served)
  const splitLabel = columnLabel(search.by, served)
  const first = ranking[0]
  // The scale, said once (the columns drop "Importance:").
  const scale =
    first && first.min !== null && first.max !== null ? `, ${first.min}–${first.max}` : ''
  const rankingSubtitle = `How important${scale} · ${MIDYEAR_TITLE}`
  const csvFor = (response: EstimateResponse, name: ExportName): CsvExport => ({
    kind: 'client',
    onDownload: () => downloadTextFile(exportFilename(name, 'csv'), responseToCsv(response)),
  })
  // What a download is called, in words (ADR-0016): the ranking, its
  // split for one country, or the single item.
  const rankingName: ExportName = {
    measure: 'What matters most',
    view: 'By country',
    waves: WAVE_CHIPS['MY'] ?? 'MY',
  }
  const splitName: ExportName = {
    ...rankingName,
    breakdown: columnLabel(search.by, served),
    ...(splitCountry !== undefined ? { country: countryName(splitCountry) } : {}),
  }
  const rankingResponse = withMeta(
    rankingOrdered,
    rankingQuery.results[0]?.response,
    served,
    ranking.map((entry) => entry.name).join(','),
    ['outcome', 'country_code'],
  )
  const splitResponse = withMeta(
    splitOrdered,
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
      <div className={styles.controls}>
        <RadioRow
          legend="View"
          name="view"
          options={VIEW_OPTIONS}
          value={search.view}
          onChange={(view) => setSearch({ view })}
        />
      </div>
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

      {search.view !== 'questions' && ranking.length === 0 && (
        <EmptyState title="No midyear questions in this release">
          <p>The catalog lists no midyear items to rank.</p>
        </EmptyState>
      )}

      {search.view === 'country' && ranking.length > 0 && (
        <>
          <div className={styles.controls}>
            <label className={styles.oriented}>
              Sort countries by{' '}
              <select
                value={matrixSort}
                onChange={(event) => setSearch({ sort: event.target.value, dir: undefined })}
              >
                <option value="name">Country name</option>
                {ranking.map((entry) => (
                  <option key={entry.name} value={entry.name}>
                    {itemLabel(entry)}
                  </option>
                ))}
              </select>
            </label>
            <RadioRow
              legend="Order"
              name="dir"
              options={sortKey === 'name' ? NAME_ORDER : VALUE_ORDER}
              value={dir}
              onChange={(value) => setSearch({ dir: value })}
            />
          </div>
          {rankingQuery.isPending ? (
            <LoadingBlock height={720} label="Loading estimates" />
          ) : rankingQuery.isError ? (
            offline(rankingQuery.error)
          ) : (
            <ChartFigure
              title="What matters most, by country"
              subtitle={rankingSubtitle}
              ariaLabel={`How important people rate ${count(ranking.length, 'item')} in each of ${count(countryOrder.length, 'country', 'countries')}, as a matrix: a row per country, a column per item, ${MIDYEAR_TITLE}. The data table below carries every number, with its n.`}
              marks="table"
              response={rankingResponse}
              meta={served}
              csv={csvFor(rankingResponse, rankingName)}
              exportName={rankingName}
              isRefreshing={rankingQuery.isPlaceholderData}
              groupLabel={groupLabel}
            >
              <ImportanceMatrix
                rows={rankingAll}
                items={ranking}
                rowColumn="country_code"
                rowOrder={countryOrder}
                corner="Country ↓ · what matters →"
                served={served}
                columnWidth={columnWidth}
                sort={matrixSort === 'name' ? undefined : { column: matrixSort, dir }}
              />
            </ChartFigure>
          )}
        </>
      )}

      {search.view === 'within' && ranking.length > 0 && (
        <>
          <div className={styles.controls}>
            <label className={styles.oriented}>
              Country{' '}
              <select
                value={splitCountry}
                onChange={(event) => {
                  const code = Number(event.target.value)
                  setSearch({ country: code === defaultSplitCountry(served) ? undefined : code })
                }}
              >
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
          {splitQuery.isPending ? (
            <LoadingBlock height={520} label="Loading estimates" />
          ) : splitQuery.isError ? (
            offline(splitQuery.error)
          ) : (
            splitCountry !== undefined && (
              <ChartFigure
                title={`${countryName(splitCountry)} by ${splitLabel.toLowerCase()}`}
                subtitle={rankingSubtitle}
                ariaLabel={`${countryName(splitCountry)}: how important people rate ${count(ranking.length, 'item')}, as a matrix: a row per ${splitLabel.toLowerCase()}, a column per item, ${MIDYEAR_TITLE}. The data table below carries every number, with its n.`}
                marks="table"
                response={splitResponse}
                meta={served}
                csv={csvFor(splitResponse, splitName)}
                exportName={splitName}
                isRefreshing={splitQuery.isPlaceholderData}
                groupLabel={groupLabel}
              >
                <ImportanceMatrix
                  rows={splitAll}
                  items={ranking}
                  rowColumn={search.by}
                  rowOrder={splitGroups}
                  corner={`${splitLabel} ↓ · what matters →`}
                  served={served}
                  columnWidth={columnWidth}
                />
              </ChartFigure>
            )
          )}
        </>
      )}

      {search.view === 'questions' && (!item || chartable.length === 0) && (
        <EmptyState title="No other midyear questions in this release">
          <p>The catalog lists no other midyear items to chart.</p>
        </EmptyState>
      )}

      {search.view === 'questions' && chartable.length > 0 && item && (
        <>
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
            <RadioRow
              legend="Sort"
              name="qsort"
              options={[
                { value: 'estimate', label: 'By value' },
                { value: 'name', label: 'A–Z' },
              ]}
              value={search.qsort}
              onChange={(qsort) => setSearch({ qsort, qdir: undefined })}
            />
            <RadioRow
              legend="Order"
              name="qdir"
              options={search.qsort === 'name' ? NAME_ORDER : VALUE_ORDER}
              value={qdir}
              onChange={(value) => setSearch({ qdir: value })}
            />
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
              csv={csvFor(
                { ...itemResponse, rows: itemRows },
                { ...rankingName, measure: item.display_name },
              )}
              exportName={{ ...rankingName, measure: item.display_name }}
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

/** "1 item", "7 items". */
function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** The matrix's key, in its caption's place: the seven ramp steps from
 * lower to higher — the tokens themselves, so it reads true in either
 * theme — and the rule that each column is shaded on its own range. */
function TintLegend() {
  return (
    <span className={styles.legend}>
      <span className={styles.legendKey}>
        Lower{' '}
        <span className={styles.ramp} aria-hidden="true">
          {SEQUENTIAL_RAMP.map((token) => (
            <span key={token} style={{ background: token }} />
          ))}
        </span>{' '}
        Higher
      </span>{' '}
      · each column shaded on its own range
    </span>
  )
}

/** Rows × the importance items — countries, or one country's groups —
 * each cell the weighted mean, tinted on its column's own range across
 * the rows shown (the legend says so), the interval in its tooltip;
 * every column one width, its short label wrapping over it; the first
 * column stays put while a phone scrolls the rest. */
function ImportanceMatrix({
  rows,
  items,
  rowColumn,
  rowOrder,
  corner,
  served,
  columnWidth,
  sort,
}: {
  rows: readonly EstimateRow[]
  items: readonly VariableSummary[]
  /** The group column a row stands for, and its values in row order. */
  rowColumn: string
  rowOrder: readonly (string | number)[]
  corner: string
  served: Meta
  columnWidth: number
  /** The item the rows are ordered by (none: the rows' own order). */
  sort?: { column: string; dir: SortDir }
}) {
  const cells = new Map<string, EstimateRow>()
  for (const row of rows)
    cells.set(`${String(row.group['outcome'])}:${String(row.group[rowColumn])}`, row)
  // One scale per column, over the rows on screen.
  const shown = new Set<unknown>(rowOrder)
  const tints = new Map(
    [...columnRanges(rows.filter((row) => shown.has(row.group[rowColumn])))].map(
      ([item, range]) => [item, quantizeSequential(range)],
    ),
  )
  return (
    <HeatTable
      caption={<TintLegend />}
      corner={corner}
      rows={rowOrder.map((value) => ({
        key: String(value),
        label: groupValueLabel(rowColumn, value, served),
      }))}
      columns={items.map((item) => ({ key: item.name, label: itemLabel(item) }))}
      columnWidth={columnWidth}
      sort={sort}
      cellAt={(row, column) => {
        const cell = cells.get(`${column.key}:${row.key}`)
        if (!cell) return undefined
        return {
          text: formatEstimate(cell.estimate, cell.stat),
          title: `${formatEstimate(cell.estimate, cell.stat)}  ${row.label} · ${column.label}\n${intervalText(cell)}`,
          tint:
            cell.estimate === null
              ? 'transparent'
              : (tints.get(column.key)?.(cell.estimate) ?? 'transparent'),
        }
      }}
    />
  )
}
