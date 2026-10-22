// The question picker's search finds a word's other forms (G18):
// "satisfied" finds "Life satisfaction" too.

import { expect, test } from 'vitest'
import type { VariableSummary } from '../api/types'
import { findNeedle, searchMeasures, stemOf } from '../components/controls/QuestionPicker'

test('a common ending trimmed, never below four letters', () => {
  expect(stemOf('satisfied')).toBe('satisf')
  expect(stemOf('happy')).toBe('happ')
  expect(stemOf('lonely')).toBe('lone')
  expect(stemOf('meaning')).toBe('mean')
  expect(stemOf('ages')).toBe('ages')
})

test('a search matches the words as typed, else their stem — and marks what it matched', () => {
  const variable = (name: string, display: string, wording: string) =>
    ({ name, display_name: display, wording, label: null, servable: true }) as VariableSummary
  const list = [
    variable('LIFE_SAT', 'Life satisfaction', 'Overall, how satisfied are you with life?'),
    variable('HAPPY', 'Happiness', 'In general, how happy or unhappy do you usually feel?'),
    variable('CITY_SAT', 'Satisfied with where you live', 'Are you satisfied with your city?'),
  ]
  expect(searchMeasures(list, 'satisfied').map((entry) => entry.name)).toEqual([
    'LIFE_SAT',
    'CITY_SAT',
  ])
  expect(findNeedle('Life satisfaction', 'satisfied')).toEqual({ at: 5, length: 6 })
  expect(findNeedle('Satisfied with where you live', 'satisfied')).toEqual({ at: 0, length: 9 })
  expect(findNeedle('Happiness', 'xyz').at).toBe(-1)
})
