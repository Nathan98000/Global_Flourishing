// Compare two (ADR-0019): how answers to one question line up with
// answers to another, in one country. The view owns its two pickers, set
// in a sentence ("How do answers to [A ▾] relate to [B ▾]?") with a Swap;
// A is the columns, B the rows. Every number is the server's.

import { useMemo } from 'react'
import type { CorrelationMethod } from '../../api/correlates'
import { usePair } from '../../api/correlations'
import type {
  EstimateResponse,
  Meta,
  PairResponse,
  VariableDetail,
  VariableSummary,
  Wave,
} from '../../api/types'
import { useVariable } from '../../api/variables'
import { BinnedScatter, type BinnedPoint } from '../../charts/BinnedScatter'
import { ChartFigure } from '../../charts/ChartFigure'
import { measureBounds } from '../../charts/domain'
import { EmptyState } from '../../components/EmptyState'
import { LoadingBlock } from '../../components/Loading'
import { QuestionPicker } from '../../components/controls/QuestionPicker'
import { downloadTextFile, responseToCsv } from '../../export/csv'
import { exportFilename, type ExportName } from '../../export/filename'
import { formatEstimate } from '../../format'
import { outcomeLevels, shortName } from '../../labels'
import { firstQuestion, pairRequest, secondQuestion } from '../../state/search'
import { WAVE_CHIPS, WAVE_TITLES } from '../../waves'
import { hollowNote, pairSubtitle, pairTip } from '../correlatesRows'
import {
  Failure,
  orderedAt,
  pairReason,
  questionReason,
  useSharesAnswers,
  type ViewProps,
} from './shared'
import styles from '../AtlasView.module.css'
import own from './Correlates.module.css'

export function ComparePair({
  search,
  setSearch,
  variables,
  served,
  country,
  countryName,
  apiReachable,
  controls,
}: ViewProps) {
  const aName = firstQuestion(search)
  const bName = secondQuestion(search)
  const a = variables.byName[aName]
  const b = variables.byName[bName]
  const { shares, settled } = useSharesAnswers(variables.list)
  const sameAnswers = aName !== bName && shares(aName, bName)
  // A score's components decide whether the pair can be asked for at all.
  const waiting = !settled && (a?.is_derived === true || b?.is_derived === true)
  const ready =
    orderedAt(a, search.wave) &&
    orderedAt(b, search.wave) &&
    aName !== bName &&
    !sameAnswers &&
    !waiting
  const pair = usePair(
    ready && country !== undefined ? pairRequest(search, { a: aName, b: bName }, country) : null,
  )
  const bDetail = useVariable(ready ? bName : null).data?.detail

  // Why the pair can't be shown, when it can't: the first problem found.
  const problem = (() => {
    for (const [name, variable] of [
      [aName, a],
      [bName, b],
    ] as const) {
      if (variable === undefined || !variable.servable)
        return `The link asked for “${name}”, which isn't a question this release can chart`
      const reason = questionReason(variable, search.wave)
      if (reason === 'Answers have no order')
        return `“${variable.display_name}” is a set of categories with no order, so it has no correlation`
      if (reason)
        return `“${variable.display_name}” wasn't asked in ${WAVE_TITLES[search.wave] ?? search.wave}`
    }
    if (aName === bName) return 'The two questions are the same one'
    if (sameAnswers && a && b)
      return `${a.display_name} and ${b.display_name} are built from the same answers, so they go together by construction`
    return undefined
  })()

  return (
    <>
      <p className={own.sentence}>
        How do answers to{' '}
        <QuestionPicker
          label="First question"
          variables={variables.list}
          wave={search.wave}
          value={aName}
          unavailable={(variable) =>
            pairReason(variable, b, 'second question', search.wave, shares)
          }
          onPick={(name) => setSearch({ a: name })}
        />{' '}
        relate to{' '}
        <QuestionPicker
          label="Second question"
          variables={variables.list}
          wave={search.wave}
          value={bName}
          unavailable={(variable) => pairReason(variable, a, 'first question', search.wave, shares)}
          onPick={(name) => setSearch({ b: name })}
        />
        ?{' '}
        <button
          type="button"
          className={styles.swap}
          onClick={() => setSearch({ a: bName, b: aName })}
        >
          <span aria-hidden="true">⇄ </span>Swap
        </button>
      </p>
      {controls}
      {problem ? (
        <EmptyState title="Pick two questions to compare">
          <p>{problem} — choose another question above.</p>
        </EmptyState>
      ) : waiting || pair.isPending ? (
        <LoadingBlock height={420} label="Loading the two questions" />
      ) : pair.isError ? (
        <Failure error={pair.error} apiReachable={apiReachable} />
      ) : pair.data && a && b ? (
        <PairFigure
          pair={pair.data}
          y={b}
          x={a}
          yDetail={bDetail}
          countryName={countryName}
          wave={search.wave}
          method={search.method}
          isRefreshing={pair.isPlaceholderData}
          served={served}
        />
      ) : null}
    </>
  )
}

/** The second question's average (or share answering yes) for each
 * answer to the first — or each range of a long one — as a binned
 * scatter, with its data table and downloads. */
function PairFigure({
  pair,
  y,
  x,
  yDetail,
  countryName,
  wave,
  method,
  isRefreshing,
  served,
}: {
  pair: PairResponse
  y: VariableSummary
  x: VariableSummary
  yDetail: VariableDetail | undefined
  countryName: string
  wave: Wave
  method: CorrelationMethod | undefined
  isRefreshing: boolean
  served: Meta
}) {
  const binary = pair.means.meta.stat === 'proportion'
  const binned = pair.grouping === 'bins'
  const yShort = shortName(y)
  const points: BinnedPoint[] = useMemo(
    () =>
      pair.groups.flatMap((group, index) => {
        const row = pair.means.rows[index]
        return row
          ? [
              {
                key: String(index),
                label: group.label,
                row,
                share: group.share,
                hollow: group.below_min_n,
              },
            ]
          : []
      }),
    [pair],
  )
  // Up is always more of what the measure names: a descending item's
  // axis runs from its highest code up to its lowest (its means stay as
  // coded), and the label above the axis says, in the item's own words,
  // what the top is.
  const reverse = y.polarity === 'descending' && !binary
  // A derived score's "value labels" are its histogram bins, not words.
  const levels = y.is_derived ? [] : outcomeLevels(yDetail)
  const topLabel = (reverse ? levels[0] : levels[levels.length - 1])?.label.trim()
  const yLabel = binary ? '↑ % answering yes' : topLabel ? `↑ ${topLabel}` : `↑ higher ${yShort}`
  const bounds = measureBounds(pair.means.meta.stat, y) ?? [0, 10]
  const tipOf = useMemo(
    () => (point: BinnedPoint) => pairTip(point, { yShort, binary, binned }),
    [yShort, binary, binned],
  )
  const minN = pair.means.meta.min_n ?? 0
  const hollow = hollowNote(
    points.filter((point) => point.hollow).map((point) => point.label),
    minN,
    binned,
  )
  const labelByCode = new Map(pair.groups.map((group) => [String(group.code), group.label]))
  const name: ExportName = {
    measure: y.display_name,
    view: `Compared with ${x.display_name}`,
    waves: WAVE_CHIPS[wave] ?? wave,
    ...(countryName ? { country: countryName } : {}),
  }
  const first = points.find((point) => point.row.estimate !== null)
  const last = [...points].reverse().find((point) => point.row.estimate !== null)
  const valueOf = (point: BinnedPoint) => formatEstimate(point.row.estimate, point.row.stat)
  const ariaLabel = `${y.display_name} by ${x.display_name} in ${countryName}: ${
    binary ? 'the share answering yes' : `the average ${y.display_name}`
  } for each of ${points.length} ${binned ? 'ranges' : 'answers'} of ${x.display_name}${
    first && last
      ? `, from ${first.label} (${valueOf(first)}) to ${last.label} (${valueOf(last)})`
      : ''
  }; correlation ${formatEstimate(pair.correlation.estimate, pair.correlation.stat)}. The data table below carries every number.`
  const response: EstimateResponse = pair.means
  return (
    <ChartFigure
      title={`${y.display_name} by ${x.display_name}`}
      subtitle={pairSubtitle({
        countryName,
        wave,
        y: y.display_name,
        x: x.display_name,
        binary,
        binned,
        correlation: pair.correlation,
        method,
      })}
      ariaLabel={ariaLabel}
      marks="dots"
      intro={
        <p className={styles.sizeKey}>
          <span className={styles.sizeDots} aria-hidden="true">
            <span />
            <span />
          </span>
          {binned
            ? 'Larger dot = more people in that range'
            : 'Larger dot = more people gave that answer'}
        </p>
      }
      response={response}
      meta={served}
      csv={{
        kind: 'client',
        onDownload: () => downloadTextFile(exportFilename(name, 'csv'), responseToCsv(response)),
      }}
      exportName={name}
      isRefreshing={isRefreshing}
      groupLabel={(column, value) =>
        column === x.name ? labelByCode.get(String(value)) : undefined
      }
      columnName={(column) => (column === x.name ? x.display_name : undefined)}
      footnote={
        <>
          Each dot is an average of people&rsquo;s answers, not individual people.{' '}
          {hollow ? `${hollow} ` : ''}
        </>
      }
    >
      <BinnedScatter
        points={points}
        yDomain={bounds[0] === bounds[1] ? [bounds[0], bounds[0] + 1] : bounds}
        reverse={reverse}
        yLabel={yLabel}
        tipOf={tipOf}
      />
    </ChartFigure>
  )
}
