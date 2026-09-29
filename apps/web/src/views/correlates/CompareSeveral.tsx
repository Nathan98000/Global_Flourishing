// Compare several (ADR-0019): how strongly each pair among 2–10 questions
// goes together, as a lower-triangle table. The questions sit in a set
// builder (chips to drag or move with the keyboard, a multi-select "+ Add
// questions"); the table starts from Compare two's pair and the first
// question's top four correlates (after the ranking's overlap dedupe), so
// it is never empty. Its order is as added, or similar together — the
// server's clustering; the page only reorders. Rows are questions 2…n and
// columns 1…n−1, named by their short names (the columns angled); the
// tint runs on a fixed −1 to 1, so a shade means the same number in every
// table. A cell opens Compare two with the pair.

import { useEffect, useMemo } from 'react'
import { predictorOrder, useCorrelates } from '../../api/correlates'
import type { CorrelationMethod } from '../../api/correlates'
import { useCorrelationTable } from '../../api/correlations'
import type { CorrelationsResponse, EstimateResponse, Meta, Wave } from '../../api/types'
import { ChartFigure } from '../../charts/ChartFigure'
import { divergingTint } from '../../charts/theme'
import { HeatTable } from '../../charts/TransitionTable'
import { EmptyState } from '../../components/EmptyState'
import { LoadingBlock } from '../../components/Loading'
import { RadioRow } from '../../components/controls/RadioRow'
import { correlationTableToCsv, downloadTextFile } from '../../export/csv'
import { exportFilename, type ExportName } from '../../export/filename'
import { formatEstimate } from '../../format'
import { shortName } from '../../labels'
import {
  TABLE_MIN,
  correlatesRequest,
  firstQuestion,
  secondQuestion,
  tableRequest,
  type CorrelatesOrder,
} from '../../state/search'
import {
  CORRELATES_NOTE,
  FEW_PEOPLE_HIDDEN,
  NO_ESTIMATE,
  coverageLine,
  pooledPlace,
  starred,
  statisticPhrase,
  withCoverage,
} from '../correlatesRows'
import { QuestionSet } from './QuestionSet'
import {
  otherWaveOf,
  requestOther,
  waveName,
  waveTitle,
  yearTagged,
  type OtherWave,
} from './midyear'
import {
  DivergingLegend,
  Failure,
  orderedAt,
  pickerTag,
  questionReason,
  type ViewProps,
} from './shared'
import styles from '../AtlasView.module.css'
import own from './Correlates.module.css'

/** How many of the first question's correlates the default table adds. */
const DEFAULT_RELATED = 4
/** The table's columns: wide enough for "+0.68*". */
const TABLE_COLUMN = 60

/** The questions in the order the table shows them: as added, or the
 * server's similar-together order when it is for these questions. */
export function displayOrder(
  vars: readonly string[],
  order: CorrelatesOrder,
  similar: readonly string[] | undefined,
): string[] {
  if (order !== 'similar' || !similar) return [...vars]
  const same = similar.length === vars.length && similar.every((name) => vars.includes(name))
  return same ? [...similar] : [...vars]
}

export function CompareSeveral({
  search,
  setSearch,
  variables,
  served,
  country,
  countryName,
  apiReachable,
  controls,
  onTable,
}: ViewProps) {
  const a = firstQuestion(search)
  const b = secondQuestion(search)
  // At Midyear another wave's question reads the same people's answers
  // from the other answers' wave (ADR-0020).
  const otherAnswers = otherWaveOf(search)
  // The default table needs the first question's ranked list.
  const seeded =
    search.vars === undefined && orderedAt(variables.byName[a], search.wave, otherAnswers)
  const ranked = useCorrelates(
    seeded && country !== undefined
      ? correlatesRequest(
          search,
          a,
          country,
          undefined,
          search.wave === 'MY' ? otherAnswers : undefined,
        )
      : null,
  )
  const rankedResponse = ranked.data
  const tableVars = useMemo(() => {
    if (search.vars) return search.vars
    if (!rankedResponse) return []
    const related = predictorOrder(rankedResponse.rows).filter((name) => name !== b)
    return [a, b, ...related.slice(0, DEFAULT_RELATED)]
  }, [search.vars, rankedResponse, a, b])
  const usableVars = useMemo(
    () => tableVars.filter((name) => orderedAt(variables.byName[name], search.wave, otherAnswers)),
    [tableVars, variables.byName, search.wave, otherAnswers],
  )
  // The wave row reads the default table's questions from here.
  const reported = search.vars === undefined ? usableVars.join(',') : ''
  useEffect(() => {
    if (onTable && reported) onTable(reported.split(','))
  }, [onTable, reported])
  const otherWave = requestOther(search, usableVars, variables.byName)
  const leftOut = tableVars.filter((name) => !usableVars.includes(name))
  const table = useCorrelationTable(
    country !== undefined && usableVars.length >= TABLE_MIN
      ? tableRequest(search, usableVars, country, otherWave)
      : null,
  )
  // A question by its short name — at Midyear, another wave's with its year.
  const nameOf = (name: string) => {
    const variable = variables.byName[name]
    return variable ? yearTagged(shortName(variable), variable, search.wave, otherWave) : name
  }
  const shown = displayOrder(usableVars, search.order, table.data?.similar_order)

  return (
    <>
      {tableVars.length > 0 && (
        <QuestionSet
          names={usableVars}
          nameOf={nameOf}
          variables={variables.list}
          wave={search.wave}
          unavailable={(variable) => questionReason(variable, search.wave)}
          countable={(variable) => questionReason(variable, search.wave) === undefined}
          tagOf={(variable) => pickerTag(variable, search)}
          onChange={(vars) => setSearch({ vars })}
          note={
            leftOut.length > 0 ? (
              <span className={styles.reason}>
                Left out, not asked in {waveTitle(search.wave, otherWave)}:{' '}
                {leftOut.map(nameOf).join(', ')}.
              </span>
            ) : undefined
          }
        />
      )}
      {controls}
      <div className={own.scopeRow}>
        <RadioRow<CorrelatesOrder>
          legend="Order"
          name="order"
          options={[
            { value: 'added', label: 'As added' },
            { value: 'similar', label: 'Similar together' },
          ]}
          value={search.order}
          onChange={(order) => setSearch({ order })}
        />
      </div>
      {seeded && ranked.isPending ? (
        <LoadingBlock height={420} label="Loading the table" />
      ) : seeded && ranked.isError ? (
        <Failure error={ranked.error} apiReachable={apiReachable} />
      ) : usableVars.length < TABLE_MIN ? (
        <EmptyState title="Pick two questions or more">
          <p>
            A table needs at least two questions asked in {waveTitle(search.wave, otherWave)} — add
            them with “Add questions”.
          </p>
        </EmptyState>
      ) : table.isPending ? (
        <LoadingBlock height={420} label="Loading the table" />
      ) : table.isError ? (
        <Failure error={table.error} apiReachable={apiReachable} />
      ) : table.data ? (
        <TableFigure
          table={table.data}
          order={shown}
          nameOf={nameOf}
          countryName={countryName}
          wave={search.wave}
          other={otherWave}
          method={search.method}
          isRefreshing={table.isPlaceholderData}
          served={served}
          onOpenPair={(row, column) =>
            setSearch({ view: 'pair', a: column, b: row, outcome: undefined, vars: usableVars })
          }
        />
      ) : null}
    </>
  )
}

/** Every pair among the table's questions as a lower triangle — rows the
 * questions from the second on, columns up to the last but one, both by
 * their short names — tinted on the diverging ramp over a fixed −1 to 1;
 * a pair built from the same answers reads a muted "·", one few people
 * are behind its value with an asterisk; selecting a cell opens Compare
 * two with that pair (the column first, the row second). */
function TableFigure({
  table,
  order,
  nameOf,
  countryName,
  wave,
  other,
  method,
  isRefreshing,
  served,
  onOpenPair,
}: {
  table: CorrelationsResponse
  /** The questions in the order shown. */
  order: readonly string[]
  nameOf: (name: string) => string
  countryName: string
  wave: Wave
  /** At Midyear with another wave's question: that wave (ADR-0020). */
  other: OtherWave | undefined
  method: CorrelationMethod | undefined
  isRefreshing: boolean
  served: Meta
  onOpenPair: (row: string, column: string) => void
}) {
  const pooled = table.meta.pooled === 'population'
  const pairs = new Map(table.pairs.map((pair) => [`${pair.a}|${pair.b}`, pair]))
  const pairOf = (one: string, other: string) =>
    pairs.get(`${one}|${other}`) ?? pairs.get(`${other}|${one}`)
  const counted = table.pairs.flatMap((pair) =>
    pair.correlation && !pair.below_min_n ? [pair.correlation] : [],
  )
  const name: ExportName = {
    measure: `Correlations among ${order.length} questions`,
    view: 'Compare several',
    waves: waveName(wave, other),
    ...(countryName ? { country: countryName } : {}),
  }
  // The data table: one row per pair with a correlation, named in words.
  const response: EstimateResponse = {
    meta: {
      data_version: table.meta.data_version,
      outcome: table.meta.vars.join(','),
      scale_type: 'correlation table',
      direction: 'none',
      stat: table.meta.stat,
      waves: [table.meta.wave],
      scope: 'global',
      oriented: false,
      weight_key: table.meta.weight_key,
      weight: table.meta.weight,
      se_method: 'none',
      ci_level: table.meta.ci_level,
      suppression: table.meta.suppression,
      n_frame: table.meta.n_frame,
      // (Not shown: each pair's own n is on its row.)
      n_valid: 0,
      by: ['question', 'with'],
      filters: table.meta.filters,
      min_n: table.meta.min_n,
    },
    rows: table.pairs.flatMap((pair) =>
      pair.correlation
        ? [{ ...pair.correlation, predictor: null, group: { question: pair.b, with: pair.a } }]
        : [],
    ),
  }
  const strongest = [...counted].sort(
    (left, right) => Math.abs(right.estimate ?? 0) - Math.abs(left.estimate ?? 0),
  )[0]
  const strongestPair = strongest
    ? table.pairs.find((pair) => pair.correlation === strongest)
    : undefined
  return (
    <ChartFigure
      title={`Correlations among ${order.length} questions`}
      subtitle={`${pooled ? pooledPlace(table.meta.countries, served.countries) : countryName} · ${waveTitle(wave, other)} · ${statisticPhrase(method)}`}
      ariaLabel={`Correlations among ${order.length} questions in ${pooled ? 'all countries combined' : countryName}, as a table: ${order
        .map(nameOf)
        .join('; ')}.${
        strongestPair && strongest
          ? ` Strongest: ${nameOf(strongestPair.a)} with ${nameOf(strongestPair.b)}, ${formatEstimate(strongest.estimate, strongest.stat)}.`
          : ''
      } Select a cell to see the two questions together; the data table below carries every number.`}
      marks="table"
      interactive
      response={response}
      meta={served}
      csv={{
        kind: 'client',
        onDownload: () =>
          downloadTextFile(exportFilename(name, 'csv'), correlationTableToCsv(table)),
      }}
      exportName={name}
      isRefreshing={isRefreshing}
      groupLabel={(column, value) =>
        column === 'question' || column === 'with' ? nameOf(String(value)) : undefined
      }
      columnName={(column) =>
        column === 'question' ? 'Question' : column === 'with' ? 'Correlated with' : undefined
      }
      note={CORRELATES_NOTE}
    >
      <HeatTable
        caption={
          <DivergingLegend
            extent={1}
            stat={table.meta.stat}
            ends={['−1', '+1']}
            hues={null}
            extra="· built from the same answers"
          />
        }
        corner="Question ↓ · with →"
        rows={order.slice(1).map((entry) => ({ key: entry, label: nameOf(entry) }))}
        columns={order.slice(0, -1).map((entry) => ({ key: entry, label: nameOf(entry) }))}
        columnWidth={TABLE_COLUMN}
        angled
        cellAt={(row, column) => {
          if (order.indexOf(column.key) >= order.indexOf(row.key))
            return { text: '', title: '', tint: 'transparent', blank: true }
          const pair = pairOf(row.key, column.key)
          if (!pair) return undefined
          const [rowName, columnName] = [nameOf(row.key), nameOf(column.key)]
          if (pair.shares_answers || !pair.correlation) {
            return {
              text: '·',
              title: `${rowName} with ${columnName}\nBuilt from the same answers: not correlated`,
              tint: 'transparent',
              muted: true,
              hidden: ', built from the same answers',
            }
          }
          const correlation = pair.correlation
          if (correlation.estimate === null) {
            return {
              text: '—',
              title: `${rowName} with ${columnName}\n${NO_ESTIMATE}`,
              tint: 'transparent',
              muted: true,
              hidden: ', no estimate',
            }
          }
          const value = formatEstimate(correlation.estimate, correlation.stat)
          const flagged = pair.below_min_n
          return {
            text: starred(value, flagged),
            title: withCoverage(
              `${starred(value, flagged)} · ${rowName} with ${columnName}`,
              coverageLine(correlation, served.countries.length),
            ),
            tint: divergingTint(correlation.estimate, 1),
            flagged,
            hidden: flagged ? FEW_PEOPLE_HIDDEN : undefined,
            onSelect: () => onOpenPair(row.key, column.key),
            name: `${rowName} with ${columnName}, ${value}${flagged ? FEW_PEOPLE_HIDDEN : ''}: see the two questions together`,
          }
        }}
      />
      <p className={styles.hint}>Select a cell to see the two questions together.</p>
    </ChartFigure>
  )
}
