// Compare several (ADR-0019): how strongly each pair among 2–10 questions
// goes together, as a lower-triangle table. The table starts from Compare
// two's pair and the first question's top four correlates (after the
// ranking's overlap dedupe), so it is never empty; a cell opens Compare
// two with the pair.

import { useId, useMemo } from 'react'
import { predictorOrder, useCorrelates } from '../../api/correlates'
import type { CorrelationMethod } from '../../api/correlates'
import { useCorrelationTable } from '../../api/correlations'
import type { CorrelationsResponse, EstimateResponse, Meta, Wave } from '../../api/types'
import { ChartFigure } from '../../charts/ChartFigure'
import { divergingTint } from '../../charts/theme'
import { HeatTable } from '../../charts/TransitionTable'
import { EmptyState } from '../../components/EmptyState'
import { LoadingBlock } from '../../components/Loading'
import { QuestionSearch } from '../../components/controls/QuestionSearch'
import { correlationTableToCsv, downloadTextFile } from '../../export/csv'
import { exportFilename, type ExportName } from '../../export/filename'
import { formatCount, formatEstimate } from '../../format'
import {
  TABLE_MAX,
  TABLE_MIN,
  correlatesRequest,
  firstQuestion,
  secondQuestion,
  tableRequest,
} from '../../state/search'
import { WAVE_CHIPS, WAVE_TITLES } from '../../waves'
import { statisticPhrase, tintExtent } from '../correlatesRows'
import { DivergingLegend, Failure, orderedAt, type ViewProps } from './shared'
import styles from '../AtlasView.module.css'

/** How many of the first question's correlates the default table adds. */
const DEFAULT_RELATED = 4

export function CompareSeveral({
  search,
  setSearch,
  variables,
  served,
  country,
  countryName,
  apiReachable,
  controls,
}: ViewProps) {
  const chipsLabel = useId()
  const a = firstQuestion(search)
  const b = secondQuestion(search)
  // The default table needs the first question's ranked list.
  const seeded = search.vars === undefined && orderedAt(variables.byName[a], search.wave)
  const ranked = useCorrelates(
    seeded && country !== undefined ? correlatesRequest(search, a, country) : null,
  )
  const rankedResponse = ranked.data
  const tableVars = useMemo(() => {
    if (search.vars) return search.vars
    if (!rankedResponse) return []
    const related = predictorOrder(rankedResponse.rows).filter((name) => name !== b)
    return [a, b, ...related.slice(0, DEFAULT_RELATED)]
  }, [search.vars, rankedResponse, a, b])
  const usableVars = useMemo(
    () => tableVars.filter((name) => orderedAt(variables.byName[name], search.wave)),
    [tableVars, variables.byName, search.wave],
  )
  const leftOut = tableVars.filter((name) => !usableVars.includes(name))
  const table = useCorrelationTable(
    country !== undefined && usableVars.length >= TABLE_MIN
      ? tableRequest(search, usableVars, country)
      : null,
  )
  const nameOf = (name: string) => variables.byName[name]?.display_name ?? name
  const candidates = variables.list.filter(
    (candidate) => orderedAt(candidate, search.wave) && !usableVars.includes(candidate.name),
  )

  return (
    <>
      {tableVars.length > 0 && (
        <div className={`${styles.controls} ${styles.controlsTop}`}>
          <div className={styles.field}>
            <span className={styles.fieldLabel} id={chipsLabel}>
              Questions in this table
            </span>
            <ol className={styles.chips} aria-labelledby={chipsLabel}>
              {usableVars.map((name, index) => (
                <li key={name} className={styles.chip}>
                  <span>
                    {index + 1} · {nameOf(name)}
                  </span>
                  <button
                    type="button"
                    className={styles.chipRemove}
                    aria-label={`Remove ${nameOf(name)}`}
                    disabled={usableVars.length <= TABLE_MIN}
                    onClick={() =>
                      setSearch({ vars: usableVars.filter((entry) => entry !== name) })
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ol>
            {leftOut.length > 0 && (
              <span className={styles.reason}>
                Left out, not asked in {WAVE_TITLES[search.wave] ?? search.wave}:{' '}
                {leftOut.map(nameOf).join(', ')}.
              </span>
            )}
          </div>
          <QuestionSearch
            label="Add a question"
            candidates={candidates}
            onAdd={(name) => setSearch({ vars: [...usableVars, name] })}
            full={usableVars.length >= TABLE_MAX ? `Up to ${TABLE_MAX} questions` : undefined}
          />
        </div>
      )}
      {controls}
      {seeded && ranked.isPending ? (
        <LoadingBlock height={420} label="Loading the table" />
      ) : seeded && ranked.isError ? (
        <Failure error={ranked.error} apiReachable={apiReachable} />
      ) : usableVars.length < TABLE_MIN ? (
        <EmptyState title="Pick two questions or more">
          <p>
            A table needs at least two questions asked in {WAVE_TITLES[search.wave] ?? search.wave}{' '}
            — add them under “Add a question”.
          </p>
        </EmptyState>
      ) : table.isPending ? (
        <LoadingBlock height={420} label="Loading the table" />
      ) : table.isError ? (
        <Failure error={table.error} apiReachable={apiReachable} />
      ) : table.data ? (
        <TableFigure
          table={table.data}
          vars={usableVars}
          nameOf={nameOf}
          countryName={countryName}
          wave={search.wave}
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

/** Every pair among the table's questions as a lower-triangle matrix —
 * rows "1 · name", columns numbered (their full names in the tooltip and
 * the accessible name) — tinted on the diverging ramp; a pair built from
 * the same answers reads a muted "·", one resting on too few people a
 * muted "—"; selecting a cell opens Compare two with that pair (the
 * column first, the row second). */
function TableFigure({
  table,
  vars,
  nameOf,
  countryName,
  wave,
  method,
  isRefreshing,
  served,
  onOpenPair,
}: {
  table: CorrelationsResponse
  vars: readonly string[]
  nameOf: (name: string) => string
  countryName: string
  wave: Wave
  method: CorrelationMethod | undefined
  isRefreshing: boolean
  served: Meta
  onOpenPair: (row: string, column: string) => void
}) {
  const pairs = new Map(table.pairs.map((pair) => [`${pair.a}|${pair.b}`, pair]))
  const counted = table.pairs.flatMap((pair) =>
    pair.correlation && !pair.below_min_n ? [pair.correlation] : [],
  )
  const extent = tintExtent(counted)
  const minN = table.meta.min_n
  const name: ExportName = {
    measure: `Correlations among ${vars.length} questions`,
    view: 'Compare several',
    waves: WAVE_CHIPS[wave] ?? wave,
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
      min_n: minN,
    },
    rows: table.pairs.flatMap((pair) =>
      pair.correlation
        ? [{ ...pair.correlation, predictor: null, group: { question: pair.b, with: pair.a } }]
        : [],
    ),
  }
  const strongest = [...counted].sort(
    (a, b) => Math.abs(b.estimate ?? 0) - Math.abs(a.estimate ?? 0),
  )[0]
  const strongestPair = strongest
    ? table.pairs.find((pair) => pair.correlation === strongest)
    : undefined
  return (
    <ChartFigure
      title={`Correlations among ${vars.length} questions`}
      subtitle={`${countryName} · ${WAVE_TITLES[wave] ?? wave} · ${statisticPhrase(method)}`}
      ariaLabel={`Correlations among ${vars.length} questions in ${countryName}, as a table: ${vars
        .map((entry, index) => `${index + 1}, ${nameOf(entry)}`)
        .join('; ')}.${
        strongestPair && strongest
          ? ` Strongest: ${nameOf(strongestPair.a)} and ${nameOf(strongestPair.b)}, ${formatEstimate(strongest.estimate, strongest.stat)}.`
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
    >
      <HeatTable
        caption={
          <DivergingLegend
            extent={extent}
            stat={table.meta.stat}
            hues="rust: as one goes up, the other goes down · teal: they go up together"
            extra="· built from the same answers"
          />
        }
        corner="Question ↓ · with →"
        rows={vars.map((entry, index) => ({
          key: entry,
          label: `${index + 1} · ${nameOf(entry)}`,
        }))}
        columns={vars.map((entry, index) => ({
          key: entry,
          label: String(index + 1),
          title: `${index + 1} · ${nameOf(entry)}`,
        }))}
        cellAt={(row, column) => {
          const i = vars.indexOf(row.key)
          const j = vars.indexOf(column.key)
          if (j >= i) return { text: '', title: '', tint: 'transparent', blank: true }
          const pair = pairs.get(`${column.key}|${row.key}`)
          if (!pair) return undefined
          const [y, x] = [nameOf(row.key), nameOf(column.key)]
          if (pair.shares_answers || !pair.correlation) {
            return {
              text: '·',
              title: `${y} · ${x}\nBuilt from the same answers: not correlated`,
              tint: 'transparent',
              muted: true,
              hidden: ', built from the same answers',
            }
          }
          const correlation = pair.correlation
          const value = formatEstimate(correlation.estimate, correlation.stat)
          const people = `${formatCount(correlation.n)} people answered both`
          const muted = pair.below_min_n
          return {
            text: muted ? '—' : value,
            title: muted
              ? `Too few respondents (fewer than ${formatCount(minN)})\n${value}  ${y} · ${x}\n${people}`
              : `${value}  ${y} · ${x}\n${people}`,
            tint: divergingTint(correlation.estimate, extent),
            muted,
            hidden: muted ? ', too few respondents' : undefined,
            onSelect: () => onOpenPair(row.key, column.key),
            name: `${y} and ${x}, ${muted ? 'too few respondents' : value}: see the two questions together`,
          }
        }}
      />
      <p className={styles.hint}>Select a cell to see the two questions together.</p>
    </ChartFigure>
  )
}
