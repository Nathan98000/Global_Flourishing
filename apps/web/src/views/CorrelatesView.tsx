// Correlates, organized by task (ADR-0019): how answers to different
// questions go together. Three views, one on screen at a time (`view`):
// Compare two (the default — two questions side by side), Compare several
// (a table of up to ten) and Find related (what goes with one question,
// in one country or in every country). Each view owns its question
// pickers; Wave, Country and the correlation type are shared, and each
// view's first question seeds the next. A view that is not on screen
// mounts nothing and fetches nothing. The midyear survey's questions are
// reachable from every wave, paired with the same people's 2023 or 2024
// answers (ADR-0020): every change runs through the rules in
// correlates/midyear.ts — the wave follows the questions in view — and a
// polite line under the row announces what changed on its own. Every
// number is the server's; this page chooses, labels and renders.

import { getRouteApi } from '@tanstack/react-router'
import { useEffect, useId, useMemo, useState } from 'react'
import type { CorrelationMethod } from '../api/correlates'
import { useBootStatus, useMeta } from '../api/meta'
import type { Wave } from '../api/types'
import { WAVES } from '../api/types'
import { useVariables } from '../api/variables'
import { useWarmApi } from '../api/warm'
import { ErrorState } from '../components/ErrorState'
import { LoadingBlock } from '../components/Loading'
import { InvalidParamsNotice } from '../components/Notice'
import { Disclosure } from '../components/controls/Disclosure'
import { RadioRow, type RadioOption } from '../components/controls/RadioRow'
import { groupValueLabel } from '../labels'
import { searchNavigation } from '../state/navigate'
import {
  correlatesSearchParams,
  viewPatch,
  type CorrelatesSearch,
  type CorrelatesViewName,
} from '../state/search'
import { WAVE_CHIPS } from '../waves'
import {
  ALL_COUNTRIES,
  METHOD_DIFFERENCE,
  countriesByName,
  defaultCountry,
  waveNote,
} from './correlatesRows'
import { ComparePair } from './correlates/ComparePair'
import { CompareSeveral } from './correlates/CompareSeveral'
import { FindRelated } from './correlates/FindRelated'
import {
  chooseWave,
  no2024Note,
  otherNoteParts,
  otherOpen,
  otherWaveOf,
  questionsInView,
  reconcile,
  showsOther,
  timingPhrase,
  waveOpen,
  type Change,
} from './correlates/midyear'
import type { ViewProps } from './correlates/shared'
import styles from './AtlasView.module.css'
import own from './correlates/Correlates.module.css'

const route = getRouteApi('/correlates')

const VIEW_OPTIONS: RadioOption<CorrelatesViewName>[] = [
  { value: 'pair', label: 'Compare two' },
  { value: 'matrix', label: 'Compare several' },
  { value: 'related', label: 'Find related' },
]

/** What each view is for, in one line under the switcher. */
const PURPOSE: Record<CorrelatesViewName, string> = {
  pair: 'Pick two questions to see how people’s answers to one line up with their answers to the other.',
  matrix: 'Pick up to 10 questions to see how strongly each pair goes together.',
  related:
    'Pick one question to find the other questions whose answers rise or fall most closely with it, strongest first. Select any row to see the two side by side.',
}

const METHOD_OPTIONS: RadioOption<CorrelationMethod>[] = [
  { value: 'pearson', label: 'Straight-line' },
  { value: 'spearman', label: 'By rank' },
]

/** Where the other questions' answers come from, at Midyear. */
export function CorrelatesView() {
  useWarmApi()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const meta = useMeta()
  const boot = useBootStatus()
  const variables = useVariables()
  const served = meta.data?.meta
  // A country's code, or `all`: every country pooled (ADR-0020).
  const country = search.country ?? (served ? defaultCountry(served) : undefined)
  const countries = useMemo(() => (served ? countriesByName(served.countries) : []), [served])
  const noteId = useId()
  // What changed without being chosen (ADR-0020), until the next change.
  const [notice, setNotice] = useState<string | undefined>()
  // The table Compare several shows before one is named (its default).
  const [table, setTable] = useState<readonly string[] | undefined>()
  const byName = variables.data?.byName ?? {}

  /** A change, then whatever the midyear rules make of it — the wave
   * following the questions in view — announced in one line. */
  const apply = (change: Change) => {
    let next: CorrelatesSearch = { ...search, ...change.patch }
    const notices = change.notice ? [change.notice] : []
    for (let step = 0; step < 3; step += 1) {
      const fix = reconcile(next, byName, next.vars ? undefined : table)
      if (Object.keys(fix.patch).length === 0) break
      next = { ...next, ...fix.patch }
      if (fix.notice) notices.push(fix.notice)
    }
    setNotice(notices.length > 0 ? notices.join(' ') : undefined)
    void navigate(searchNavigation(correlatesSearchParams(next)))
  }
  const setSearch = (patch: Partial<CorrelatesSearch>) => apply({ patch })

  // A link can arrive in a state the rules never leave the page in (a
  // midyear question at 2023, say): settled once, in place.
  const catalog = variables.data
  useEffect(() => {
    if (!catalog) return
    const fix = reconcile(search, catalog.byName, search.vars ? undefined : table)
    if (Object.keys(fix.patch).length === 0) return
    if (fix.notice) setNotice(fix.notice)
    void navigate(
      searchNavigation(correlatesSearchParams({ ...search, ...fix.patch }), { replace: true }),
    )
  }, [catalog, search, table, navigate])

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

  const countryName =
    country === 'all'
      ? ALL_COUNTRIES
      : country !== undefined
        ? groupValueLabel('country_code', country, served)
        : ''
  // A wave the view's questions were not asked in stays in the row,
  // disabled, and the line under the row says why. Midyear never is: its
  // questions are reachable from every wave (ADR-0020).
  const shown = search.vars ? undefined : table
  const inView = questionsInView(search, shown)
  const open = (wave: Wave) => waveOpen(search, byName, wave, shown)
  const known = inView.names.every((name) => byName[name] !== undefined)
  const waveOptions: RadioOption<Wave>[] = WAVES.map((wave) => ({
    value: wave,
    label: WAVE_CHIPS[wave] ?? wave,
    disabled: known && !open(wave),
  }))
  // At Midyear with another wave's question in view, the row note says
  // whose answers and when — for the country on screen — and holds the
  // choice of year itself (review M3): no second row of year buttons.
  const withOther = known && showsOther(search, byName, shown)
  const other = otherWaveOf(search)
  const parts = otherNoteParts(
    search.view !== 'pair',
    timingPhrase(other, country, served.midyear_timing),
  )
  const no2024 = withOther ? no2024Note(search, byName, shown) : undefined
  const note = !known ? undefined : withOther ? (
    <>
      {parts.before}{' '}
      <select
        className={own.inlineSelect}
        aria-label="Year of the other answers"
        value={other}
        onChange={(event) =>
          apply({ patch: { other: event.target.value === 'Y2' ? 'Y2' : undefined } })
        }
      >
        <option value="Y1">2023</option>
        <option value="Y2" disabled={!otherOpen(search, byName, 'Y2', shown)}>
          2024
        </option>
      </select>{' '}
      {parts.after}
      {no2024 ? ` ${no2024}` : ''}
    </>
  ) : (
    waveNote(WAVES.filter(open), inView.who)
  )

  // One row — Wave · Country · Correlation type, each under its label —
  // and, under the whole row, why a wave is unavailable.
  const controls = (
    <div className={own.controlRow}>
      <div className={own.controlCells}>
        <RadioRow
          legend="Wave"
          name="wave"
          options={waveOptions}
          value={search.wave}
          onChange={(wave) => apply(chooseWave(search, wave, byName, shown))}
          noteId={note ? noteId : undefined}
        />
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Country</span>
          <select
            value={country ?? ''}
            onChange={(event) => {
              const value = event.target.value
              setSearch({
                country:
                  value === 'all'
                    ? 'all'
                    : Number(value) === defaultCountry(served)
                      ? undefined
                      : Number(value),
              })
            }}
          >
            {/* Every country pooled first, then each on its own, A–Z. */}
            <option value="all">{ALL_COUNTRIES}</option>
            {countries.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <div className={own.typeCell}>
          <RadioRow<CorrelationMethod>
            legend="Correlation type"
            name="method"
            options={METHOD_OPTIONS}
            value={search.method ?? 'pearson'}
            onChange={(value) =>
              setSearch({ method: value === 'spearman' ? 'spearman' : undefined })
            }
          />
          <Disclosure variant="info" label="What’s the difference?">
            {METHOD_DIFFERENCE.map((paragraph, index) => (
              <p key={index} className={styles.methodHint}>
                {paragraph.map((words, at) =>
                  typeof words === 'string' ? words : <strong key={at}>{words.strong}</strong>,
                )}
              </p>
            ))}
          </Disclosure>
        </div>
      </div>
      {note && (
        <p id={noteId} className={own.rowNote}>
          {note}
        </p>
      )}
      {/* What changed on its own (ADR-0020): always in the page, so the
          polite region is there before it speaks. */}
      <p role="status" className={own.notice}>
        {notice}
      </p>
    </div>
  )

  const props: ViewProps = {
    search,
    setSearch,
    variables: variables.data,
    served,
    country,
    countryName,
    apiReachable: boot.apiReachable,
    controls,
    onTable: setTable,
  }

  return (
    <section>
      <h2 className="visually-hidden">Correlates</h2>
      <p className={styles.deck}>See how answers to different questions go together.</p>
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
      <div className={styles.controls}>
        <RadioRow
          legend="View"
          legendHidden
          name="view"
          options={VIEW_OPTIONS}
          value={search.view}
          onChange={(view) => setSearch(viewPatch(search, view))}
        />
      </div>
      <p className={own.purpose}>{PURPOSE[search.view]}</p>
      {search.view === 'pair' ? (
        <ComparePair {...props} />
      ) : search.view === 'matrix' ? (
        <CompareSeveral {...props} />
      ) : (
        <FindRelated {...props} />
      )}
    </section>
  )
}
