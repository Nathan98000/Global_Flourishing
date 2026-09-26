// The picker's subtopic step (ADR-0016): a topic whose measures carry the
// server's `subfamily` gets a Subtopic select between Topic and Measure;
// it defaults to the current measure's subtopic and narrows the Measure
// list to it. Topics without subfamilies look unchanged, and the search
// box still searches everything. Membership is the server's; only the
// subtopic display names are the client's (topics.ts).

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { VariableSummary } from '../api/types'
import { OutcomePicker } from '../components/controls/OutcomePicker'
import { happyVariable } from '../test-utils/fixtures'
import { subtopicsOf } from '../topics'

const religion = (
  name: string,
  display_name: string,
  subfamily: string | null,
  extra: Partial<VariableSummary> = {},
): VariableSummary => ({
  ...happyVariable,
  name,
  display_name,
  family: 'religion',
  subfamily,
  scale_type: 'nominal',
  direction: 'none',
  default_stat: 'proportion',
  ...extra,
})

const variables: VariableSummary[] = [
  happyVariable,
  religion('REL2', 'Current religion', 'affiliation'),
  religion('REL1', 'Religion at age 12', 'affiliation'),
  religion('ATTEND_SVCS', 'Religious service attendance', 'practice'),
  religion('BELIEVE_GOD', 'Belief in God', 'beliefs', { wording: 'Do you believe in God?' }),
]

const optionsOf = (select: HTMLElement) =>
  [...(select as HTMLSelectElement).options].filter((o) => !o.disabled).map((o) => o.textContent)

describe('subtopicsOf', () => {
  test('groups a topic by subfamily in owner order; a topic without any yields nothing', () => {
    const groups = subtopicsOf(variables.filter((v) => v.family === 'religion'))
    expect(groups.map((g) => [g.code, g.name, g.measures.map((m) => m.name)])).toEqual([
      ['affiliation', 'Religious affiliation', ['REL2', 'REL1']],
      ['beliefs', 'Beliefs & experiences', ['BELIEVE_GOD']],
      ['practice', 'Religious practice', ['ATTEND_SVCS']],
    ])
    expect(subtopicsOf([happyVariable])).toEqual([])
    // An unknown code still gets a readable name and sorts after the known ones.
    const odd = subtopicsOf([religion('X', 'X', 'new_group'), religion('Y', 'Y', 'beliefs')])
    expect(odd.map((g) => g.name)).toEqual(['Beliefs & experiences', 'New group'])
  })
})

describe('OutcomePicker subtopics', () => {
  test('a topic with subtopics shows a Subtopic select between Topic and Measure, set to the measure’s own', () => {
    render(<OutcomePicker variables={variables} value="ATTEND_SVCS" onSelect={() => undefined} />)
    const labels = screen.getAllByText(/^(Topic|Subtopic|Measure)$/).map((el) => el.textContent)
    expect(labels).toEqual(['Topic', 'Subtopic', 'Measure'])
    const subtopic = screen.getByLabelText('Subtopic')
    expect(subtopic).toHaveValue('practice')
    expect(optionsOf(subtopic)).toEqual([
      'Religious affiliation (2)',
      'Beliefs & experiences (1)',
      'Religious practice (1)',
    ])
    // The Measure list holds only that subtopic's members.
    expect(optionsOf(screen.getByLabelText('Measure'))).toEqual(['Religious service attendance'])
    expect(screen.getByLabelText('Measure')).toHaveValue('ATTEND_SVCS')
  })

  test('changing the subtopic narrows the Measure list; picking a measure reports it', () => {
    const onSelect = vi.fn()
    render(<OutcomePicker variables={variables} value="ATTEND_SVCS" onSelect={onSelect} />)
    fireEvent.change(screen.getByLabelText('Subtopic'), { target: { value: 'affiliation' } })
    const measure = screen.getByLabelText('Measure')
    expect(optionsOf(measure)).toEqual(['Current religion', 'Religion at age 12'])
    // No measure of that subtopic is chosen yet.
    expect(measure).toHaveValue('')
    fireEvent.change(measure, { target: { value: 'REL2' } })
    expect(onSelect).toHaveBeenCalledWith({ outcome: 'REL2' })
  })

  test('a topic mid-selection defaults to its first subtopic', () => {
    render(
      <OutcomePicker
        variables={variables}
        value="HAPPY"
        topic="religion"
        onSelect={() => undefined}
      />,
    )
    expect(screen.getByLabelText('Subtopic')).toHaveValue('affiliation')
    expect(optionsOf(screen.getByLabelText('Measure'))).toEqual([
      'Current religion',
      'Religion at age 12',
    ])
  })

  test('changing the topic picks its first listed measure — first subtopic first, page filter respected (25 Sept)', () => {
    const onSelect = vi.fn()
    render(<OutcomePicker variables={variables} value="HAPPY" onSelect={onSelect} />)
    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'religion' } })
    // Religion's first subtopic is affiliation; its first measure A–Z is REL2.
    expect(onSelect).toHaveBeenCalledWith({ outcome: 'REL2' })
    // A page that lists fewer measures (Change's two-wave items) gets the
    // first of what it lists.
    const filtered = variables.filter((v) => v.name !== 'REL2')
    const onSelectFiltered = vi.fn()
    render(<OutcomePicker variables={filtered} value="HAPPY" onSelect={onSelectFiltered} />)
    fireEvent.change(screen.getAllByLabelText('Topic')[1] as HTMLElement, {
      target: { value: 'religion' },
    })
    expect(onSelectFiltered).toHaveBeenCalledWith({ outcome: 'REL1' })
    // A topic without subtopics: its first measure.
    const onSelectBack = vi.fn()
    render(<OutcomePicker variables={variables} value="ATTEND_SVCS" onSelect={onSelectBack} />)
    fireEvent.change(screen.getAllByLabelText('Topic')[2] as HTMLElement, {
      target: { value: 'wellbeing' },
    })
    expect(onSelectBack).toHaveBeenCalledWith({ outcome: 'HAPPY' })
  })

  test('a topic without subfamilies looks unchanged', () => {
    render(<OutcomePicker variables={variables} value="HAPPY" onSelect={() => undefined} />)
    expect(screen.queryByLabelText('Subtopic')).toBeNull()
    expect(optionsOf(screen.getByLabelText('Measure'))).toEqual(['Happiness'])
  })

  test('the search box still searches every measure, whatever the subtopic', () => {
    const onSelect = vi.fn()
    render(<OutcomePicker variables={variables} value="ATTEND_SVCS" onSelect={onSelect} />)
    fireEvent.change(screen.getByLabelText('Or search'), { target: { value: 'god' } })
    fireEvent.click(screen.getByRole('button', { name: 'Belief in God' }))
    expect(onSelect).toHaveBeenCalledWith({ outcome: 'BELIEVE_GOD' })
  })

  test('on the phone the Subtopic rides with the Measure, not the Topic', () => {
    render(
      <OutcomePicker
        variables={variables}
        value="ATTEND_SVCS"
        onSelect={() => undefined}
        fields="measure"
      />,
    )
    expect(screen.getByLabelText('Subtopic')).toBeInTheDocument()
    expect(screen.queryByLabelText('Topic')).toBeNull()
  })
})
