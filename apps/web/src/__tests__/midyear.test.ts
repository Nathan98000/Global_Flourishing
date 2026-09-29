// The midyear rules on the Correlates page (ADR-0020): which answers a
// question reads, which waves are open, and — when a choice would leave
// the page where it can't stay — the change made and the sentence that
// says so. Pure functions over the catalog's summaries; no fetch.

import { describe, expect, test } from 'vitest'
import type { VariableSummary } from '../api/types'
import { parseCorrelatesSearch, type CorrelatesSearch } from '../state/search'
import { attendVariable, happyVariable } from '../test-utils/fixtures'
import {
  MIDYEAR_QUESTION,
  answerWaveOf,
  chooseWave,
  isMidyear,
  no2024Note,
  otherNote,
  otherOpen,
  questionsInView,
  reconcile,
  requestOther,
  showsOther,
  waveName,
  waveOpen,
  waveTitle,
  yearTagged,
} from '../views/correlates/midyear'

const question = (
  name: string,
  display_name: string,
  waves_available: string[],
  base: VariableSummary = happyVariable,
): VariableSummary => ({ ...base, name, display_name, waves_available })

const byName: Record<string, VariableSummary> = Object.fromEntries(
  [
    question('WB_TODAY', 'Life evaluation today', ['Y1', 'Y2']),
    question('INCOME_FEELINGS', 'Feelings about household income', ['Y1', 'Y2'], attendVariable),
    question('HAPPY', 'Happiness', ['Y1', 'Y2']),
    question('CHILD_MEM', 'Childhood memory', ['Y1'], attendVariable),
    question(MIDYEAR_QUESTION, 'Daily social media time', ['MY'], attendVariable),
    question('DILIGENT', 'Diligence', ['MY']),
    // Asked in all three (no real item is; the synthetic data's is).
    question('BALANCE', 'Life balance', ['Y1', 'MY', 'Y2']),
  ].map((variable) => [variable.name, variable]),
)

const at = (raw: Record<string, unknown>): CorrelatesSearch => parseCorrelatesSearch(raw)
const settle = (search: CorrelatesSearch, patch: Partial<CorrelatesSearch>) => ({
  ...search,
  ...patch,
})

describe('which answers, which waves', () => {
  test('a midyear question reads its midyear answers; any other the other answers’ wave', () => {
    expect(isMidyear(byName[MIDYEAR_QUESTION])).toBe(true)
    expect(isMidyear(byName['WB_TODAY'])).toBe(false)
    const midyear = at({ wave: 'MY', a: MIDYEAR_QUESTION })
    expect(answerWaveOf(byName[MIDYEAR_QUESTION], midyear)).toBe('MY')
    expect(answerWaveOf(byName['WB_TODAY'], midyear)).toBe('Y1')
    expect(answerWaveOf(byName['WB_TODAY'], { ...midyear, other: 'Y2' })).toBe('Y2')
    expect(answerWaveOf(byName['WB_TODAY'], at({ wave: 'Y2' }))).toBe('Y2')
  })

  test('Midyear is never closed; 2023 or 2024 only for another wave’s questions not asked then', () => {
    const pair = at({ a: 'HAPPY', b: 'CHILD_MEM' })
    expect(waveOpen(pair, byName, 'MY')).toBe(true)
    expect(waveOpen(pair, byName, 'Y1')).toBe(true)
    expect(waveOpen(pair, byName, 'Y2')).toBe(false)
    // A midyear question in view never closes a year: it gives way.
    const midyear = at({ wave: 'MY', a: MIDYEAR_QUESTION, b: 'WB_TODAY' })
    expect(waveOpen(midyear, byName, 'Y2')).toBe(true)
    // A table: two of its other questions asked then, or none to keep
    // (it then starts again from its defaults).
    const kept = at({ view: 'matrix', wave: 'MY', vars: `${MIDYEAR_QUESTION},HAPPY,WB_TODAY` })
    expect(waveOpen(kept, byName, 'Y2')).toBe(true)
    const one = at({ view: 'matrix', wave: 'MY', vars: `${MIDYEAR_QUESTION},HAPPY,CHILD_MEM` })
    expect(waveOpen(one, byName, 'Y2')).toBe(false)
    const three = at({ view: 'matrix', vars: 'HAPPY,CHILD_MEM,WB_TODAY' })
    expect(waveOpen(three, byName, 'Y2')).toBe(true)
    const thin = at({ view: 'matrix', wave: 'MY', vars: 'HAPPY,DILIGENT' })
    expect(waveOpen(thin, byName, 'Y2')).toBe(true)
    const closed = at({ view: 'matrix', vars: 'HAPPY,CHILD_MEM' })
    expect(waveOpen(closed, byName, 'Y2')).toBe(false)
  })

  test('the other answers: shown with another wave’s question in view, 2024 closed when not asked', () => {
    const pair = at({ wave: 'MY', a: MIDYEAR_QUESTION, b: 'CHILD_MEM' })
    expect(showsOther(pair, byName)).toBe(true)
    expect(otherOpen(pair, byName, 'Y1')).toBe(true)
    expect(otherOpen(pair, byName, 'Y2')).toBe(false)
    expect(no2024Note(pair, byName)).toBe(
      "2024 isn't available: Childhood memory wasn't asked in Wave 2.",
    )
    expect(showsOther(at({ wave: 'MY', a: MIDYEAR_QUESTION, b: 'DILIGENT' }), byName)).toBe(false)
    expect(showsOther(at({ view: 'related', wave: 'MY', outcome: 'DILIGENT' }), byName)).toBe(true)
    expect(showsOther(at({ a: 'HAPPY' }), byName)).toBe(false)
    // Requests name it at Midyear only when another wave's question is in them.
    expect(requestOther(pair, [MIDYEAR_QUESTION, 'CHILD_MEM'], byName)).toBe('Y1')
    expect(requestOther(pair, [MIDYEAR_QUESTION, 'DILIGENT'], byName)).toBeUndefined()
    expect(requestOther(at({ view: 'related', wave: 'MY', other: 'Y2' }), [], byName)).toBe('Y2')
    expect(requestOther(at({ a: 'HAPPY' }), ['HAPPY', 'WB_TODAY'], byName)).toBeUndefined()
  })

  test('the words: subtitles, download names, year tags and the row note', () => {
    expect(waveTitle('MY', 'Y2')).toBe('Midyear survey, with 2024 answers from the same people')
    expect(waveTitle('MY', undefined)).toBe('Midyear survey, Nov 2023–Dec 2024')
    expect(waveTitle('Y1', undefined)).toBe('Wave 1, 2023')
    expect(waveName('MY', 'Y1')).toBe('Midyear with 2023')
    expect(waveName('Y2', undefined)).toBe('2024')
    expect(yearTagged('Life evaluation today', byName['WB_TODAY'], 'MY', 'Y1')).toBe(
      'Life evaluation today (2023)',
    )
    expect(yearTagged('Daily social media time', byName[MIDYEAR_QUESTION], 'MY', 'Y1')).toBe(
      'Daily social media time',
    )
    expect(yearTagged('Happiness', byName['HAPPY'], 'Y1', undefined)).toBe('Happiness')
    expect(otherNote('Y1')).toBe(
      'The other questions use the same people’s 2023 answers, usually given 8–12 months earlier.',
    )
    expect(otherNote('Y2')).toBe(
      'The other questions use the same people’s 2024 answers: from the same interview for two in three people, about six months later for the rest.',
    )
  })
})

describe('choosing a wave', () => {
  test('Midyear with no midyear question in view: Compare two takes Daily social media time for A', () => {
    const search = at({})
    const { patch, notice } = chooseWave(search, 'MY', byName)
    expect(patch).toMatchObject({ wave: 'MY', a: MIDYEAR_QUESTION, b: 'INCOME_FEELINGS' })
    expect(patch.other).toBeUndefined()
    expect(notice).toBe(
      'Daily social media time, from the midyear survey, took the place of Life evaluation today.',
    )
    // From 2024 the other answers stay 2024.
    expect(chooseWave(at({ wave: 'Y2' }), 'MY', byName).patch).toMatchObject({ other: 'Y2' })
    // A midyear question already in view: the wave alone.
    expect(chooseWave(at({ a: 'DILIGENT' }), 'MY', byName)).toEqual({
      patch: { wave: 'MY', other: undefined },
    })
  })

  test('Find related takes it as its question; Compare several adds it first, ten at most', () => {
    expect(chooseWave(at({ view: 'related', outcome: 'HAPPY' }), 'MY', byName)).toEqual({
      patch: { wave: 'MY', other: undefined, outcome: MIDYEAR_QUESTION, a: undefined },
      notice: 'Daily social media time, from the midyear survey, took the place of Happiness.',
    })
    const four = at({ view: 'matrix', vars: 'HAPPY,WB_TODAY,INCOME_FEELINGS,CHILD_MEM' })
    expect(chooseWave(four, 'MY', byName).patch.vars).toEqual([
      MIDYEAR_QUESTION,
      'HAPPY',
      'WB_TODAY',
      'INCOME_FEELINGS',
      'CHILD_MEM',
    ])
    const names = [
      'HAPPY',
      'WB_TODAY',
      'INCOME_FEELINGS',
      'CHILD_MEM',
      'A1',
      'A2',
      'A3',
      'A4',
      'A5',
    ]
    const ten = at({ view: 'matrix', vars: [...names, 'LAST'].join(',') })
    const full = chooseWave(ten, 'MY', { ...byName, LAST: question('LAST', 'Last one', ['Y1']) })
    expect(full.patch.vars).toEqual([MIDYEAR_QUESTION, ...names])
    expect(full.notice).toBe(
      'Daily social media time, from the midyear survey, joined the table, and Last one left it: it holds ten at most.',
    )
    // The default table (not yet named) is the one the view reports.
    const unnamed = at({ view: 'matrix' })
    expect(questionsInView(unnamed, ['HAPPY', 'CHILD_MEM']).names).toEqual(['HAPPY', 'CHILD_MEM'])
    expect(chooseWave(unnamed, 'MY', byName, ['HAPPY', 'CHILD_MEM']).patch.vars).toEqual([
      MIDYEAR_QUESTION,
      'HAPPY',
      'CHILD_MEM',
    ])
  })

  test('2023 or 2024 at Midyear: the midyear questions in view give way to the defaults', () => {
    const midyear = at({ wave: 'MY', a: MIDYEAR_QUESTION })
    const back = chooseWave(midyear, 'Y1', byName)
    expect(back.patch).toMatchObject({ wave: 'Y1', a: 'WB_TODAY', b: 'INCOME_FEELINGS' })
    expect(back.notice).toBe(
      'Daily social media time was asked only in the midyear survey, so Life evaluation today took its place.',
    )
    // B midyear: its default, the default pair's second.
    const second = chooseWave(at({ wave: 'MY', a: 'HAPPY', b: 'DILIGENT' }), 'Y2', byName)
    expect(second.patch).toEqual({ wave: 'Y2', other: undefined, b: undefined })
    expect(second.notice).toBe(
      'Diligence was asked only in the midyear survey, so Feelings about household income took its place.',
    )
    const both = chooseWave(at({ wave: 'MY', a: MIDYEAR_QUESTION, b: 'DILIGENT' }), 'Y1', byName)
    expect(both.patch).toMatchObject({ a: undefined, b: undefined })
    expect(both.notice).toBe(
      'Daily social media time and Diligence were asked only in the midyear survey, so Life evaluation today and Feelings about household income took their places.',
    )
    expect(
      chooseWave(at({ view: 'related', wave: 'MY', outcome: 'DILIGENT' }), 'Y1', byName).patch,
    ).toEqual({ wave: 'Y1', other: undefined, outcome: undefined, a: undefined })
    const table = at({ view: 'matrix', wave: 'MY', vars: `${MIDYEAR_QUESTION},HAPPY,WB_TODAY` })
    expect(chooseWave(table, 'Y1', byName)).toEqual({
      patch: { wave: 'Y1', other: undefined, vars: ['HAPPY', 'WB_TODAY'] },
      notice: 'Daily social media time was asked only in the midyear survey, so it left the table.',
    })
    const thin = at({ view: 'matrix', wave: 'MY', vars: `${MIDYEAR_QUESTION},DILIGENT,HAPPY` })
    expect(chooseWave(thin, 'Y2', byName).patch).toEqual({
      wave: 'Y2',
      other: undefined,
      vars: undefined,
    })
  })
})

describe('the wave follows the question', () => {
  test('a midyear question picked at 2023 or 2024 switches to Midyear, that year the other answers', () => {
    const picked = settle(at({ wave: 'Y2', b: 'HAPPY' }), { a: MIDYEAR_QUESTION })
    expect(reconcile(picked, byName)).toEqual({
      patch: { wave: 'MY', other: 'Y2' },
      notice:
        'Daily social media time was asked only in the midyear survey, so the page now shows Midyear, with the same people’s 2024 answers to the other questions.',
    })
    const both = settle(at({ b: 'DILIGENT' }), { a: MIDYEAR_QUESTION })
    expect(reconcile(both, byName).notice).toBe(
      'Daily social media time was asked only in the midyear survey, so the page now shows Midyear.',
    )
    expect(reconcile(at({ a: 'HAPPY' }), byName)).toEqual({ patch: {} })
  })

  test('at Midyear with no midyear question left, the wave becomes the other answers’ wave', () => {
    const left = settle(at({ wave: 'MY', other: 'Y2', a: MIDYEAR_QUESTION }), { a: 'HAPPY' })
    expect(reconcile(left, byName)).toEqual({
      patch: { wave: 'Y2', other: undefined },
      notice: 'No midyear question is left, so the page now shows 2024.',
    })
  })

  test('at Midyear with 2024, a question asked only in 2023 switches the other answers to 2023', () => {
    const picked = settle(at({ wave: 'MY', other: 'Y2', a: MIDYEAR_QUESTION }), {
      b: 'CHILD_MEM',
    })
    expect(reconcile(picked, byName)).toEqual({
      patch: { other: undefined },
      notice:
        'Childhood memory was asked only in 2023, so the other questions now use 2023 answers.',
    })
    expect(reconcile(at({ wave: 'MY', other: 'Y2', a: MIDYEAR_QUESTION }), byName)).toEqual({
      patch: {},
    })
  })
})

describe('a question asked in the midyear survey and in other waves', () => {
  test('stays where it is at 2023 or 2024, and reads its midyear answers at Midyear', () => {
    // At 2023 it pulls nothing to Midyear, and wears no Midyear tag there.
    expect(reconcile(at({ a: 'BALANCE' }), byName)).toEqual({ patch: {} })
    // At Midyear it is a midyear question: nothing is brought in for it.
    expect(chooseWave(at({ a: 'BALANCE' }), 'MY', byName)).toEqual({
      patch: { wave: 'MY', other: undefined },
    })
    expect(answerWaveOf(byName['BALANCE'], at({ wave: 'MY' }))).toBe('MY')
    // Back at 2023 it stays: only what that wave didn't ask gives way.
    const pair = at({ wave: 'MY', a: 'BALANCE', b: MIDYEAR_QUESTION })
    expect(chooseWave(pair, 'Y1', byName).patch).toEqual({
      wave: 'Y1',
      other: undefined,
      b: undefined,
    })
  })
})
