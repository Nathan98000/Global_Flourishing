// The Codebook for a lay reader (G7): answers and counts in words; the
// list by name.

import { describe, expect, test } from 'vitest'
import type { ValueLabel, VariableSummary } from '../api/types'
import { answeredInWords, answersInWords } from '../views/CodebookDetailView'
import { filterVariables } from '../views/CodebookView'

const label = (code: number, text: string, extra: Partial<ValueLabel> = {}): ValueLabel => ({
  code,
  label: text,
  wave: null,
  country_code: null,
  is_nonresponse: false,
  ...extra,
})

describe('answersInWords', () => {
  test('a scale by its two ends; its non-answers left to the fold', () => {
    const labels = [
      label(-98, '(Saw, skipped)', { is_nonresponse: true }),
      label(0, 'Not at all satisfied with your life'),
      label(10, 'Completely satisfied with your life'),
      label(98, '(DK)', { is_nonresponse: true }),
    ]
    expect(answersInWords({ min: 0, max: 10 }, labels)).toEqual({
      kind: 'range',
      text: 'From 0 (Not at all satisfied with your life) to 10 (Completely satisfied with your life).',
    })
    // A score's component has no range of its own: two end labels make it one.
    expect(answersInWords({ min: null, max: null }, labels)?.kind).toBe('range')
  })

  test('every answer of a list, in code order; a country’s own labels left to the fold', () => {
    const labels = [
      label(2, 'Once a week'),
      label(1, 'More than once a week'),
      label(3, 'Never'),
      label(9995, 'Local religion', { country_code: 4 }),
    ]
    expect(answersInWords({ min: 1, max: 3 }, labels)).toEqual({
      kind: 'list',
      answers: ['More than once a week', 'Once a week', 'Never'],
    })
  })
})

test('answeredInWords: how many answered, year by year', () => {
  const row = (wave: string, nValid: number) => ({
    country_code: 1,
    wave,
    n_present: nValid,
    n_valid: nValid,
    n_dk: 0,
    n_refused: 0,
    n_skipped: 0,
  })
  expect(answeredInWords([row('Y1', 1000), row('Y1', 206), row('Y2', 500)])).toBe(
    'Answered by 1,206 people in 2023 and 500 in 2024.',
  )
  expect(answeredInWords([])).toBeNull()
})

test('the Codebook lists questions by name', () => {
  const variable = (name: string, display: string) =>
    ({ name, display_name: display, family: 'x', waves_available: ['Y1'] }) as VariableSummary
  const list = [
    variable('ABUSED', 'Abused when growing up'),
    variable('ACHIEVING', 'Happy with what you’re achieving'),
    variable('AGE', 'Age'),
  ]
  expect(filterVariables(list, { q: '' } as never).map((entry) => entry.display_name)).toEqual([
    'Abused when growing up',
    'Age',
    'Happy with what you’re achieving',
  ])
})
