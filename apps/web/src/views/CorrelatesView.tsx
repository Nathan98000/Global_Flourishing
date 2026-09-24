// Correlates (Phase 6): what travels with a measure. Two requests answer
// the page — the ranked list for one country (the server sweeps every
// other ordered item, ranks by strength and cuts the list) and the same
// items across every country. Unadjusted rows are plain weighted
// correlations, point estimates only, so no interval is ever drawn for
// them; the adjusted toggle swaps in the fixed-control models, whose
// coefficients carry a design-based interval and whose figure links to
// the model card. Every number is the server's; this view chooses,
// labels and renders. Associations, not causes — said in the deck and in
// the footnote, in plain sentences.

import { Link, getRouteApi } from '@tanstack/react-router'
import { useMemo } from 'react'
import { chartRows, predictorOrder, useCorrelates } from '../api/correlates'
import { NetworkError } from '../api/errors'
import { useBootStatus, useMeta } from '../api/meta'
import type { EstimateResponse, EstimateRow, Wave } from '../api/types'
import { WAVES } from '../api/types'
import { useVariable, useVariables } from '../api/variables'
import { useWarmApi } from '../api/warm'
import { ChartFigure } from '../charts/ChartFigure'
import { RankedBar } from '../charts/RankedBar'
import { divergingTint, signMark } from '../charts/theme'
import { HeatTable, intervalText } from '../charts/TransitionTable'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingBlock } from '../components/Loading'
import { InvalidParamsNotice } from '../components/Notice'
import { WordingPanel } from '../components/WordingPanel'
import { OutcomePicker } from '../components/controls/OutcomePicker'
import { RadioRow, type RadioOption } from '../components/controls/RadioRow'
import { csvFilename, downloadTextFile, responseToCsv } from '../export/csv'
import { formatCount, formatEstimate } from '../format'
import { groupValueLabel } from '../labels'
import {
  correlatesAcrossCountries,
  correlatesRequest,
  correlatesSearchParams,
  type CorrelatesSearch,
} from '../state/search'
import { NARROW_VIEWPORT, useMediaQuery } from '../useMediaQuery'
import { WAVE_CHIPS, WAVE_TITLES } from '../waves'
import {
  METHOD_HINT,
  adjustedPhrase,
  axisTitle,
  belowFloor,
  controlsPhrase,
  defaultCountry,
  excludedNote,
  heatCells,
  heatKey,
  matrixCaption,
  outcomeUnit,
  rankedSubtitle,
  statisticPhrase,
  tintExtent,
} from './correlatesRows'
import styles from './AtlasView.module.css'

const route = getRouteApi('/correlates')

/** The one sentence this view owes its reader, in both places. */
const NOT_CAUSES =
  'Associations, not causes: two answers moving together in one survey, at one time, says nothing about which one moves the other.'

export function CorrelatesView() {
  useWarmApi()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const meta = useMeta()
  const boot = useBootStatus()
  const variables = useVariables()
  const variable = variables.data?.byName[search.outcome]
  const ordered = variable !== undefined && variable.servable && variable.scale_type !== 'nominal'
  const askedAtWave = ordered && variable.waves_available.includes(search.wave)
  const detailQuery = useVariable(ordered ? search.outcome : null)
  const detail = detailQuery.data?.detail
  const narrow = useMediaQuery(NARROW_VIEWPORT)
  const served = meta.data?.meta
  const country = search.country ?? (served ? defaultCountry(served) : undefined)
  const adjusted = search.adjusted === true

  const setSearch = (patch: Partial<CorrelatesSearch>) => {
    void navigate({ search: correlatesSearchParams({ ...search, ...patch }) as never })
  }

  const rankedRequest =
    askedAtWave && country !== undefined ? correlatesRequest(search, country) : null
  const ranked = useCorrelates(rankedRequest)
  const rankedResponse = ranked.data
  const predictors = useMemo(
    () => (rankedResponse ? predictorOrder(rankedResponse.rows) : []),
    [rankedResponse],
  )
  const acrossRequest =
    rankedRequest !== null && predictors.length > 0
      ? correlatesAcrossCountries(search, predictors)
      : null
  const across = useCorrelates(acrossRequest)
  const acrossResponse = across.data
  const rankedRows = useMemo(
    () => (rankedResponse ? chartRows(rankedResponse.rows) : []),
    [rankedResponse],
  )
  const acrossRows = useMemo(
    () => (acrossResponse ? chartRows(acrossResponse.rows) : []),
    [acrossResponse],
  )
  const cells = useMemo(() => heatCells(acrossRows), [acrossRows])

  if (meta.isPending || variables.isPending) {
    return (
      <section>
        <h2>Correlates</h2>
        <LoadingBlock height={420} label="Loading the Correlates view" />
      </section>
    )
  }
  if (meta.isError || variables.isError || !served || !variables.data) {
    return (
      <section>
        <h2>Correlates</h2>
        <ErrorState apiReachable={boot.apiReachable} error={meta.error ?? variables.error} />
      </section>
    )
  }

  const nameOf = (name: string) => variables.data.byName[name]?.display_name ?? name
  const countryName = country !== undefined ? groupValueLabel('country_code', country, served) : ''
  const title = variable?.display_name ?? search.outcome

  const handlePick = ({ outcome, topic }: { outcome?: string; topic?: string }) => {
    if (outcome === undefined) {
      setSearch({ topic })
      return
    }
    const target = variables.data.byName[outcome]
    const waves = target?.waves_available ?? []
    setSearch({
      outcome,
      topic: undefined,
      // Keep the wave when the new measure was asked then; else its first.
      wave: waves.includes(search.wave)
        ? search.wave
        : ((waves[0] as Wave | undefined) ?? search.wave),
      invalid: undefined,
      invalidRaw: undefined,
    })
  }

  const waveOptions: RadioOption<Wave>[] = WAVES.map((wave) => ({
    value: wave,
    label: WAVE_CHIPS[wave] ?? wave,
    disabled: variable !== undefined && !variable.waves_available.includes(wave),
    title:
      variable !== undefined && !variable.waves_available.includes(wave)
        ? `Not asked in ${WAVE_TITLES[wave] ?? wave}`
        : undefined,
  }))

  const displayOptions = (
    <>
      <RadioRow<'plain' | 'adjusted'>
        legend="Model"
        name="model"
        options={[
          { value: 'plain', label: 'Correlation' },
          { value: 'adjusted', label: 'Adjusted difference' },
        ]}
        value={adjusted ? 'adjusted' : 'plain'}
        onChange={(value) => setSearch({ adjusted: value === 'adjusted' ? true : undefined })}
      />
      <RadioRow<'pearson' | 'spearman'>
        legend="Correlation"
        name="method"
        options={[
          {
            value: 'pearson',
            label: 'Pearson',
            disabled: adjusted,
            title: adjusted
              ? 'The adjusted model reports a coefficient, not a correlation'
              : undefined,
          },
          {
            value: 'spearman',
            label: 'Spearman',
            disabled: adjusted,
            title: adjusted
              ? 'The adjusted model reports a coefficient, not a correlation'
              : undefined,
          },
        ]}
        value={search.method ?? 'pearson'}
        onChange={(value) => setSearch({ method: value === 'spearman' ? 'spearman' : undefined })}
      />
      {!adjusted && <p className={styles.hint}>{METHOD_HINT}</p>}
    </>
  )

  const version = rankedResponse?.meta.data_version ?? null
  const csvFor = (response: EstimateResponse, tag: string) => ({
    kind: 'client' as const,
    onDownload: () =>
      downloadTextFile(
        csvFilename(search.outcome, search.wave, tag, version),
        responseToCsv(response),
      ),
  })
  const footnote = (response: EstimateResponse) => {
    const excluded = excludedNote(response.meta)
    return adjusted ? (
      <>
        {NOT_CAUSES} The model holds {controlsPhrase(response.meta, served)} fixed and nothing else.{' '}
        <Link to="/model-cards" hash={response.meta.model ?? 'continuous'}>
          Read the model card
        </Link>
        . {excluded ? `${excluded} ` : ''}
      </>
    ) : (
      <>
        {NOT_CAUSES} {excluded ? `${excluded} ` : ''}
      </>
    )
  }
  const strongest = rankedRows.find((row) => row.estimate !== null)
  const rankedAria = `${title}: the ${predictors.length} measures most strongly associated with it in ${countryName}, ${WAVE_TITLES[search.wave] ?? search.wave}, ${statisticPhrase(adjusted, search.method)}.${
    strongest?.predictor
      ? ` Strongest: ${nameOf(strongest.predictor)} ${formatEstimate(strongest.estimate, strongest.stat)}.`
      : ''
  } The data table below carries every number.`

  return (
    <section>
      <h2 className="visually-hidden">Correlates</h2>
      <p className={styles.deck}>
        <span className={styles.deckLong}>
          What travels with a measure: for one country, the other questions whose answers move
          together with it, ranked by the strength of the association in either direction. These are
          associations, not causes — things that go together in one survey, at one time.
        </span>
        <span className={styles.deckShort}>
          What travels with a measure — associations, not causes.
        </span>
      </p>
      <InvalidParamsNotice
        invalid={search.invalid}
        onDismiss={() =>
          void navigate({
            search: correlatesSearchParams({
              ...search,
              invalid: undefined,
              invalidRaw: undefined,
            }) as never,
            replace: true,
          })
        }
      />
      <div className={styles.controls}>
        <OutcomePicker
          variables={variables.data.list}
          value={search.outcome}
          topic={search.topic}
          onSelect={handlePick}
          fields={narrow ? 'measure' : 'all'}
        />
        <RadioRow
          legend="Wave"
          name="wave"
          options={waveOptions}
          value={search.wave}
          onChange={(wave) => setSearch({ wave })}
        />
        <label className={styles.countrySelect}>
          Country{' '}
          <select
            value={country ?? ''}
            onChange={(event) =>
              setSearch({
                country:
                  Number(event.target.value) === defaultCountry(served)
                    ? undefined
                    : Number(event.target.value),
              })
            }
          >
            {served.countries.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        {narrow ? (
          <details className={styles.moreOptions}>
            <summary>More options — model, correlation, topic</summary>
            <div className={styles.moreBody}>
              <OutcomePicker
                variables={variables.data.list}
                value={search.outcome}
                topic={search.topic}
                onSelect={handlePick}
                fields="topic-and-search"
              />
              {displayOptions}
            </div>
          </details>
        ) : (
          displayOptions
        )}
      </div>

      {!ordered ? (
        <EmptyState title="Choose a measure to begin">
          <p>
            {variable === undefined
              ? `The link asked for “${search.outcome}”, which isn't in this release's codebook — `
              : variable.scale_type === 'nominal'
                ? `“${title}” is a set of categories with no order, so it has no correlation — `
                : `“${search.outcome}” can't be charted (its codebook entry says why) — `}
            pick a topic and measure above, or search all the measures.
          </p>
        </EmptyState>
      ) : !askedAtWave ? (
        <EmptyState title={`Not asked in ${WAVE_TITLES[search.wave] ?? search.wave}`}>
          <p>
            {title} was asked in{' '}
            {variable.waves_available.map((wave) => WAVE_TITLES[wave] ?? wave).join(' and ')} — pick
            one of those waves above.
          </p>
        </EmptyState>
      ) : ranked.isPending ? (
        <LoadingBlock height={520} label="Loading the ranked list" />
      ) : ranked.isError ? (
        ranked.error instanceof NetworkError && !boot.apiReachable ? (
          <p className={styles.hint} role="status">
            This view needs the live data service, which is offline right now — the Atlas and
            Breakdowns still work.
          </p>
        ) : (
          <ErrorState apiReachable={boot.apiReachable} error={ranked.error} />
        )
      ) : rankedResponse && variable ? (
        <>
          <p role="status" className="visually-hidden">
            Updated: {title}, {predictors.length} measures ranked for {countryName}.
          </p>
          <ChartFigure
            title={`What travels with ${title}`}
            subtitle={rankedSubtitle(
              countryName,
              adjusted,
              search.method,
              search.wave,
              adjustedPhrase(variable, rankedResponse.meta, served),
            )}
            ariaLabel={rankedAria}
            marks="dots"
            intro={
              detail && (
                <div className={styles.wording}>
                  <WordingPanel detail={detail} />
                </div>
              )
            }
            response={rankedResponse}
            meta={served}
            csv={csvFor(rankedResponse, adjusted ? 'adjusted' : `${search.method ?? 'pearson'}_r`)}
            isRefreshing={ranked.isPlaceholderData}
            predictorLabel={nameOf}
            footnote={footnote(rankedResponse)}
          >
            <RankedBar
              rows={rankedRows}
              meta={served}
              responseMeta={rankedResponse.meta}
              variable={variable}
              color={signMark(1)}
              labelOf={(row) => nameOf(row.predictor ?? '')}
              colorOf={(row) => signMark(row.estimate)}
              zeroRule
              labelWidth={narrow ? 200 : 230}
              labelFontSize={narrow ? 12 : 13.5}
              axisTitle={axisTitle(adjusted, search.method, variable)}
            />
            {adjusted && (
              <p className={styles.hint}>
                Each dot: the change in {title}, in {outcomeUnit(variable)}, per one standard
                deviation of the measure, among people alike on every control.
              </p>
            )}
          </ChartFigure>

          {acrossRequest !== null &&
            (across.isPending ? (
              <LoadingBlock height={360} label="Loading the cross-country matrix" />
            ) : across.isError ? (
              <ErrorState apiReachable={boot.apiReachable} error={across.error} />
            ) : acrossResponse ? (
              <ChartFigure
                title="Across countries"
                subtitle={`The same measures in every country · ${statisticPhrase(adjusted, search.method)} · ${WAVE_TITLES[search.wave] ?? search.wave}`}
                ariaLabel={`${title}: the ${predictors.length} measures ranked above, in each of ${served.countries.length} countries, as a matrix. Rust cells are negative associations, teal cells positive; the data table below carries every number.`}
                marks="table"
                response={acrossResponse}
                meta={served}
                csv={csvFor(
                  acrossResponse,
                  adjusted ? 'adjusted_by-country' : `${search.method ?? 'pearson'}_r_by-country`,
                )}
                isRefreshing={across.isPlaceholderData}
                predictorLabel={nameOf}
                footnote={footnote(acrossResponse)}
              >
                <CountryMatrix
                  predictors={predictors}
                  rows={acrossRows}
                  cells={cells}
                  minN={acrossResponse.meta.min_n}
                  nameOf={nameOf}
                  served={served}
                  outcome={title}
                />
              </ChartFigure>
            ) : null)}
        </>
      ) : null}
    </section>
  )
}

function CountryMatrix({
  predictors,
  rows,
  cells,
  minN,
  nameOf,
  served,
  outcome,
}: {
  predictors: readonly string[]
  rows: readonly EstimateRow[]
  cells: Map<string, EstimateRow>
  /** The server's ranking floor: cells below it are shown, untinted. */
  minN: number | null | undefined
  nameOf: (name: string) => string
  served: NonNullable<ReturnType<typeof useMeta>['data']>['meta']
  outcome: string
}) {
  // The tint window fits the cells that count; a cell below the floor is
  // shown in muted ink without a tint.
  const ranked = rows.filter((row) => !belowFloor(row, minN))
  const extent = tintExtent(ranked)
  const stat = rows[0]?.stat ?? 'pearson_r'
  return (
    <HeatTable
      caption={matrixCaption(outcome, extent, stat)}
      corner="Measure ↓ · country →"
      columnNoun="countries"
      rows={predictors.map((name) => ({ key: name, label: nameOf(name) }))}
      columns={served.countries.map((country) => ({
        key: String(country.code),
        label: country.name,
      }))}
      cellAt={(row, column) => {
        const country = served.countries.find((entry) => String(entry.code) === column.key)
        const cell = country ? cells.get(heatKey(row.key, country)) : undefined
        if (!cell) return undefined
        const muted = belowFloor(cell, minN)
        return {
          text: formatEstimate(cell.estimate, cell.stat),
          title: muted
            ? `n = ${formatCount(cell.n)} — too few to rank\n${formatEstimate(cell.estimate, cell.stat)}  ${row.label} · ${column.label}\n${intervalText(cell)}`
            : `${formatEstimate(cell.estimate, cell.stat)}  ${row.label} · ${column.label}\n${intervalText(cell)}\nn = ${formatCount(cell.n)}`,
          tint: divergingTint(cell.estimate, extent),
          hidden: muted
            ? `, n = ${formatCount(cell.n)}, too few to rank`
            : `, n = ${formatCount(cell.n)}`,
          muted,
        }
      }}
    />
  )
}
