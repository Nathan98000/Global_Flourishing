// The question picker (ADR-0019): one button that opens search, recently
// used and topic browse; unavailable questions stay in view with their
// reason; listbox semantics and a keyboard path; a multi-select mode that
// adds several at once within the table's room.

import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { VariableSummary } from '../api/types'
import {
  QuestionPicker,
  RECENT_MAX,
  readRecent,
  rememberRecent,
  wordingSnippet,
} from '../components/controls/QuestionPicker'
import { attendVariable, happyVariable, sfiVariable } from '../test-utils/fixtures'

const question = (
  name: string,
  display_name: string,
  extra: Partial<VariableSummary> = {},
): VariableSummary => ({ ...happyVariable, name, display_name, ...extra })

const today = question('WB_TODAY', 'Life evaluation today', {
  wording: 'On which step of the ladder would you say you personally feel you stand at this time?',
})
const lonely = question('LONELY', 'Not feeling lonely', {
  wording: 'How often do you feel lonely?',
  waves_available: ['Y2'],
})
const money = question('MONEY', 'Importance of money', {
  family: 'midyear',
  waves_available: ['MY'],
})
const religion = question('REL2', 'Current religion', {
  family: 'religion',
  subfamily: 'affiliation',
  scale_type: 'nominal',
  wording: 'What is your current religion?',
})
const phq2 = question('phq2_score', 'PHQ-2 depression score', {
  family: 'derived',
  is_derived: true,
  wording: null,
  label: 'Sum of the two PHQ-2 items; 0–6.',
})
const hidden = question('INCOME', 'Household income', { servable: false })

const variables = [today, happyVariable, lonely, money, religion, attendVariable, sfiVariable, phq2]

/** The picker's own rule for the tests: a question not asked at the wave,
 * or one with no order, can't be chosen. */
const reasonAtY1 = (variable: VariableSummary) =>
  !variable.waves_available.includes('Y1')
    ? 'Not asked in 2023'
    : variable.scale_type === 'nominal'
      ? 'Answers have no order'
      : undefined

beforeEach(() => {
  window.sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function openSingle(onPick = vi.fn(), value = 'WB_TODAY') {
  render(
    <QuestionPicker
      label="First question"
      variables={[...variables, hidden]}
      wave="Y1"
      value={value}
      unavailable={reasonAtY1}
      onPick={onPick}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'First question: Life evaluation today' }))
  return { onPick, dialog: screen.getByRole('dialog', { name: 'First question' }) }
}

const options = (list: HTMLElement) =>
  within(list)
    .getAllByRole('option')
    .map((option) => option.textContent)

describe('QuestionPicker', () => {
  test('closed, a button names the question and its role; open, the search has focus', () => {
    const { dialog } = openSingle()
    const trigger = screen.getByRole('button', { name: 'First question: Life evaluation today' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveTextContent(/^Life evaluation today$/)
    const search = within(dialog).getByRole('searchbox')
    expect(search).toHaveFocus()
    // Only servable questions are counted and listed.
    expect(search).toHaveAttribute('placeholder', 'Search 8 questions')
    expect(within(dialog).queryByText('Household income')).toBeNull()
  })

  test('browse: topics with their counts at this wave, the question’s own topic open, subtopics nested', () => {
    const { dialog } = openSingle()
    const topics = within(dialog).getByRole('listbox', { name: 'Topics' })
    // Wellbeing counts the questions asked in 2023: not Not feeling lonely.
    // The PHQ-2 score is listed under Mental health (topics.ts).
    expect(options(topics)).toEqual([
      'Flourishing index & its domains1',
      'Wellbeing2',
      'Mental health1',
      'Religion & spirituality2',
      // The Correlates picker's own name for the midyear topic (review L4).
      'Midyear survey0',
    ])
    const wellbeing = within(topics).getByRole('option', { name: /Wellbeing/ })
    expect(wellbeing).toHaveAttribute('aria-selected', 'true')
    const list = within(dialog).getByRole('listbox', { name: 'Wellbeing questions' })
    expect(options(list)).toEqual([
      'HappinessHow would you rate: happiness?',
      `Life evaluation today${today.wording ?? ''}`,
      'Not feeling lonelyHow often do you feel lonely?Not asked in 2023',
    ])
    // The current question reads as selected.
    expect(within(list).getByRole('option', { name: /Life evaluation today/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    // A topic with subtopics: its questions by subtopic, the subtopics nested under it.
    fireEvent.click(within(topics).getByRole('option', { name: /Religion & spirituality/ }))
    const religionList = within(dialog).getByRole('listbox', {
      name: 'Religion & spirituality questions',
    })
    expect(
      within(religionList)
        .getAllByRole('group')
        .map((group) => group.getAttribute('aria-label')),
    ).toEqual(['Religious affiliation', 'Religious practice'])
    const nested = within(topics).getByRole('option', { name: /Religious affiliation/ })
    expect(nested).toHaveAttribute('data-depth', '1')
    fireEvent.click(nested)
    expect(
      options(within(dialog).getByRole('listbox', { name: 'Religious affiliation questions' })),
    ).toEqual(['Current religionWhat is your current religion?Answers have no order'])
  })

  test('search: every match, grouped by topic, the match marked; a derived score by its description', () => {
    const { dialog } = openSingle()
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'LADDER' } })
    const results = within(dialog).getByRole('listbox', { name: 'Search results' })
    expect(within(dialog).queryByRole('listbox', { name: 'Topics' })).toBeNull()
    expect(
      within(results)
        .getAllByRole('group')
        .map((g) => g.getAttribute('aria-label')),
    ).toEqual(['Wellbeing'])
    expect(within(results).getByRole('option').querySelector('mark')?.textContent).toBe('ladder')
    expect(within(dialog).getByRole('status')).toHaveTextContent('1 question matches')
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'phq-2' } })
    const derived = within(dialog).getByRole('listbox', { name: 'Search results' })
    expect(
      within(derived)
        .getAllByRole('group')
        .map((g) => g.getAttribute('aria-label')),
    ).toEqual(['Mental health'])
    expect(within(derived).getByRole('option')).toHaveTextContent(
      'PHQ-2 depression scoreSum of the two PHQ-2 items; 0–6.',
    )
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'zzz' } })
    expect(within(dialog).getByText('No question matches')).toBeInTheDocument()
  })

  test('a long wording starts near its match, so the mark is on the one line', () => {
    const text =
      'On which step of the ladder would you say you personally feel you stand at this time?'
    expect(wordingSnippet(text, 'ladder')).toBe(text)
    expect(wordingSnippet(text, 'stand at')).toBe('…personally feel you stand at this time?')
    expect(wordingSnippet(text, '')).toBe(text)
  })

  test('keyboard: arrows move, Enter picks and closes, focus returns to the button', () => {
    const { onPick, dialog } = openSingle()
    const search = within(dialog).getByRole('searchbox')
    fireEvent.change(search, { target: { value: 'happ' } })
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    const list = within(dialog).getByRole('listbox', { name: 'Search results' })
    expect(list).toHaveFocus()
    const active = () => list.getAttribute('aria-activedescendant')
    expect(document.getElementById(active() ?? '')).toHaveTextContent(/^Happiness/)
    fireEvent.keyDown(list, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith('HAPPY')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: /First question/ })).toHaveFocus()
  })

  test('keyboard: the topics move with the arrows, and the right arrow enters the list', () => {
    const { onPick, dialog } = openSingle()
    const topics = within(dialog).getByRole('listbox', { name: 'Topics' })
    topics.focus()
    fireEvent.keyDown(topics, { key: 'ArrowDown' })
    expect(within(topics).getByRole('option', { name: /Mental health/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    fireEvent.keyDown(topics, { key: 'ArrowRight' })
    const list = within(dialog).getByRole('listbox', { name: 'Mental health questions' })
    expect(list).toHaveFocus()
    fireEvent.keyDown(list, { key: 'End' })
    fireEvent.keyDown(list, { key: ' ' })
    expect(onPick).toHaveBeenCalledWith('phq2_score')
  })

  test('Escape closes without a pick; Enter in the search takes the first question that can be chosen', () => {
    const { onPick, dialog } = openSingle()
    fireEvent.keyDown(within(dialog).getByRole('searchbox'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onPick).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /First question/ }))
    const search = screen.getByRole('searchbox')
    // "lonel" matches only Not feeling lonely, which wasn't asked in 2023.
    fireEvent.change(search, { target: { value: 'lonel' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onPick).not.toHaveBeenCalled()
    fireEvent.change(search, { target: { value: 'evaluation' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith('WB_TODAY')
  })

  test('unavailable questions stay in view, disabled, with the reason; a press does nothing', () => {
    const { onPick, dialog } = openSingle()
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'o' } })
    const results = within(dialog).getByRole('listbox', { name: 'Search results' })
    const lonelyOption = within(results).getByRole('option', { name: /Not feeling lonely/ })
    expect(lonelyOption).toHaveAttribute('aria-disabled', 'true')
    expect(lonelyOption).toHaveTextContent('Not asked in 2023')
    const religionOption = within(results).getByRole('option', { name: /Current religion/ })
    expect(religionOption).toHaveTextContent('Answers have no order')
    fireEvent.click(lonelyOption)
    expect(onPick).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  test('recently used: the last picks, newest first, in this tab only — and no storage is no list', () => {
    rememberRecent(['HAPPY'])
    rememberRecent(['sfi'])
    const { onPick, dialog } = openSingle()
    const recent = within(dialog).getByRole('listbox', { name: 'Recently used' })
    expect(options(recent)).toEqual(['Secure Flourishing Index', 'Happiness'])
    fireEvent.keyDown(recent, { key: 'ArrowRight' })
    fireEvent.keyDown(recent, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith('HAPPY')
    expect(readRecent()).toEqual(['HAPPY', 'sfi'])
    for (let i = 0; i < 8; i += 1) rememberRecent([`Q${i}`])
    expect(readRecent()).toHaveLength(RECENT_MAX)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readRecent()).toEqual([])
    expect(() => rememberRecent(['HAPPY'])).not.toThrow()
  })
})

describe('QuestionPicker, several at once', () => {
  function openMultiple(selected: string[], max = 4) {
    const onAdd = vi.fn()
    render(
      <QuestionPicker
        multiple
        label="Add questions"
        trigger="Add questions"
        variables={variables}
        wave="Y1"
        selected={selected}
        max={max}
        unavailable={reasonAtY1}
        onAdd={onAdd}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add questions' }))
    return { onAdd, dialog: screen.getByRole('dialog', { name: 'Add questions' }) }
  }

  test('questions in the table read as ticked and disabled; the footer counts the room', () => {
    const { onAdd, dialog } = openMultiple(['sfi', 'WB_TODAY'])
    const list = within(dialog).getByRole('listbox', { name: 'Wellbeing questions' })
    expect(list).toHaveAttribute('aria-multiselectable', 'true')
    const inTable = within(list).getByRole('option', { name: /Life evaluation today/ })
    expect(inTable).toHaveAttribute('aria-selected', 'true')
    expect(inTable).toHaveAttribute('aria-disabled', 'true')
    expect(inTable).toHaveTextContent('In the table')
    expect(within(dialog).getByText('0 selected · room for 2 more')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Add 0 to the table' })).toBeDisabled()
    fireEvent.click(within(list).getByRole('option', { name: /^Happiness/ }))
    expect(within(dialog).getByText('1 selected · room for 1 more')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(onAdd).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('the limit: with no room left the rest are disabled; a tick can be undone; Add adds them all', () => {
    const { onAdd, dialog } = openMultiple(['sfi', 'WB_TODAY'])
    const list = within(dialog).getByRole('listbox', { name: 'Wellbeing questions' })
    fireEvent.click(within(list).getByRole('option', { name: /^Happiness/ }))
    fireEvent.click(within(dialog).getByRole('option', { name: /Mental health/ }))
    const mental = within(dialog).getByRole('listbox', { name: 'Mental health questions' })
    fireEvent.click(within(mental).getByRole('option', { name: /PHQ-2/ }))
    expect(within(dialog).getByText('2 selected · room for 0 more')).toBeInTheDocument()
    // Full: an unticked question can't be ticked (no words — the footer says why).
    fireEvent.click(within(dialog).getByRole('option', { name: /Religion & spirituality/ }))
    const practice = within(dialog).getByRole('option', { name: /Service attendance/ })
    expect(practice).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(practice)
    expect(within(dialog).getByText('2 selected · room for 0 more')).toBeInTheDocument()
    // Untick one, tick the other.
    fireEvent.click(within(dialog).getByRole('option', { name: /Mental health/ }))
    fireEvent.click(within(dialog).getByRole('option', { name: /PHQ-2/ }))
    fireEvent.click(within(dialog).getByRole('option', { name: /Religion & spirituality/ }))
    fireEvent.click(within(dialog).getByRole('option', { name: /Service attendance/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add 2 to the table' }))
    expect(onAdd).toHaveBeenCalledWith(['HAPPY', 'ATTEND_SVCS'])
    expect(readRecent()).toEqual(['ATTEND_SVCS', 'HAPPY'])
  })

  test('the keyboard ticks with Space, and the unavailable stay unticked', () => {
    const { onAdd, dialog } = openMultiple(['WB_TODAY'])
    const search = within(dialog).getByRole('searchbox')
    fireEvent.change(search, { target: { value: 'r' } })
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    const list = within(dialog).getByRole('listbox', { name: 'Search results' })
    // Walk the results: tick what can be ticked.
    const ticked: string[] = []
    for (let i = 0; i < 6; i += 1) {
      fireEvent.keyDown(list, { key: ' ' })
      fireEvent.keyDown(list, { key: 'ArrowDown' })
    }
    for (const option of within(list).getAllByRole('option')) {
      if (
        option.getAttribute('aria-selected') === 'true' &&
        !/In the table/.test(option.textContent ?? '')
      )
        ticked.push(option.textContent ?? '')
    }
    expect(ticked.some((text) => text.startsWith('Current religion'))).toBe(false)
    fireEvent.click(within(dialog).getByRole('button', { name: /^Add \d to the table$/ }))
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd.mock.calls[0]?.[0]).not.toContain('REL2')
  })
})
