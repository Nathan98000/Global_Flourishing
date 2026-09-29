// The midyear survey on the Correlates page (ADR-0020): its questions are
// reachable from every wave, and paired with the same people's answers
// from 2023 or 2024. Pure rules, no statistics: which answers a question
// reads, which wave chips and other-answers choices are open, and — when
// a choice would leave the page in a state it can't show — the automatic
// change and the one sentence that announces it. The page shell runs
// every change through these; the views only label.

import type { VariableSummary, Wave } from '../../api/types'
import {
  DEFAULT_PAIR,
  TABLE_MAX,
  TABLE_MIN,
  firstQuestion,
  relatedQuestion,
  secondQuestion,
  type CorrelatesSearch,
} from '../../state/search'
import { WAVE_CHIPS, WAVE_NAMES, WAVE_TITLES } from '../../waves'

/** The midyear question a view takes when Midyear is chosen with none in
 * view (owner decision, 29 Sept 2026). */
export const MIDYEAR_QUESTION = 'TIME_MEDIA'

/** The waves a midyear answer is set beside. */
export type OtherWave = 'Y1' | 'Y2'

type ByName = Readonly<Record<string, VariableSummary | undefined>>

/** A question the midyear survey asked: at Midyear it reads its own
 * midyear answers. */
export function isMidyear(variable: Pick<VariableSummary, 'waves_available'> | undefined): boolean {
  return variable?.waves_available.includes('MY') === true
}

/** A midyear question the page can show only at Midyear from `wave`: the
 * midyear survey asked it, `wave` did not (every midyear question of the
 * release, from 2023 or 2024; a question asked in both would stay). */
export function onlyAtMidyear(
  variable: Pick<VariableSummary, 'waves_available'> | undefined,
  wave: Wave,
): boolean {
  return isMidyear(variable) && variable?.waves_available.includes(wave) !== true
}

/** The other questions' answers wave at Midyear (the URL's `other`). */
export function otherWaveOf(search: Pick<CorrelatesSearch, 'other'>): OtherWave {
  return search.other ?? 'Y1'
}

/** Which wave a question's answers come from on the page. */
export function answerWaveOf(
  variable: Pick<VariableSummary, 'waves_available'> | undefined,
  search: Pick<CorrelatesSearch, 'wave' | 'other'>,
): Wave {
  if (search.wave !== 'MY' || isMidyear(variable)) return search.wave
  return otherWaveOf(search)
}

/** The questions the view on screen is about, and whether they are a
 * question, a pair or a table. A table not yet named (the default one)
 * is the table the view reports it shows, else its seed pair. */
export function questionsInView(
  search: CorrelatesSearch,
  table?: readonly string[],
): { names: string[]; who: 'question' | 'pair' | 'table' } {
  if (search.view === 'pair')
    return { names: [firstQuestion(search), secondQuestion(search)], who: 'pair' }
  if (search.view === 'related') return { names: [relatedQuestion(search)], who: 'question' }
  return {
    names: [...(search.vars ?? table ?? [firstQuestion(search), secondQuestion(search)])],
    who: 'table',
  }
}

function split(names: readonly string[], byName: ByName) {
  const midyear = names.filter((name) => isMidyear(byName[name]))
  const others = names.filter((name) => !isMidyear(byName[name]))
  return { midyear, others }
}

/** Whether the other-answers control shows: at Midyear, with a question
 * from another wave in view — always, in Find related (the list ranks
 * other waves' questions). */
export function showsOther(
  search: CorrelatesSearch,
  byName: ByName,
  table?: readonly string[],
): boolean {
  if (search.wave !== 'MY') return false
  if (search.view === 'related') return true
  return split(questionsInView(search, table).names, byName).others.length > 0
}

/** Whether a request at Midyear names the other answers' wave: Find
 * related always; a pair or a table when it holds another wave's
 * question. Undefined elsewhere. */
export function requestOther(
  search: CorrelatesSearch,
  names: readonly string[],
  byName: ByName,
): OtherWave | undefined {
  if (search.wave !== 'MY') return undefined
  if (search.view === 'related') return otherWaveOf(search)
  return names.some((name) => !isMidyear(byName[name])) ? otherWaveOf(search) : undefined
}

/** Whether a wave chip is open. Midyear always is; 2023 or 2024 only when
 * every question from another wave in view was asked there (a table: two
 * of them at least, the rest left out) — the midyear questions give way
 * when it is chosen. */
export function waveOpen(
  search: CorrelatesSearch,
  byName: ByName,
  wave: Wave,
  table?: readonly string[],
): boolean {
  if (wave === 'MY') return true
  const { names, who } = questionsInView(search, table)
  // The questions that would stay: every one but those only Midyear asked.
  const kept = names.filter((name) => !onlyAtMidyear(byName[name], wave))
  const asked = kept.filter((name) => byName[name]?.waves_available.includes(wave)).length
  if (who === 'table') return kept.length < TABLE_MIN || asked >= TABLE_MIN
  return asked === kept.length
}

/** Whether an other-answers choice is open: 2024 when every question
 * from another wave in view was asked in 2024. */
export function otherOpen(
  search: CorrelatesSearch,
  byName: ByName,
  other: OtherWave,
  table?: readonly string[],
): boolean {
  const { others } = split(questionsInView(search, table).names, byName)
  return others.every((name) => byName[name]?.waves_available.includes(other))
}

/** The wave, as a subtitle says it: at Midyear beside another wave's
 * answers, "Midyear survey, with 2024 answers from the same people". */
export function waveTitle(wave: Wave, other: OtherWave | undefined): string {
  if (wave === 'MY' && other)
    return `Midyear survey, with ${WAVE_CHIPS[other]} answers from the same people`
  return WAVE_TITLES[wave] ?? wave
}

/** The wave in a download's name: "Midyear with 2023". */
export function waveName(wave: Wave, other: OtherWave | undefined): string {
  const chip = WAVE_CHIPS[wave] ?? wave
  return wave === 'MY' && other ? `${chip} with ${WAVE_CHIPS[other]}` : chip
}

/** A question's label with the year its answers come from, where the page
 * mixes waves: "Life evaluation today (2023)". */
export function yearTagged(
  label: string,
  variable: Pick<VariableSummary, 'waves_available'> | undefined,
  wave: Wave,
  other: OtherWave | undefined,
): string {
  if (wave !== 'MY' || !other || isMidyear(variable)) return label
  return `${label} (${WAVE_CHIPS[other]})`
}

/** The row note at Midyear, by the other answers' wave. */
export function otherNote(other: OtherWave): string {
  return other === 'Y2'
    ? 'The other questions use the same people’s 2024 answers: from the same interview for two in three people, about six months later for the rest.'
    : 'The other questions use the same people’s 2023 answers, usually given 8–12 months earlier.'
}

/** Why the 2024 choice is closed, in a sentence. */
export function no2024Note(search: CorrelatesSearch, byName: ByName, table?: readonly string[]) {
  const { others } = split(questionsInView(search, table).names, byName)
  const missing = others.filter((name) => !byName[name]?.waves_available.includes('Y2'))
  if (missing.length === 0) return undefined
  const named = listAnd(missing.map((name) => displayName(name, byName)))
  const verb = missing.length === 1 ? "wasn't" : "weren't"
  return `2024 isn't available: ${named} ${verb} asked in ${WAVE_NAMES.Y2}.`
}

// --- the automatic changes -------------------------------------------------

export interface Change {
  patch: Partial<CorrelatesSearch>
  /** What changed without being chosen, in one sentence. */
  notice?: string
}

function displayName(name: string, byName: ByName): string {
  return byName[name]?.display_name ?? name
}

function listAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** A wave chip chosen. Midyear keeps the wave you were on as the other
 * answers' wave, and brings in a midyear question when none is in view;
 * 2023 or 2024 chosen at Midyear replaces the midyear questions in view
 * with the defaults. */
export function chooseWave(
  search: CorrelatesSearch,
  wave: Wave,
  byName: ByName,
  table?: readonly string[],
): Change {
  if (wave === search.wave) return { patch: {} }
  const { names } = questionsInView(search, table)
  const { midyear } = split(names, byName)
  const mid = displayName(MIDYEAR_QUESTION, byName)
  if (wave === 'MY') {
    const other: OtherWave = search.wave === 'Y2' ? 'Y2' : 'Y1'
    const base: Partial<CorrelatesSearch> = { wave, other: other === 'Y2' ? 'Y2' : undefined }
    if (midyear.length > 0) return { patch: base }
    if (search.view === 'pair') {
      const a = firstQuestion(search)
      const b = secondQuestion(search)
      const keepB = byName[b]?.waves_available.includes(other) ?? false
      const nextB = keepB ? b : DEFAULT_PAIR.a
      const notice = keepB
        ? `${mid}, from the midyear survey, took the place of ${displayName(a, byName)}.`
        : `${mid}, from the midyear survey, took the place of ${displayName(a, byName)}, and ${displayName(nextB, byName)} the place of ${displayName(b, byName)}.`
      return { patch: { ...base, a: MIDYEAR_QUESTION, b: nextB, outcome: undefined }, notice }
    }
    if (search.view === 'related') {
      const was = relatedQuestion(search)
      return {
        patch: { ...base, outcome: MIDYEAR_QUESTION, a: undefined },
        notice: `${mid}, from the midyear survey, took the place of ${displayName(was, byName)}.`,
      }
    }
    const full = names.length >= TABLE_MAX
    const kept = full ? names.slice(0, TABLE_MAX - 1) : names
    const dropped = full ? names[names.length - 1] : undefined
    return {
      patch: { ...base, vars: [MIDYEAR_QUESTION, ...kept] },
      notice: dropped
        ? `${mid}, from the midyear survey, joined the table, and ${displayName(dropped, byName)} left it: it holds ten at most.`
        : `${mid}, from the midyear survey, joined the table.`,
    }
  }
  // 2023 or 2024: the midyear questions that wave did not ask give way.
  const base: Partial<CorrelatesSearch> = { wave, other: undefined }
  const leaving = names.filter((name) => onlyAtMidyear(byName[name], wave))
  if (search.wave !== 'MY' || leaving.length === 0) return { patch: base }
  const gone = listAnd(leaving.map((name) => displayName(name, byName)))
  const only = leaving.length === 1 ? 'was asked only' : 'were asked only'
  if (search.view === 'pair') {
    const a = firstQuestion(search)
    const b = secondQuestion(search)
    const aMid = leaving.includes(a)
    const bMid = leaving.includes(b)
    if (aMid && bMid) {
      return {
        patch: { ...base, a: undefined, b: undefined, outcome: undefined },
        notice: `${gone} ${only} in the midyear survey, so ${displayName(DEFAULT_PAIR.a, byName)} and ${displayName(DEFAULT_PAIR.b, byName)} took their places.`,
      }
    }
    if (aMid) {
      const nextA = b === DEFAULT_PAIR.a ? DEFAULT_PAIR.b : DEFAULT_PAIR.a
      return {
        patch: { ...base, a: nextA, b, outcome: undefined },
        notice: `${gone} ${only} in the midyear survey, so ${displayName(nextA, byName)} took its place.`,
      }
    }
    const nextB = a === DEFAULT_PAIR.b ? DEFAULT_PAIR.a : DEFAULT_PAIR.b
    return {
      patch: { ...base, b: undefined },
      notice: `${gone} ${only} in the midyear survey, so ${displayName(nextB, byName)} took its place.`,
    }
  }
  if (search.view === 'related') {
    return {
      patch: { ...base, outcome: undefined, a: undefined },
      notice: `${gone} ${only} in the midyear survey, so ${displayName(DEFAULT_PAIR.a, byName)} took its place.`,
    }
  }
  const left = names.filter((name) => !leaving.includes(name))
  return left.length >= TABLE_MIN
    ? {
        patch: { ...base, vars: left },
        notice: `${gone} ${only} in the midyear survey, so ${leaving.length === 1 ? 'it' : 'they'} left the table.`,
      }
    : {
        patch: { ...base, vars: undefined },
        notice: `${gone} ${only} in the midyear survey, so the table starts again from its defaults.`,
      }
}

/** The page after any change of question or view: the wave follows the
 * questions in view. A midyear question picked at 2023 or 2024 switches
 * to Midyear (that wave the other answers' wave); at Midyear with no
 * midyear question left, the wave becomes the other answers' wave; at
 * Midyear with 2024, a question asked only in 2023 switches the other
 * answers to 2023. */
export function reconcile(
  next: CorrelatesSearch,
  byName: ByName,
  table?: readonly string[],
): Change {
  const { names } = questionsInView(next, table)
  const { midyear, others } = split(names, byName)
  if (next.wave !== 'MY') {
    const pulling = names.filter((name) => onlyAtMidyear(byName[name], next.wave))
    if (pulling.length === 0) return { patch: {} }
    const year = WAVE_CHIPS[next.wave] ?? next.wave
    const picked = displayName(pulling[0] as string, byName)
    return {
      patch: { wave: 'MY', other: next.wave === 'Y2' ? 'Y2' : undefined },
      notice:
        others.length > 0 || next.view === 'related'
          ? `${picked} was asked only in the midyear survey, so the page now shows Midyear, with the same people’s ${year} answers to the other questions.`
          : `${picked} was asked only in the midyear survey, so the page now shows Midyear.`,
    }
  }
  const other = otherWaveOf(next)
  if (midyear.length === 0 && names.length > 0) {
    return {
      patch: { wave: other, other: undefined },
      notice: `No midyear question is left, so the page now shows ${WAVE_CHIPS[other]}.`,
    }
  }
  if (other === 'Y2') {
    const missing = others.filter((name) => !byName[name]?.waves_available.includes('Y2'))
    if (missing.length > 0) {
      const named = listAnd(missing.map((name) => displayName(name, byName)))
      return {
        patch: { other: undefined },
        notice: `${named} ${missing.length === 1 ? 'was' : 'were'} asked only in 2023, so the other questions now use 2023 answers.`,
      }
    }
  }
  return { patch: {} }
}
