// The shared primitives: suppression rendered in place, errors rendered
// distinctly, coverage summarized honestly.

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { ApiError, NetworkError } from '../api/errors'
import { CountryFilter, countryTriggerText } from '../components/controls/CountryFilter'
import { RadioRow, SELECT_ABOVE } from '../components/controls/RadioRow'
import { ErrorState } from '../components/ErrorState'
import { EstimateTable } from '../components/EstimateTable'
import { Stat } from '../components/Stat'
import { attendVariable, testMeta, testResponse, testRow } from '../test-utils/fixtures'

describe('Stat', () => {
  test('an estimate never appears without CI and n — and never with a weight code', () => {
    render(<Stat row={testRow()} />)
    expect(screen.getByText('7.21')).toBeInTheDocument()
    expect(screen.getByText(/\[7\.10, 7\.32\]/)).toBeInTheDocument()
    expect(screen.getByText('n = 1,204')).toBeInTheDocument()
    expect(screen.queryByText(/w_c1/)).toBeNull()
  })

  test('a small cell appears with its n and no flag (ADR-0011)', () => {
    render(<Stat row={testRow({ n: 12 })} />)
    expect(screen.getByText('7.21')).toBeInTheDocument()
    expect(screen.getByText(/n = 12/)).toBeInTheDocument()
    expect(screen.queryByText(/withheld|small cell/)).toBeNull()
  })
})

describe('ErrorState', () => {
  test('renders the 422 message list verbatim', () => {
    const details = ['HAPPY is not asked at MY; it is available at Y1, Y2', 'stat must be one of …']
    render(<ErrorState error={new ApiError('validation', 422, details)} />)
    expect(screen.getByRole('alert')).toHaveTextContent('The API rejected this query')
    for (const message of details) expect(screen.getByText(message)).toBeInTheDocument()
  })

  test('503, 429 and network failure are three different messages', () => {
    const { rerender } = render(<ErrorState error={new ApiError('no-data', 503, [])} />)
    expect(screen.getByRole('alert')).toHaveTextContent('no data build')
    rerender(<ErrorState error={new ApiError('rate-limit', 429, [], 30)} />)
    expect(screen.getByRole('alert')).toHaveTextContent('about 30s')
    rerender(<ErrorState error={new NetworkError(new TypeError('x'))} />)
    // Plain words, not engineer words (F6).
    expect(screen.getByRole('alert')).toHaveTextContent('Live data service is offline')
    expect(screen.getByRole('alert')).toHaveTextContent('standard views still work')
  })

  test('with /health fine, a failed request is the service’s error, not an outage', () => {
    const { rerender } = render(
      <ErrorState error={new NetworkError(new TypeError('x'))} apiReachable />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load this view — the data service returned an error.",
    )
    expect(screen.getByRole('alert')).not.toHaveTextContent('offline')
    rerender(<ErrorState error={new ApiError('http', 500, ['Internal server error: X'])} />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load this view — the data service returned an error.",
    )
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 500: Internal server error: X')
  })
})

describe('EstimateTable', () => {
  test('labels come from meta; a small cell keeps its estimate and n', () => {
    const response = testResponse(
      [
        testRow({ group: { country_code: 22 } }),
        // A 31-person cell with no computable interval (lone PSU): shown,
        // with its n, the interval as an em dash — never a gap (ADR-0011).
        testRow({
          group: { country_code: 1 },
          estimate: 6.4,
          se: null,
          ci_lo: null,
          ci_hi: null,
          n: 31,
        }),
      ],
      { by: ['country_code'] },
    )
    render(<EstimateTable response={response} meta={testMeta} />)
    expect(screen.getByRole('columnheader', { name: 'Country' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '95% CI' })).toBeInTheDocument()
    expect(screen.getByText('United States')).toBeInTheDocument()
    expect(screen.getByText('Testland')).toBeInTheDocument()
    expect(screen.getByText('6.40')).toBeInTheDocument()
    expect(screen.getByText('31')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument() // the missing interval
    expect(screen.queryByText(/withheld/)).toBeNull()
    // The weight is a caption, not a column (§6).
    expect(screen.queryByRole('columnheader', { name: 'Weight' })).toBeNull()
    expect(screen.getByText(/Weighted estimates \(w_c1\)/)).toBeInTheDocument()
  })

  test('breakdown levels use the served labels', () => {
    const response = testResponse([testRow({ group: { country_code: 1, gender: 2 } })], {
      by: ['country_code', 'gender'],
    })
    render(<EstimateTable response={response} meta={testMeta} />)
    expect(screen.getByRole('columnheader', { name: 'Gender' })).toBeInTheDocument()
    expect(screen.getByText('Female')).toBeInTheDocument()
  })

  test('level sub-rows appear for distributions', () => {
    const response = testResponse(
      [
        testRow({ group: { country_code: 1 }, level: 0, stat: 'distribution', estimate: 0.05 }),
        testRow({ group: { country_code: 1 }, level: 1, stat: 'distribution', estimate: 0.07 }),
      ],
      { stat: 'distribution', outcome: attendVariable.name },
    )
    render(<EstimateTable response={response} meta={testMeta} />)
    expect(screen.getByRole('columnheader', { name: 'Answer' })).toBeInTheDocument()
    expect(screen.getByText('5.0%')).toBeInTheDocument()
  })
})

describe('EstimateTable answers', () => {
  test('the Answer column wears the value labels; a blank or missing label falls back to the code (ADR-0016)', () => {
    const response = testResponse([
      testRow({ stat: 'proportion', level: 1 }),
      testRow({ stat: 'proportion', level: 2 }),
      testRow({ stat: 'proportion', level: 3 }),
    ])
    const labels: Record<number, string> = { 1: 'Always', 2: '' }
    render(<EstimateTable response={response} meta={testMeta} levelLabel={(l) => labels[l]} />)
    expect(screen.getByRole('columnheader', { name: 'Answer' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Level' })).toBeNull()
    expect(screen.getByRole('cell', { name: 'Always' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '2' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '3' })).toBeInTheDocument()
    // A derived score's bins keep their "0–1" … labels the same way.
    const bins = testResponse([testRow({ stat: 'distribution', level: 0 })])
    render(<EstimateTable response={bins} meta={testMeta} levelLabel={() => '0–1'} />)
    expect(screen.getByRole('cell', { name: '0–1' })).toBeInTheDocument()
  })
})

describe('RadioRow', () => {
  const answers = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ value: String(i + 1), label: `Answer ${i + 1}` }))

  test('up to six options stay a segmented radio group', () => {
    render(
      <RadioRow
        legend="Answer level"
        name="level"
        options={answers(SELECT_ABOVE)}
        value="2"
        onChange={() => undefined}
      />,
    )
    expect(screen.getByRole('group', { name: 'Answer level' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(6)
    expect(screen.getByRole('radio', { name: 'Answer 2' })).toBeChecked()
  })

  test('above six options the group is a compact select: same label, same values (ADR-0016)', () => {
    const onChange = vi.fn()
    render(
      <RadioRow
        legend="Answer level"
        name="level"
        options={answers(SELECT_ABOVE + 1)}
        value="2"
        onChange={onChange}
      />,
    )
    expect(screen.queryByRole('radio')).toBeNull()
    const select = screen.getByLabelText('Answer level')
    expect(select.tagName).toBe('SELECT')
    expect(select).toHaveValue('2')
    expect([...(select as HTMLSelectElement).options].map((o) => o.value)).toEqual(
      answers(7).map((o) => o.value),
    )
    fireEvent.change(select, { target: { value: '7' } })
    expect(onChange).toHaveBeenCalledWith('7')
  })
})

describe('RadioRow notes', () => {
  test('a disabled option says why: the note under the row describes it', () => {
    render(
      <RadioRow
        legend="Wave"
        name="wave"
        options={[
          { value: 'Y1', label: '2023' },
          { value: 'MY', label: 'Midyear', disabled: true },
          { value: 'Y2', label: '2024' },
        ]}
        value="Y1"
        onChange={() => undefined}
        note="Midyear isn't available: this question wasn't asked in the midyear survey."
      />,
    )
    const midyear = screen.getByRole('radio', { name: 'Midyear' })
    expect(midyear).toBeDisabled()
    expect(midyear).toHaveAccessibleDescription(
      "Midyear isn't available: this question wasn't asked in the midyear survey.",
    )
    // Only the unavailable option points at it.
    expect(screen.getByRole('radio', { name: '2023' })).not.toHaveAttribute('aria-describedby')
  })

  test('as a select, the note describes the select without joining its name', () => {
    render(
      <RadioRow
        legend="Answer level"
        name="level"
        options={Array.from({ length: SELECT_ABOVE + 1 }, (_, i) => ({
          value: String(i),
          label: `Answer ${i}`,
          disabled: i === 0,
        }))}
        value="1"
        onChange={() => undefined}
        note="Answer 0 isn't available."
      />,
    )
    const select = screen.getByRole('combobox', { name: 'Answer level' })
    expect(select).toHaveAccessibleDescription("Answer 0 isn't available.")
  })
})

describe('CountryFilter', () => {
  const countries = testMeta.countries

  function renderFilter(selected: number[] = [], onChange = vi.fn()) {
    render(<CountryFilter countries={countries} selected={selected} onChange={onChange} />)
    return onChange
  }

  test('the trigger reports its state in a few words under a visible "Countries" label', () => {
    const { unmount } = render(
      <CountryFilter countries={countries} selected={[]} onChange={vi.fn()} />,
    )
    expect(screen.getByText('Countries')).toBeInTheDocument()
    const trigger = screen.getByText('All 2').closest('summary')
    // "Countries" stays in the accessible name (a visually hidden prefix).
    expect(trigger?.textContent).toBe('Countries: All 2')
    unmount()
    render(<CountryFilter countries={countries} selected={[1]} onChange={vi.fn()} />)
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    expect(countryTriggerText(0, 23)).toBe('All 23')
    expect(countryTriggerText(23, 23)).toBe('All 23')
    expect(countryTriggerText(3, 23)).toBe('3 selected')
  })

  test('Select all checks every country', () => {
    const onChange = renderFilter([])
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect(onChange).toHaveBeenCalledWith([1, 22])
  })

  test('Clear returns to the all-countries default', () => {
    const onChange = renderFilter([1, 22])
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  test('Escape closes the panel and returns focus to the trigger', () => {
    renderFilter()
    const details = document.querySelector('details') as HTMLDetailsElement
    details.open = true
    fireEvent.keyDown(details, { key: 'Escape' })
    expect(details.open).toBe(false)
    expect(document.activeElement?.tagName.toLowerCase()).toBe('summary')
  })

  test('a pointerdown outside closes the panel and leaves focus alone', () => {
    renderFilter()
    const details = document.querySelector('details') as HTMLDetailsElement
    details.open = true
    fireEvent.pointerDown(document.body)
    expect(details.open).toBe(false)
    // …while a pointerdown inside keeps it open.
    details.open = true
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Clear' }))
    expect(details.open).toBe(true)
  })
})
