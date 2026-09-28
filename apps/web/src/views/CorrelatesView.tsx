// Correlates, organized by task (ADR-0019): how answers to different
// questions go together. Three views, one on screen at a time (`view`):
// Compare two (the default — two questions side by side), Compare several
// (a table of up to ten) and Find related (what goes with one question,
// in one country or in every country). Each view owns its question
// pickers; Wave, Country and the correlation type are shared, and each
// view's first question seeds the next. A view that is not on screen
// mounts nothing and fetches nothing. Every number is the server's; this
// page chooses, labels and renders.

import { getRouteApi } from '@tanstack/react-router'
import { useId, useMemo } from 'react'
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
  firstQuestion,
  relatedQuestion,
  secondQuestion,
  viewPatch,
  type CorrelatesSearch,
  type CorrelatesViewName,
} from '../state/search'
import { WAVE_CHIPS } from '../waves'
import { METHOD_DIFFERENCE, countriesByName, defaultCountry, waveNote } from './correlatesRows'
import { ComparePair } from './correlates/ComparePair'
import { CompareSeveral } from './correlates/CompareSeveral'
import { FindRelated } from './correlates/FindRelated'
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

/** The questions the view on screen is about: whether a wave can be
 * chosen depends on them. */
function questionsInView(search: CorrelatesSearch): {
  names: string[]
  who: 'question' | 'pair' | 'table'
} {
  if (search.view === 'pair')
    return { names: [firstQuestion(search), secondQuestion(search)], who: 'pair' }
  if (search.view === 'related') return { names: [relatedQuestion(search)], who: 'question' }
  return { names: search.vars ?? [firstQuestion(search), secondQuestion(search)], who: 'table' }
}

export function CorrelatesView() {
  useWarmApi()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const meta = useMeta()
  const boot = useBootStatus()
  const variables = useVariables()
  const served = meta.data?.meta
  const country = search.country ?? (served ? defaultCountry(served) : undefined)
  const countries = useMemo(() => (served ? countriesByName(served.countries) : []), [served])
  const noteId = useId()

  const setSearch = (patch: Partial<CorrelatesSearch>) => {
    void navigate(searchNavigation(correlatesSearchParams({ ...search, ...patch })))
  }

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

  const byName = variables.data.byName
  const countryName = country !== undefined ? groupValueLabel('country_code', country, served) : ''
  // A wave the view's questions were not asked in stays in the row,
  // disabled, and the line under the row says why.
  const inView = questionsInView(search)
  const askedAt = (wave: Wave) =>
    inView.names.filter((name) => byName[name]?.waves_available.includes(wave)).length
  const open = (wave: Wave) =>
    inView.who === 'table' ? askedAt(wave) >= 2 : askedAt(wave) === inView.names.length
  const known = inView.names.every((name) => byName[name] !== undefined)
  const waveOptions: RadioOption<Wave>[] = WAVES.map((wave) => ({
    value: wave,
    label: WAVE_CHIPS[wave] ?? wave,
    disabled: known && !open(wave),
  }))
  const note = known ? waveNote(WAVES.filter(open), inView.who) : undefined

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
          onChange={(wave) => setSearch({ wave })}
          noteId={note ? noteId : undefined}
        />
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
            {METHOD_DIFFERENCE.map((line) => (
              <p key={line} className={styles.methodHint}>
                {line}
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
