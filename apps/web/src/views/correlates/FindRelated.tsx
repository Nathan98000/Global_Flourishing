// Find related (ADR-0019): the questions whose answers rise or fall most
// closely with one question — ranked in the chosen country, or, in every
// country, the same questions as a matrix with the chosen country pinned
// first. The server sweeps every other ordered question, ranks by
// strength and cuts the list; correlations are point estimates, drawn
// without an interval. A row opens Compare two with the pair.

import { useMemo } from 'react'
import { predictorOrder, useCorrelates } from '../../api/correlates'
import type { Country, EstimateResponse, EstimateRow } from '../../api/types'
import { useVariable } from '../../api/variables'
import { ChartFigure } from '../../charts/ChartFigure'
import { RankedBar } from '../../charts/RankedBar'
import { divergingTint, signMark } from '../../charts/theme'
import { HeatTable, intervalText } from '../../charts/TransitionTable'
import { EmptyState } from '../../components/EmptyState'
import { LoadingBlock } from '../../components/Loading'
import { WordingPanel } from '../../components/WordingPanel'
import { QuestionPicker } from '../../components/controls/QuestionPicker'
import { RadioRow } from '../../components/controls/RadioRow'
import { downloadTextFile, responseToCsv } from '../../export/csv'
import { exportFilename, type ExportName } from '../../export/filename'
import { formatEstimate } from '../../format'
import { shortName } from '../../labels'
import {
  correlatesAcrossCountries,
  correlatesRequest,
  relatedQuestion,
  type CorrelatesScope,
} from '../../state/search'
import { NARROW_VIEWPORT, useMediaQuery } from '../../useMediaQuery'
import { WAVE_CHIPS, WAVE_TITLES } from '../../waves'
import {
  CORRELATION_SCALE,
  FEW_PEOPLE,
  FEW_PEOPLE_HIDDEN,
  acrossSubtitle,
  axisEnds,
  belowFloor,
  excludedNote,
  heatCells,
  heatKey,
  overlapNote,
  pinnedFirst,
  rankedSubtitle,
  rankedTip,
  starred,
  statisticPhrase,
  tintExtent,
} from '../correlatesRows'
import { DivergingLegend, Failure, orderedAt, questionReason, type ViewProps } from './shared'
import styles from '../AtlasView.module.css'
import own from './Correlates.module.css'

export function FindRelated({
  search,
  setSearch,
  variables,
  served,
  country,
  countryName,
  apiReachable,
  controls,
}: ViewProps) {
  const name = relatedQuestion(search)
  const variable = variables.byName[name]
  const ready = orderedAt(variable, search.wave)
  const narrow = useMediaQuery(NARROW_VIEWPORT)
  const detail = useVariable(ready ? name : null).data?.detail
  const ranked = useCorrelates(
    ready && country !== undefined ? correlatesRequest(search, name, country) : null,
  )
  const rankedResponse = ranked.data
  const predictors = useMemo(
    () => (rankedResponse ? predictorOrder(rankedResponse.rows) : []),
    [rankedResponse],
  )
  const across = useCorrelates(
    ready && predictors.length > 0 ? correlatesAcrossCountries(search, name, predictors) : null,
    { enabled: search.scope === 'all' },
  )
  const acrossResponse = across.data
  const acrossRows = useMemo(() => acrossResponse?.rows ?? [], [acrossResponse])
  const cells = useMemo(() => heatCells(acrossRows), [acrossRows])

  const nameOf = (entry: string) => variables.byName[entry]?.display_name ?? entry
  const title = variable?.display_name ?? name
  const short = variable ? shortName(variable) : title
  const rankedRows = rankedResponse?.rows ?? []
  const waves = WAVE_CHIPS[search.wave] ?? search.wave
  const rankedName: ExportName = {
    measure: title,
    view: 'Correlates',
    waves,
    ...(countryName ? { country: countryName } : {}),
  }
  const acrossName: ExportName = { measure: title, view: 'Correlates across countries', waves }
  const csvFor = (response: EstimateResponse, exportName: ExportName) => ({
    kind: 'client' as const,
    onDownload: () => downloadTextFile(exportFilename(exportName, 'csv'), responseToCsv(response)),
  })
  // Each row opens Compare two: this question on the columns, the row's
  // on the rows.
  const openPair = (row: EstimateRow) => {
    if (row.predictor) setSearch({ view: 'pair', a: name, b: row.predictor, outcome: undefined })
  }
  const labelOfRow = (row: EstimateRow) => nameOf(row.predictor ?? '')
  const colorOfRow = (row: EstimateRow) => signMark(row.estimate)
  const rowName = (row: EstimateRow, label: string) =>
    `${label}, ${formatEstimate(row.estimate, row.stat)}: see it beside ${title}`
  const overlap = overlapNote(rankedResponse?.meta.dropped_overlap, variables.byName)
  const strongest = rankedRows.find((row) => row.estimate !== null)
  const rankedAria = `${title}: the ${predictors.length} questions most strongly associated with it in ${countryName}, ${WAVE_TITLES[search.wave] ?? search.wave}, ${statisticPhrase(search.method)}.${
    strongest?.predictor
      ? ` Strongest: ${nameOf(strongest.predictor)} ${formatEstimate(strongest.estimate, strongest.stat)}.`
      : ''
  } The data table below carries every number.`
  const excluded = rankedResponse ? excludedNote(rankedResponse.meta) : undefined

  const problem =
    variable === undefined || !variable.servable
      ? `The link asked for “${name}”, which isn't a question this release can chart`
      : questionReason(variable, search.wave) === 'Answers have no order'
        ? `“${title}” is a set of categories with no order, so it has no correlation`
        : !ready
          ? `“${title}” wasn't asked in ${WAVE_TITLES[search.wave] ?? search.wave}`
          : undefined

  return (
    <>
      <p className={own.sentence}>
        What goes with{' '}
        <QuestionPicker
          label="Question"
          variables={variables.list}
          wave={search.wave}
          value={name}
          unavailable={(candidate) => questionReason(candidate, search.wave)}
          onPick={(picked) =>
            // The question seeds Compare two's first; a second question
            // that is now the same one gives way to the default.
            setSearch({
              outcome: picked,
              a: undefined,
              b: search.b === picked ? undefined : search.b,
            })
          }
        />
        ?
      </p>
      {controls}
      <div className={own.scopeRow}>
        <RadioRow<CorrelatesScope>
          legend="Where"
          legendHidden
          name="scope"
          options={[
            { value: 'country', label: countryName ? `In ${countryName}` : 'In one country' },
            { value: 'all', label: 'In every country' },
          ]}
          value={search.scope}
          onChange={(scope) => setSearch({ scope })}
        />
      </div>
      {problem ? (
        <EmptyState title="Pick a question to begin">
          <p>{problem} — choose another question above.</p>
        </EmptyState>
      ) : ranked.isPending ? (
        <LoadingBlock height={520} label="Loading the ranked list" />
      ) : ranked.isError ? (
        <Failure error={ranked.error} apiReachable={apiReachable} />
      ) : rankedResponse && variable ? (
        search.scope === 'country' ? (
          <>
            <p role="status" className="visually-hidden">
              Updated: {title}, {predictors.length} questions ranked for {countryName}.
            </p>
            <ChartFigure
              title={`What goes with ${title}`}
              subtitle={rankedSubtitle(countryName, search.method, search.wave)}
              ariaLabel={rankedAria}
              marks="dots"
              interactive
              intro={
                <>
                  {detail && (
                    <div className={styles.wording}>
                      <WordingPanel detail={detail} />
                    </div>
                  )}
                  {/* The two hues, said before the rows that wear them. */}
                  <p className={styles.signKey}>
                    <span>
                      <span
                        className={styles.keyDot}
                        style={{ background: signMark(1) }}
                        aria-hidden="true"
                      />
                      Goes with higher {short}
                    </span>
                    <span>
                      <span
                        className={styles.keyDot}
                        style={{ background: signMark(-1) }}
                        aria-hidden="true"
                      />
                      Goes with lower {short}
                    </span>
                  </p>
                </>
              }
              response={rankedResponse}
              meta={served}
              csv={csvFor(rankedResponse, rankedName)}
              exportName={rankedName}
              isRefreshing={ranked.isPlaceholderData}
              predictorLabel={nameOf}
              footnote={
                <>
                  {excluded ? `${excluded} ` : ''}
                  {overlap ? `${overlap} ` : ''}
                </>
              }
            >
              <RankedBar
                rows={rankedRows}
                meta={served}
                responseMeta={rankedResponse.meta}
                variable={variable}
                color={signMark(1)}
                labelOf={labelOfRow}
                colorOf={colorOfRow}
                zeroRule
                labelFontSize={narrow ? 12 : 13.5}
                fixedScale={CORRELATION_SCALE}
                axisEnds={axisEnds(short)}
                fitLabels
                stackOnNarrow
                tipOf={(row, label) =>
                  rankedTip(row, label, belowFloor(row, rankedResponse.meta.min_n))
                }
                flagOf={(row) => belowFloor(row, rankedResponse.meta.min_n)}
                onSelectRow={openPair}
                rowName={rowName}
              />
              <p className={styles.hint}>Select a row to see the two questions together.</p>
            </ChartFigure>
          </>
        ) : predictors.length === 0 ? (
          <EmptyState title="Nothing ranked">
            <p>
              No question has enough respondents in {countryName} to rank against {title}, so there
              is nothing to set across countries.
            </p>
          </EmptyState>
        ) : across.isPending ? (
          <LoadingBlock height={360} label="Loading the cross-country matrix" />
        ) : across.isError ? (
          <Failure error={across.error} apiReachable={apiReachable} />
        ) : acrossResponse ? (
          <ChartFigure
            title={`${title}, across countries`}
            subtitle={acrossSubtitle(predictors.length, countryName, search.wave, search.method)}
            ariaLabel={`${title}: the ${predictors.length} questions ranked for ${countryName}, in each of ${served.countries.length} countries, as a matrix — ${countryName} first, the rest A to Z. Rust cells go with lower ${short}, teal cells with higher; the data table below carries every number.`}
            marks="table"
            response={acrossResponse}
            meta={served}
            csv={csvFor(acrossResponse, acrossName)}
            exportName={acrossName}
            isRefreshing={across.isPlaceholderData}
            predictorLabel={nameOf}
            wide
          >
            <CountryMatrix
              predictors={predictors}
              rows={acrossRows}
              cells={cells}
              minN={acrossResponse.meta.min_n}
              nameOf={nameOf}
              countries={pinnedFirst(served.countries, country)}
              chosen={country}
              short={short}
            />
          </ChartFigure>
        ) : null
      ) : null}
    </>
  )
}

function CountryMatrix({
  predictors,
  rows,
  cells,
  minN,
  nameOf,
  countries,
  chosen,
  short,
}: {
  predictors: readonly string[]
  rows: readonly EstimateRow[]
  cells: Map<string, EstimateRow>
  /** The server's ranking floor: a cell below it wears an asterisk. */
  minN: number | null | undefined
  nameOf: (name: string) => string
  /** The columns: the chosen country, then the rest A–Z. */
  countries: readonly Country[]
  chosen: number | undefined
  short: string
}) {
  // The tint window fits the cells at or above the floor; a cell below
  // it is shown all the same, tinted, with its asterisk.
  const ranked = rows.filter((row) => !belowFloor(row, minN))
  const extent = tintExtent(ranked)
  const stat = rows[0]?.stat ?? 'pearson_r'
  return (
    <HeatTable
      caption={<DivergingLegend extent={extent} stat={stat} short={short} />}
      corner="Measure ↓ · country →"
      rows={predictors.map((name) => ({ key: name, label: nameOf(name) }))}
      columns={countries.map((country) => ({
        key: String(country.code),
        label: country.name,
      }))}
      highlight={chosen !== undefined ? String(chosen) : undefined}
      wide
      cellAt={(row, column) => {
        const country = countries.find((entry) => String(entry.code) === column.key)
        const cell = country ? cells.get(heatKey(row.key, country)) : undefined
        if (!cell) return undefined
        const flagged = belowFloor(cell, minN)
        const value = formatEstimate(cell.estimate, cell.stat)
        const tip = `${value}  ${row.label} · ${column.label}\n${intervalText(cell)}`
        return {
          text: starred(value, flagged),
          title: flagged ? `${tip}\n${FEW_PEOPLE}` : tip,
          tint: divergingTint(cell.estimate, extent),
          hidden: flagged ? FEW_PEOPLE_HIDDEN : undefined,
          flagged,
        }
      }}
    />
  )
}
