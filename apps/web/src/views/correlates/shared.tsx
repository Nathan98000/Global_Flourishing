// What the three Correlates views share (ADR-0019): the props each gets
// from the page shell, the checks a question passes before it is asked
// for, the reasons a picker gives in words, the diverging key and the
// offline notice. Nothing here computes a statistic.

import { useMemo, type ReactNode } from 'react'
import { NetworkError } from '../../api/errors'
import type { CountryScope } from '../../api/correlates'
import type { Meta, VariableSummary, Wave } from '../../api/types'
import { useVariableDetails, type VariablesResult } from '../../api/variables'
import { DIVERGING_RAMP } from '../../charts/theme'
import { ErrorState } from '../../components/ErrorState'
import { shortName } from '../../labels'
import type { CorrelatesSearch } from '../../state/search'
import { WAVE_CHIPS } from '../../waves'
import { FEW_PEOPLE_KEY, legendEnds } from '../correlatesRows'
import { answerWaveOf, isMidyear, onlyAtMidyear, otherWaveOf, type OtherWave } from './midyear'
import styles from '../AtlasView.module.css'
import own from './Correlates.module.css'

/** What the page shell hands each view. */
export interface ViewProps {
  search: CorrelatesSearch
  setSearch: (patch: Partial<CorrelatesSearch>) => void
  variables: VariablesResult
  served: Meta
  /** The country every view is taken in (resolved from meta), or `all`:
   * every country pooled by adult population (ADR-0020). */
  country: CountryScope | undefined
  /** Its name — "All countries" when pooled. */
  countryName: string
  apiReachable: boolean
  /** The shared row — wave, country, correlation type — which each view
   * places under its own question sentence. */
  controls: ReactNode
  /** Compare several reports the questions its table shows (its default
   * table's, before any is named): the wave row reads them. */
  onTable?: (names: readonly string[]) => void
}

/** Whether a question can be correlated at a wave: served, ordered,
 * asked — at Midyear, in the midyear survey or in the other answers'
 * wave, whose answers it then reads (ADR-0020). */
export function orderedAt(
  variable: VariableSummary | undefined,
  wave: Wave,
  other?: OtherWave,
): boolean {
  if (variable === undefined || !variable.servable || variable.scale_type === 'nominal')
    return false
  if (variable.waves_available.includes(wave)) return true
  return wave === 'MY' && variable.waves_available.includes(other ?? 'Y1')
}

/** "Not asked in 2023", "Not asked in the midyear survey". */
export function notAskedIn(wave: Wave): string {
  return wave === 'MY'
    ? 'Not asked in the midyear survey'
    : `Not asked in ${WAVE_CHIPS[wave] ?? wave}`
}

/** Why a question can't be chosen at a wave, in a picker's words. A
 * midyear question can be chosen at every wave (the page then shows
 * Midyear), and at Midyear any other question that 2023 or 2024 asked —
 * it reads the same people's answers from then (ADR-0020). */
export function questionReason(variable: VariableSummary, wave: Wave): string | undefined {
  if (!isMidyear(variable)) {
    if (wave === 'MY') {
      if (!variable.waves_available.some((asked) => asked === 'Y1' || asked === 'Y2'))
        return 'Not asked in 2023 or 2024'
    } else if (!variable.waves_available.includes(wave)) return notAskedIn(wave)
  }
  if (variable.scale_type === 'nominal') return 'Answers have no order'
  return undefined
}

/** A picker's tag for an option (ADR-0020): "Midyear" on the midyear
 * survey's questions; at Midyear, the year the others' answers come from. */
export function pickerTag(
  variable: VariableSummary,
  search: Pick<CorrelatesSearch, 'wave' | 'other'>,
): string | undefined {
  if (search.wave !== 'MY') return onlyAtMidyear(variable, search.wave) ? 'Midyear' : undefined
  if (isMidyear(variable)) return 'Midyear'
  // One not asked in 2024 is read from 2023 (picking it switches there).
  const wave = variable.waves_available.includes(otherWaveOf(search))
    ? answerWaveOf(variable, search)
    : 'Y1'
  return `${WAVE_CHIPS[wave] ?? wave} answers`
}

/** A closed picker's tag: at Midyear, the year another wave's question
 * reads its answers from ("2023"). */
export function triggerTag(
  variable: VariableSummary | undefined,
  search: Pick<CorrelatesSearch, 'wave' | 'other'>,
): string | undefined {
  if (search.wave !== 'MY' || !variable || isMidyear(variable)) return undefined
  return WAVE_CHIPS[otherWaveOf(search)]
}

/** Why a question can't be set beside `other` in Compare two: it is the
 * other one, it can't be chosen at the wave, or the two are built from
 * the same answers (the server refuses those; the picker says so first). */
export function pairReason(
  variable: VariableSummary,
  other: VariableSummary | undefined,
  otherRole: string,
  wave: Wave,
  shares: (a: string, b: string) => boolean,
): string | undefined {
  if (other && variable.name === other.name) return `Already the ${otherRole}`
  const reason = questionReason(variable, wave)
  if (reason) return reason
  if (other && shares(variable.name, other.name))
    return `Built from the same answers as ${shortName(other)}`
  return undefined
}

/** Whether two questions are built from the same answers — a score and
 * one of its own questions, or two scores sharing one — from the scores'
 * components in their catalog details (the rule of the API's
 * `shares_answers`; the server stays the judge, this only disables a
 * picker's option and saves a request it would refuse). `settled` is
 * false while those details load; a detail that fails refuses nothing. */
export function useSharesAnswers(list: readonly VariableSummary[]): {
  shares: (a: string, b: string) => boolean
  settled: boolean
} {
  const derived = useMemo(
    () => list.filter((variable) => variable.is_derived).map((variable) => variable.name),
    [list],
  )
  const { details, isPending } = useVariableDetails(derived)
  const key = details.map((detail) => (detail ? detail.name : '')).join(',')
  const shares = useMemo(() => {
    const sets = new Map<string, Set<string>>()
    details.forEach((detail) => {
      if (detail)
        sets.set(detail.name, new Set([detail.name, ...detail.components.map((c) => c.name)]))
    })
    const answers = (name: string) => sets.get(name) ?? new Set([name])
    return (a: string, b: string) => {
      const left = answers(a)
      for (const item of answers(b)) if (left.has(item)) return true
      return false
    }
    // The details' identity changes every render; their names say when
    // the answer sets do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return { shares, settled: !isPending }
}

/** "higher" and "lower" set apart in a line of words (ADR-0020): each an
 * <em> in one shared style — italic, 600, in ink — the rest untouched.
 * (The charts' SVG does the same with styled tspans.) */
export function Turns({ text }: { text: string }) {
  return (
    <>
      {text.split(/\b(higher|lower)\b/).map((part, index) =>
        index % 2 === 1 ? (
          <em key={index} className={own.turn}>
            {part}
          </em>
        ) : (
          part
        ),
      )}
    </>
  )
}

/** A failed request: offline in words when the data service is down,
 * else the shared error state. */
export function Failure({ error, apiReachable }: { error: unknown; apiReachable: boolean }) {
  return error instanceof NetworkError && !apiReachable ? (
    <p className={styles.hint} role="status">
      This view needs the live data service, which is offline right now — the Atlas and Segments
      still work.
    </p>
  ) : (
    <ErrorState apiReachable={apiReachable} error={error} />
  )
}

/** The key to a diverging matrix, in its caption's place (outside the
 * scroll box, regular weight), on one line where it fits: the eleven ramp
 * tokens between the window's two ends — the tokens themselves, so it
 * reads true in either theme — what the two hues mean (unless the ends
 * say it), the asterisk, and one more entry if given. */
export function DivergingLegend({
  extent,
  stat,
  short,
  hues,
  ends,
  flagKey = FEW_PEOPLE_KEY,
  extra,
}: {
  extent: number
  stat: string
  /** The question the hues are read against ("goes with a higher …"). */
  short?: string
  /** The hues in words when there is no one measure; null: none. */
  hues?: string | null
  /** The two ends' words, in place of the window's numbers. */
  ends?: [string, string]
  /** The asterisk's entry. */
  flagKey?: string
  /** One more entry after the asterisk's (Compare several's "·"). */
  extra?: string
}) {
  const [lo, hi] = ends ?? legendEnds(extent, stat)
  const words =
    hues === undefined
      ? `rust: goes with a lower ${short ?? ''} · teal: goes with a higher ${short ?? ''}`
      : hues
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
      {words && (
        <span>
          <Turns text={words} />
        </span>
      )}
      <span>{flagKey}</span>
      {extra && <span>{extra}</span>}
    </span>
  )
}
