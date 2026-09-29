// Compare two (ADR-0019): how answers to one question line up with
// answers to another, in one country. The view owns its two pickers, set
// in a sentence ("How do answers to [A ▾] relate to [B ▾]?") with a Swap;
// A is the columns, B the rows. Its chart is a column-percent heat grid
// (each column adds to 100%) under bars of who gave each of A's answers;
// a header row holds the pair's correlation strip and the scope toggle —
// In {country} · Country by country, where the grid gives way to the
// pair's correlation in each country. One chart at a time. Every number
// is the server's.

import { useMemo, type ReactNode } from 'react'
import { useCorrelates } from '../../api/correlates'
import { usePair } from '../../api/correlations'
import type {
  EstimateResponse,
  EstimateRow,
  Meta,
  PairResponse,
  VariableSummary,
  Wave,
} from '../../api/types'
import { useVariable } from '../../api/variables'
import { ChartFigure } from '../../charts/ChartFigure'
import { CorrelationStrip } from '../../charts/CorrelationStrip'
import {
  CrossTab,
  SHARE_BINS,
  type CrossTabCell,
  type CrossTabColumn,
  type CrossTabRow,
} from '../../charts/CrossTab'
import { RankedBar } from '../../charts/RankedBar'
import { SEQUENTIAL_RAMP, signMark } from '../../charts/theme'
import { EmptyState } from '../../components/EmptyState'
import { LoadingBlock } from '../../components/Loading'
import { QuestionPicker } from '../../components/controls/QuestionPicker'
import { RadioRow } from '../../components/controls/RadioRow'
import { downloadTextFile, pairToCsv, responseToCsv } from '../../export/csv'
import { exportFilename, type ExportName } from '../../export/filename'
import { ciText, formatEstimate } from '../../format'
import { groupValueLabel, shortName } from '../../labels'
import {
  correlatesAcrossCountries,
  correlatesRequest,
  firstQuestion,
  pairRequest,
  secondQuestion,
  type CorrelatesScope,
} from '../../state/search'
import { NARROW_VIEWPORT, useMediaQuery } from '../../useMediaQuery'
import { WAVE_TITLES } from '../../waves'
import {
  ALL_COUNTRIES,
  CORRELATES_NOTE,
  CORRELATION_SCALE,
  averagedOver,
  FEW_PEOPLE_KEY,
  fewPeople,
  pooledPlace,
  scopeLabel,
  pairAxisTitle,
  pairBarTip,
  pairCellTip,
  rankedTip,
  statisticPhrase,
} from '../correlatesRows'
import {
  otherWaveOf,
  requestOther,
  waveName,
  waveTitle,
  yearTagged,
  type OtherWave,
} from './midyear'
import {
  Failure,
  orderedAt,
  pairReason,
  pickerTag,
  questionReason,
  triggerTag,
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
  // At Midyear another wave's question reads the same people's answers
  // from the other answers' wave (ADR-0020).
  const otherAnswers = otherWaveOf(search)
  const otherWave = requestOther(search, [aName, bName], variables.byName)
  const ready =
    orderedAt(a, search.wave, otherAnswers) &&
    orderedAt(b, search.wave, otherAnswers) &&
    aName !== bName &&
    !sameAnswers &&
    !waiting
  const everywhere = search.scope === 'all'
  // One chart at a time: the grid in one country, or the pair's
  // correlation in every country.
  const pair = usePair(
    ready && country !== undefined
      ? pairRequest(search, { a: aName, b: bName }, country, otherWave)
      : null,
    { enabled: !everywhere },
  )
  const across = useCorrelates(
    ready ? correlatesAcrossCountries(search, aName, [bName], otherWave) : null,
    {
      enabled: everywhere,
    },
  )
  // Country by country, whatever country is chosen: the All countries
  // average, as the chart's labelled rule (and, All countries chosen, as
  // the strip).
  const pooledPair = useCorrelates(
    ready ? correlatesRequest(search, aName, 'all', [bName], otherWave) : null,
    { enabled: everywhere },
  )
  const aDetail = useVariable(ready ? aName : null).data?.detail
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

  const scopeToggle = (
    <RadioRow<CorrelatesScope>
      legend="Where"
      legendHidden
      name="pair-scope"
      options={[
        { value: 'country', label: scopeLabel(countryName) },
        { value: 'all', label: 'Country by country' },
      ]}
      value={search.scope}
      onChange={(scope) => setSearch({ scope })}
    />
  )
  const acrossResponse = across.data
  const chosenRow =
    country === 'all'
      ? pooledPair.data?.rows[0]
      : acrossResponse?.rows.find((row) => row.group['country_code'] === country)

  return (
    <>
      <div className={own.sentenceRow}>
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
            countable={(variable) => questionReason(variable, search.wave) === undefined}
            tagOf={(variable) => pickerTag(variable, search)}
            triggerTag={triggerTag(a, search)}
            onPick={(name) => setSearch({ a: name })}
          />{' '}
          relate to{' '}
          <span className={own.sentenceEnd}>
            <QuestionPicker
              label="Second question"
              variables={variables.list}
              wave={search.wave}
              value={bName}
              unavailable={(variable) =>
                pairReason(variable, a, 'first question', search.wave, shares)
              }
              countable={(variable) => questionReason(variable, search.wave) === undefined}
              tagOf={(variable) => pickerTag(variable, search)}
              triggerTag={triggerTag(b, search)}
              onPick={(name) => setSearch({ b: name })}
            />
            ?
          </span>
        </p>
        <button
          type="button"
          className={own.swap}
          onClick={() => setSearch({ a: bName, b: aName })}
        >
          <span aria-hidden="true">⇄ </span>Swap
        </button>
      </div>
      {controls}
      {problem || !a || !b ? (
        <EmptyState title="Pick two questions to compare">
          <p>{problem ?? 'Choose two questions'} — choose another question above.</p>
        </EmptyState>
      ) : everywhere ? (
        waiting || across.isPending ? (
          <LoadingBlock height={520} label="Loading the pair country by country" />
        ) : across.isError ? (
          <Failure error={across.error} apiReachable={apiReachable} />
        ) : acrossResponse ? (
          <EveryCountry
            a={a}
            b={b}
            response={acrossResponse}
            average={pooledPair.data?.rows[0]}
            chosen={country === 'all' ? undefined : country}
            countryName={countryName}
            wave={search.wave}
            other={otherWave}
            method={search.method}
            isRefreshing={across.isPlaceholderData}
            served={served}
            header={
              <HeaderRow
                strip={
                  chosenRow ? (
                    <CorrelationStrip
                      row={chosenRow}
                      scope={countryName}
                      flagged={fewPeople(chosenRow, acrossResponse.meta.min_n)}
                    />
                  ) : null
                }
                toggle={scopeToggle}
              />
            }
          />
        ) : null
      ) : waiting || pair.isPending ? (
        <LoadingBlock height={420} label="Loading the two questions" />
      ) : pair.isError ? (
        <Failure error={pair.error} apiReachable={apiReachable} />
      ) : pair.data ? (
        <PairFigure
          pair={pair.data}
          a={a}
          b={b}
          aTitle={pairAxisTitle(a, aDetail, yearTagged(shortName(a), a, search.wave, otherWave))}
          bTitle={pairAxisTitle(b, bDetail, yearTagged(shortName(b), b, search.wave, otherWave))}
          countryName={countryName}
          wave={search.wave}
          other={otherWave}
          isRefreshing={pair.isPlaceholderData}
          served={served}
          header={
            <HeaderRow
              strip={
                <CorrelationStrip
                  row={pair.data.correlation}
                  scope={countryName}
                  flagged={fewPeople(pair.data.correlation, pair.data.min_n)}
                />
              }
              toggle={scopeToggle}
            />
          }
        />
      ) : null}
    </>
  )
}

/** The pair's header: the correlation on the left, where on the right. */
function HeaderRow({ strip, toggle }: { strip: ReactNode; toggle: ReactNode }) {
  return (
    <div className={own.headerRow}>
      {strip}
      {toggle}
    </div>
  )
}

/** The key to the grid: how to read it, its fixed bins in the ramp's own
 * tokens, and the asterisk. */
function ShareLegend() {
  return (
    <p className={`${styles.legend} ${own.shareLegend}`}>
      <span className={own.shareKey}>
        <span>Share of each column (columns add to 100%)</span>
        <span className={own.bins} aria-hidden="true">
          {SEQUENTIAL_RAMP.map((token, index) => (
            <span key={token} className={own.bin}>
              <span className={own.swatch} style={{ background: token }} />
              <span>
                {SHARE_BINS[index]}
                {index === SHARE_BINS.length - 1 ? '%+' : ''}
              </span>
            </span>
          ))}
        </span>
        <span className="visually-hidden">
          : deeper shades are larger shares, in steps at {SHARE_BINS.join(', ')} percent and above.
        </span>
      </span>
      <span>{FEW_PEOPLE_KEY}</span>
    </p>
  )
}

/** The heat grid for one country, with its bars, legend and table. */
function PairFigure({
  pair,
  a,
  b,
  aTitle,
  bTitle,
  countryName,
  wave,
  other,
  isRefreshing,
  served,
  header,
}: {
  pair: PairResponse
  a: VariableSummary
  b: VariableSummary
  aTitle: string
  bTitle: string
  countryName: string
  wave: Wave
  /** At Midyear with another wave's question: that wave (ADR-0020). */
  other: OtherWave | undefined
  isRefreshing: boolean
  served: Meta
  header: ReactNode
}) {
  const aShort = yearTagged(shortName(a), a, wave, other)
  const bShort = yearTagged(shortName(b), b, wave, other)
  const columnLabel = useMemo(
    () => new Map(pair.columns.map((column) => [column.code, column.label])),
    [pair],
  )
  const rowLabel = useMemo(() => new Map(pair.rows.map((row) => [row.code, row.label])), [pair])
  const columns: CrossTabColumn[] = useMemo(
    () =>
      pair.columns.map((column) => ({
        key: String(column.code),
        label: column.label,
        share: column.share,
        flagged: column.flagged,
        tip: pairBarTip({
          level: column.label,
          short: aShort,
          share: column.share,
          interval:
            column.ci_lo !== null && column.ci_hi !== null
              ? ciText({
                  ci_lo: column.ci_lo,
                  ci_hi: column.ci_hi,
                  ci_level: pair.shares.meta.ci_level,
                  stat: 'proportion',
                })
              : undefined,
          flagged: column.flagged,
        }),
      })),
    [pair, aShort],
  )
  // The most of what B names at the top.
  const rows: CrossTabRow[] = useMemo(
    () => [...pair.rows].reverse().map((row) => ({ key: String(row.code), label: row.label })),
    [pair],
  )
  const cells: CrossTabCell[] = useMemo(
    () =>
      pair.cells.map((cell, index) => {
        const record = pair.shares.rows[index]
        return {
          column: String(cell.x),
          row: String(cell.y),
          share: cell.share,
          flagged: cell.flagged,
          tip: pairCellTip({
            aLevel: columnLabel.get(cell.x) ?? String(cell.x),
            aShort,
            bLevel: rowLabel.get(cell.y) ?? String(cell.y),
            bShort,
            share: cell.share,
            interval:
              record && record.ci_lo !== null && record.ci_hi !== null ? ciText(record) : undefined,
            flagged: cell.flagged,
          }),
        }
      }),
    [pair, aShort, bShort, columnLabel, rowLabel],
  )
  const name: ExportName = {
    measure: `${a.display_name} and ${b.display_name}`,
    view: 'Compare two',
    waves: waveName(wave, other),
    ...(countryName ? { country: countryName } : {}),
  }
  const flaggedCount = pair.cells.filter((cell) => cell.flagged).length
  const pooled = pair.shares.meta.pooled === 'average'
  const place = pooled ? pooledPlace(pair.shares.meta.countries, served.countries) : countryName
  const ariaLabel = `${a.display_name} and ${b.display_name}${pooled ? `, ${averagedOver(pair.shares.meta.countries, served.countries)}` : ` in ${countryName}`}: for each of ${pair.columns.length} answers to ${a.display_name}, the share who gave each of ${pair.rows.length} answers to ${b.display_name}, each column adding to 100%; bars above show how many gave each answer to ${a.display_name}. Correlation ${formatEstimate(pair.correlation.estimate, pair.correlation.stat)}. The data table below carries every number.${
    flaggedCount === 1
      ? ' 1 cell is starred: small sample size.'
      : flaggedCount > 1
        ? ` ${flaggedCount} cells are starred: small sample size.`
        : ''
  }`
  // The data table names both questions' answers (a binned axis already
  // carries its bin's label).
  const label = (column: string, value: string | number) => {
    const code = typeof value === 'number' ? value : Number.NaN
    if (column === pair.x) return columnLabel.get(code) ?? String(value)
    if (column === pair.y) return rowLabel.get(code) ?? String(value)
    return undefined
  }
  return (
    <ChartFigure
      title={`${a.display_name} and ${b.display_name}`}
      subtitle={`${place} · ${waveTitle(wave, other)}`}
      ariaLabel={ariaLabel}
      marks="table"
      intro={
        <>
          {header}
          <ShareLegend />
        </>
      }
      response={pair.shares}
      meta={served}
      csv={{
        kind: 'client',
        onDownload: () => downloadTextFile(exportFilename(name, 'csv'), pairToCsv(pair)),
      }}
      exportName={name}
      isRefreshing={isRefreshing}
      groupLabel={label}
      columnName={(column) =>
        column === pair.x
          ? yearTagged(a.display_name, a, wave, other)
          : column === pair.y
            ? yearTagged(b.display_name, b, wave, other)
            : undefined
      }
      note={CORRELATES_NOTE}
    >
      <CrossTab
        columns={columns}
        rows={rows}
        cells={cells}
        xTitle={aTitle}
        yTitle={bTitle}
        barCaption={`Share of respondents who gave each answer to ${aShort}`}
      />
    </ChartFigure>
  )
}

/** The pair's correlation in every country that asked both: one dot per
 * country on a fixed −1 to 1 axis, strongest first, the chosen country
 * picked out, and the All countries average as a labelled rule. */
function EveryCountry({
  a,
  b,
  response,
  average,
  chosen,
  countryName,
  wave,
  other,
  method,
  isRefreshing,
  served,
  header,
}: {
  a: VariableSummary
  b: VariableSummary
  response: EstimateResponse
  /** The All countries average (drawn whatever country is chosen). */
  average: EstimateRow | undefined
  chosen: number | undefined
  countryName: string
  wave: Wave
  other: OtherWave | undefined
  method: 'spearman' | undefined
  isRefreshing: boolean
  served: Meta
  header: ReactNode
}) {
  const narrow = useMediaQuery(NARROW_VIEWPORT)
  const minN = response.meta.min_n
  const labelOf = (row: EstimateRow) =>
    groupValueLabel('country_code', row.group['country_code'] ?? null, served)
  const sorted = useMemo(() => {
    const nameOf = (row: EstimateRow) =>
      groupValueLabel('country_code', row.group['country_code'] ?? null, served)
    return {
      ...response,
      // A country with nobody behind the pair wasn't asked: no row.
      rows: response.rows
        .filter((row) => row.n > 0)
        .sort(
          (left, right) =>
            (right.estimate ?? -Infinity) - (left.estimate ?? -Infinity) ||
            nameOf(left).localeCompare(nameOf(right)),
        ),
    }
  }, [response, served])
  const name: ExportName = {
    measure: `${a.display_name} and ${b.display_name}`,
    view: 'Compare two country by country',
    waves: waveName(wave, other),
  }
  const aShort = yearTagged(shortName(a), a, wave, other)
  const bShort = yearTagged(shortName(b), b, wave, other)
  const top = sorted.rows[0]
  const bottom = sorted.rows[sorted.rows.length - 1]
  const averageText =
    average && average.estimate !== null
      ? `${formatEstimate(average.estimate, average.stat)}${fewPeople(average, minN) ? '*' : ''}`
      : undefined
  const ariaLabel = `${a.display_name} and ${b.display_name}: their correlation in each of ${sorted.rows.length} countries, strongest first, on a fixed scale from −1 to 1${chosen !== undefined ? `; ${countryName} is picked out` : ''}.${
    top && bottom
      ? ` From ${labelOf(top)} (${formatEstimate(top.estimate, top.stat)}) to ${labelOf(bottom)} (${formatEstimate(bottom.estimate, bottom.stat)}).`
      : ''
  }${averageText ? ` A dashed line marks the All countries average, ${averageText}.` : ''} The data table below carries every number.`
  return (
    <ChartFigure
      title={`${a.display_name} and ${b.display_name}`}
      subtitle={`Country by country · ${waveTitle(wave, other)} · ${statisticPhrase(method)}`}
      ariaLabel={ariaLabel}
      marks="dots"
      intro={header}
      response={sorted}
      meta={served}
      csv={{
        kind: 'client',
        onDownload: () => downloadTextFile(exportFilename(name, 'csv'), responseToCsv(sorted)),
      }}
      exportName={name}
      isRefreshing={isRefreshing}
      predictorLabel={(predictor) =>
        predictor === b.name ? yearTagged(b.display_name, b, wave, other) : undefined
      }
      note={CORRELATES_NOTE}
    >
      <RankedBar
        rows={sorted.rows}
        meta={served}
        responseMeta={response.meta}
        variable={a}
        color={signMark(1)}
        colorOf={(row) => signMark(row.estimate)}
        highlightOf={(row) => row.group['country_code'] === chosen}
        {...(average && average.estimate !== null && averageText
          ? {
              reference: {
                value: average.estimate,
                label: `${ALL_COUNTRIES} ${averageText}`,
                atTop: true,
              },
            }
          : {})}
        zeroRule
        labelFontSize={narrow ? 12 : 13.5}
        fixedScale={CORRELATION_SCALE}
        axisEnds={[
          `← higher ${aShort} goes with lower ${bShort}`,
          `higher ${aShort} goes with higher ${bShort} →`,
        ]}
        stackOnNarrow
        tipOf={(row, label) => rankedTip(row, label, fewPeople(row, minN))}
        flagOf={(row) => fewPeople(row, minN)}
      />
    </ChartFigure>
  )
}
