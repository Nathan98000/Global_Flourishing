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
import { WAVE_TITLES } from '../../waves'
import {
  CORRELATES_NOTE,
  CORRELATION_SCALE,
  FEW_PEOPLE_HIDDEN,
  NO_ESTIMATE,
  acrossSubtitle,
  axisEnds,
  belowFloor,
  fewPeople,
  heatCells,
  heatKey,
  pinnedFirst,
  rankedSubtitle,
  rankedTip,
  coverageLine,
  pooledPlace,
  scopeLabel,
  withCoverage,
  starred,
  statisticPhrase,
  tableCaption,
} from '../correlatesRows'
import { midyearTag, otherWaveOf, requestOther, waveName, waveTitle, withTag } from './midyear'
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
  const ready = orderedAt(variable, search.wave, otherWaveOf(search))
  // At Midyear the list ranks other waves' questions too, read from the
  // other answers' wave (ADR-0020).
  const otherWave = requestOther(search, [name], variables.byName)
  const narrow = useMediaQuery(NARROW_VIEWPORT)
  const detail = useVariable(ready ? name : null).data?.detail
  const ranked = useCorrelates(
    ready && country !== undefined
      ? correlatesRequest(search, name, country, undefined, otherWave)
      : null,
  )
  const rankedResponse = ranked.data
  const predictors = useMemo(
    () => (rankedResponse ? predictorOrder(rankedResponse.rows) : []),
    [rankedResponse],
  )
  const across = useCorrelates(
    ready && predictors.length > 0
      ? correlatesAcrossCountries(search, name, predictors, otherWave)
      : null,
    { enabled: search.scope === 'all' },
  )
  const acrossResponse = across.data
  const acrossRows = useMemo(() => acrossResponse?.rows ?? [], [acrossResponse])
  const cells = useMemo(() => heatCells(acrossRows), [acrossRows])

  // A question by its name; at Midyear a midyear question wears a small
  // tag (the subtitle names the other answers' year), and in text alone —
  // the data table — says it in words.
  const nameOf = (entry: string) => variables.byName[entry]?.display_name ?? entry
  const tagOf = (entry: string) => midyearTag(variables.byName[entry], search.wave)
  const textName = (entry: string) => withTag(nameOf(entry), tagOf(entry))
  const title = variable?.display_name ?? name
  const short = variable ? shortName(variable) : title
  const rankedRows = rankedResponse?.rows ?? []
  const waves = waveName(search.wave, otherWave)
  const rankedName: ExportName = {
    measure: title,
    view: 'Correlates',
    waves,
    ...(countryName ? { country: countryName } : {}),
  }
  const acrossName: ExportName = { measure: title, view: 'Correlates country by country', waves }
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
  const strongest = rankedRows.find((row) => row.estimate !== null)
  const pooled = country === 'all'
  // Where, in a sentence: a country, or the average of every country.
  const where = pooled ? 'all countries (their average)' : countryName
  const total = served.countries.length
  const rankedAria = `${title}: the ${predictors.length} questions most strongly associated with it in ${where}, ${waveTitle(search.wave, otherWave)}, ${statisticPhrase(search.method)}.${
    strongest?.predictor
      ? ` Strongest: ${nameOf(strongest.predictor)} ${formatEstimate(strongest.estimate, strongest.stat)}.`
      : ''
  } The data table below carries every number.`

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
      <div className={own.sentenceRow}>
        <p className={own.sentence}>
          What goes with{' '}
          <span className={own.sentenceEnd}>
            <QuestionPicker
              label="Question"
              variables={variables.list}
              wave={search.wave}
              value={name}
              unavailable={(candidate) => questionReason(candidate, search.wave)}
              countable={(candidate) => questionReason(candidate, search.wave) === undefined}
              tagOf={(candidate) => pickerTag(candidate, search)}
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
          </span>
        </p>
      </div>
      {controls}
      <div className={own.scopeRow}>
        <RadioRow<CorrelatesScope>
          legend="Where"
          legendHidden
          name="scope"
          options={[
            { value: 'country', label: scopeLabel(countryName) },
            { value: 'all', label: 'Country by country' },
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
              Updated: {title}, {predictors.length} questions ranked for {where}.
            </p>
            <ChartFigure
              title={`What goes with ${title}`}
              subtitle={rankedSubtitle(
                pooled ? pooledPlace(rankedResponse.meta.countries, served.countries) : countryName,
                search.method,
                search.wave,
                otherWave,
              )}
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
                </>
              }
              response={rankedResponse}
              meta={served}
              csv={csvFor(rankedResponse, rankedName)}
              exportName={rankedName}
              isRefreshing={ranked.isPlaceholderData}
              predictorLabel={textName}
              tableCaption={tableCaption(pooled)}
              predictorHeader="Question"
              estimateHeader="Correlation"
              note={CORRELATES_NOTE}
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
                  withCoverage(
                    rankedTip(row, label, fewPeople(row, rankedResponse.meta.min_n)),
                    coverageLine(row, total),
                  )
                }
                flagOf={(row) => fewPeople(row, rankedResponse.meta.min_n)}
                onSelectRow={openPair}
                rowName={rowName}
                tagOf={(row) => tagOf(row.predictor ?? '')}
              />
              <p className={styles.hint}>Select a row to see the two questions together.</p>
            </ChartFigure>
          </>
        ) : predictors.length === 0 ? (
          <EmptyState title="Nothing ranked">
            <p>
              No question has enough respondents in {where} to rank against {title}, so there is
              nothing to set across countries.
            </p>
          </EmptyState>
        ) : across.isPending ? (
          <LoadingBlock height={360} label="Loading the cross-country matrix" />
        ) : across.isError ? (
          <Failure error={across.error} apiReachable={apiReachable} />
        ) : acrossResponse ? (
          <ChartFigure
            title={`What goes with ${title}, country by country`}
            subtitle={acrossSubtitle(
              predictors.length,
              countryName,
              search.wave,
              search.method,
              otherWave,
            )}
            ariaLabel={`${title}: the ${predictors.length} questions ranked for ${where}, in each of ${served.countries.length} countries, as a matrix — ${pooled ? 'A to Z' : `${countryName} first, the rest A to Z`}. Rust cells go with lower answers to ${short}, teal cells with higher ones; the data table below carries every number.`}
            marks="table"
            response={acrossResponse}
            meta={served}
            csv={csvFor(acrossResponse, acrossName)}
            exportName={acrossName}
            isRefreshing={across.isPlaceholderData}
            predictorLabel={textName}
            tableCaption={tableCaption(pooled)}
            predictorHeader="Question"
            estimateHeader="Correlation"
            note={CORRELATES_NOTE}
            wide
          >
            <CountryMatrix
              predictors={predictors}
              rows={acrossRows}
              cells={cells}
              minN={acrossResponse.meta.min_n}
              nameOf={nameOf}
              tagOf={tagOf}
              countries={pinnedFirst(served.countries, country)}
              chosen={pooled ? undefined : country}
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
  tagOf,
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
  /** A question's small tag ("Midyear" at the midyear survey). */
  tagOf: (name: string) => string | undefined
  /** The columns: the chosen country, then the rest A–Z. */
  countries: readonly Country[]
  chosen: number | undefined
  short: string
}) {
  // One colour scale for both tables (review M8): a correlation's fixed
  // window, −1 to 1, on the one diverging ramp — the same tint is the same
  // value here and in Compare several. A cell below the floor is shown all
  // the same, tinted, with its asterisk.
  const extent = 1
  const stat = rows[0]?.stat ?? 'pearson_r'
  return (
    <HeatTable
      caption={<DivergingLegend extent={extent} stat={stat} short={short} ends={['−1', '+1']} />}
      corner="Question ↓ · country →"
      rows={predictors.map((name) => ({ key: name, label: nameOf(name), tag: tagOf(name) }))}
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
        if (cell.estimate === null) {
          return {
            text: '—',
            title: `${row.label} · ${column.label}\n${NO_ESTIMATE}`,
            tint: 'transparent',
            muted: true,
            hidden: ', no estimate',
          }
        }
        const flagged = belowFloor(cell, minN)
        const value = formatEstimate(cell.estimate, cell.stat)
        return {
          text: starred(value, flagged),
          title: `${starred(value, flagged)}  ${row.label} · ${column.label}\n${intervalText(cell)}`,
          tint: divergingTint(cell.estimate, extent),
          hidden: flagged ? FEW_PEOPLE_HIDDEN : undefined,
          flagged,
        }
      }}
    />
  )
}
