// Correlates (Phase 6): what goes with a measure. Two views, one on
// screen at a time (`view`, owner decision 25 Sept 2026): the ranked list
// for one country (the server sweeps every other ordered item, ranks by
// strength and cuts the list) and the same items across every country —
// a view that is not on screen mounts nothing and fetches nothing beyond
// the ranked list it is built from. Rows are weighted correlations, point
// estimates only, so no interval is ever drawn for them. The adjusted
// models are not offered here (ADR-0018). Every number is the server's;
// this view chooses, labels and renders. Associations, not causes — said
// in the deck and in the footnote, in plain sentences.

import { getRouteApi } from '@tanstack/react-router'
import { useMemo } from 'react'
import { predictorOrder, useCorrelates, type CorrelationMethod } from '../api/correlates'
import { NetworkError } from '../api/errors'
import { useBootStatus, useMeta } from '../api/meta'
import type { Country, EstimateResponse, EstimateRow, Wave } from '../api/types'
import { WAVES } from '../api/types'
import { useVariable, useVariables } from '../api/variables'
import { useWarmApi } from '../api/warm'
import { ChartFigure } from '../charts/ChartFigure'
import { RankedBar } from '../charts/RankedBar'
import { DIVERGING_RAMP, divergingTint, signMark } from '../charts/theme'
import { HeatTable, intervalText } from '../charts/TransitionTable'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingBlock } from '../components/Loading'
import { InvalidParamsNotice } from '../components/Notice'
import { WordingPanel } from '../components/WordingPanel'
import { Disclosure } from '../components/controls/Disclosure'
import { OutcomePicker } from '../components/controls/OutcomePicker'
import { RadioRow, type RadioOption } from '../components/controls/RadioRow'
import { downloadTextFile, responseToCsv } from '../export/csv'
import { exportFilename, type ExportName } from '../export/filename'
import { formatCount, formatEstimate } from '../format'
import { groupValueLabel } from '../labels'
import { searchNavigation } from '../state/navigate'
import {
  correlatesAcrossCountries,
  correlatesRequest,
  correlatesSearchParams,
  type CorrelatesSearch,
  type CorrelatesViewName,
} from '../state/search'
import { NARROW_VIEWPORT, useMediaQuery } from '../useMediaQuery'
import { WAVE_CHIPS, WAVE_TITLES } from '../waves'
import {
  METHOD_HINT,
  acrossSubtitle,
  axisTitle,
  belowFloor,
  countriesByName,
  defaultCountry,
  excludedNote,
  heatCells,
  heatKey,
  legendEnds,
  methodLabel,
  pinnedFirst,
  rankedSubtitle,
  shortName,
  statisticPhrase,
  tintExtent,
  waveNote,
} from './correlatesRows'
import styles from './AtlasView.module.css'

const route = getRouteApi('/correlates')

/** The one sentence this view owes its reader, in both places. */
const NOT_CAUSES =
  'Associations, not causes: two answers moving together in one survey, at one time, says nothing about which one moves the other.'

const METHOD_OPTIONS: RadioOption<CorrelationMethod>[] = [
  { value: 'pearson', label: 'Straight-line (Pearson)' },
  { value: 'spearman', label: 'By rank (Spearman)' },
]

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
  const countries = useMemo(() => (served ? countriesByName(served.countries) : []), [served])

  const setSearch = (patch: Partial<CorrelatesSearch>) => {
    void navigate(searchNavigation(correlatesSearchParams({ ...search, ...patch })))
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
  const across = useCorrelates(acrossRequest, { enabled: search.view === 'countries' })
  const acrossResponse = across.data
  const rankedRows = rankedResponse?.rows ?? []
  const acrossRows = useMemo(() => acrossResponse?.rows ?? [], [acrossResponse])
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
  const short = variable ? shortName(variable) : title

  const handlePick = ({ outcome }: { outcome: string }) => {
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

  const viewOptions: RadioOption<CorrelatesViewName>[] = [
    { value: 'ranked', label: countryName ? `In ${countryName}` : 'In one country' },
    { value: 'countries', label: 'Across countries' },
  ]

  // An option the measure was not asked in stays in the row, disabled,
  // and the line under the row says why.
  const waveOptions: RadioOption<Wave>[] = WAVES.map((wave) => ({
    value: wave,
    label: WAVE_CHIPS[wave] ?? wave,
    disabled: variable !== undefined && !variable.waves_available.includes(wave),
  }))

  // What a download is called, in words (ADR-0016): the ranked list for
  // one country, or the same measures across countries.
  const rankedName: ExportName = {
    measure: title,
    view: 'Correlates',
    waves: WAVE_CHIPS[search.wave] ?? search.wave,
    ...(countryName ? { country: countryName } : {}),
  }
  const acrossName: ExportName = {
    measure: title,
    view: 'Correlates across countries',
    waves: WAVE_CHIPS[search.wave] ?? search.wave,
  }
  const csvFor = (response: EstimateResponse, name: ExportName) => ({
    kind: 'client' as const,
    onDownload: () => downloadTextFile(exportFilename(name, 'csv'), responseToCsv(response)),
  })
  const footnote = (response: EstimateResponse) => {
    const excluded = excludedNote(response.meta)
    return (
      <>
        {NOT_CAUSES} {excluded ? `${excluded} ` : ''}
      </>
    )
  }
  const offline = (error: unknown) =>
    error instanceof NetworkError && !boot.apiReachable ? (
      <p className={styles.hint} role="status">
        This view needs the live data service, which is offline right now — the Atlas and Segments
        still work.
      </p>
    ) : (
      <ErrorState apiReachable={boot.apiReachable} error={error} />
    )
  const strongest = rankedRows.find((row) => row.estimate !== null)
  const rankedAria = `${title}: the ${predictors.length} measures most strongly associated with it in ${countryName}, ${WAVE_TITLES[search.wave] ?? search.wave}, ${statisticPhrase(search.method)}.${
    strongest?.predictor
      ? ` Strongest: ${nameOf(strongest.predictor)} ${formatEstimate(strongest.estimate, strongest.stat)}.`
      : ''
  } The data table below carries every number.`

  return (
    <section>
      <h2 className="visually-hidden">Correlates</h2>
      <p className={styles.deck}>
        <span className={styles.deckLong}>
          Pick a question to see which other answers tend to go with it, in one country. Things that
          go together aren&rsquo;t necessarily cause and effect.
        </span>
        <span className={styles.deckShort}>
          Which other answers go with the one you pick, in one country.
        </span>
      </p>
      <InvalidParamsNotice
        invalid={search.invalid}
        onDismiss={() =>
          void navigate(
            searchNavigation(
              correlatesSearchParams({ ...search, invalid: undefined, invalidRaw: undefined }),
              { replace: true },
            ),
          )
        }
      />
      {/* Every control sits under its own label line, so the row aligns
          on the labels and the wave's note hangs below it. */}
      <div className={`${styles.controls} ${styles.controlsTop}`}>
        <OutcomePicker
          variables={variables.data.list}
          value={search.outcome}
          topic={search.topic}
          onSelect={handlePick}
          pairs
        />
        <RadioRow
          legend="Wave"
          name="wave"
          options={waveOptions}
          value={search.wave}
          onChange={(wave) => setSearch({ wave })}
          note={variable ? waveNote(variable.waves_available) : undefined}
        />
        <div className={styles.pairRow}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Country</span>
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
              {countries.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.field}>
            {/* An empty label line keeps the button level with the selects. */}
            <span className={styles.fieldLabel} aria-hidden="true">
              &nbsp;
            </span>
            <Disclosure label={methodLabel(search.method)}>
              <RadioRow<CorrelationMethod>
                legend="Correlation type"
                name="method"
                options={METHOD_OPTIONS}
                value={search.method ?? 'pearson'}
                onChange={(value) =>
                  setSearch({ method: value === 'spearman' ? 'spearman' : undefined })
                }
              />
              <p className={styles.methodHint}>{METHOD_HINT}</p>
            </Disclosure>
          </div>
        </div>
      </div>
      <div className={styles.controls}>
        <RadioRow
          legend="View"
          name="view"
          options={viewOptions}
          value={search.view}
          onChange={(view) => setSearch({ view })}
        />
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
        offline(ranked.error)
      ) : rankedResponse && variable ? (
        search.view === 'ranked' ? (
          <>
            <p role="status" className="visually-hidden">
              Updated: {title}, {predictors.length} measures ranked for {countryName}.
            </p>
            <ChartFigure
              title={`What travels with ${title}`}
              subtitle={rankedSubtitle(countryName, search.method, search.wave)}
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
              csv={csvFor(rankedResponse, rankedName)}
              exportName={rankedName}
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
                axisTitle={axisTitle(search.method)}
              />
            </ChartFigure>
          </>
        ) : predictors.length === 0 ? (
          <EmptyState title="Nothing ranked">
            <p>
              No measure has enough respondents in {countryName} to rank against {title}, so there
              is nothing to set across countries.
            </p>
          </EmptyState>
        ) : across.isPending ? (
          <LoadingBlock height={360} label="Loading the cross-country matrix" />
        ) : across.isError ? (
          offline(across.error)
        ) : acrossResponse ? (
          <ChartFigure
            title={`${title}, across countries`}
            subtitle={acrossSubtitle(predictors.length, countryName, search.wave)}
            ariaLabel={`${title}: the ${predictors.length} measures ranked for ${countryName}, in each of ${served.countries.length} countries, as a matrix — ${countryName} first, the rest A to Z. Rust cells go with lower ${short}, teal cells with higher; the data table below carries every number.`}
            marks="table"
            response={acrossResponse}
            meta={served}
            csv={csvFor(acrossResponse, acrossName)}
            exportName={acrossName}
            isRefreshing={across.isPlaceholderData}
            predictorLabel={nameOf}
            footnote={footnote(acrossResponse)}
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
    </section>
  )
}

/** The key to a diverging matrix, in its caption's place (outside the
 * scroll box, regular weight): the eleven ramp tokens between the
 * window's two ends — the tokens themselves, so it reads true in either
 * theme — what the two hues mean, and the dash. */
export function DivergingLegend({
  extent,
  stat,
  short,
  extra,
}: {
  extent: number
  stat: string
  short: string
  /** One more entry after the dash's (Compare several's "·"). */
  extra?: string
}) {
  const [lo, hi] = legendEnds(extent, stat)
  return (
    <span className={`${styles.legend} ${styles.legendRow}`}>
      <span className={styles.legendKey}>
        <span>{lo}</span>
        <span className={`${styles.ramp} ${styles.rampFramed}`} aria-hidden="true">
          {DIVERGING_RAMP.map((token) => (
            <span key={token} style={{ background: token }} />
          ))}
        </span>
        <span>{hi}</span>
      </span>
      <span>
        rust: goes with lower {short} · teal: goes with higher {short}
      </span>
      <span>— too few respondents</span>
      {extra && <span>{extra}</span>}
    </span>
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
  /** The server's ranking floor: cells below it read a muted "—". */
  minN: number | null | undefined
  nameOf: (name: string) => string
  /** The columns: the chosen country, then the rest A–Z. */
  countries: readonly Country[]
  chosen: number | undefined
  short: string
}) {
  // The tint window fits the cells that count; a cell below the floor
  // reads a muted dash, its number in the tooltip and the data table.
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
        const muted = belowFloor(cell, minN)
        return {
          text: muted ? '—' : formatEstimate(cell.estimate, cell.stat),
          title: muted
            ? `Too few respondents to rank (fewer than ${formatCount(minN ?? 0)})\n${formatEstimate(cell.estimate, cell.stat)}  ${row.label} · ${column.label}\n${intervalText(cell)}`
            : `${formatEstimate(cell.estimate, cell.stat)}  ${row.label} · ${column.label}\n${intervalText(cell)}`,
          tint: divergingTint(cell.estimate, extent),
          hidden: muted ? ', too few respondents' : undefined,
          muted,
        }
      }}
    />
  )
}
