// The shared primitives: suppression rendered in place, errors rendered
// distinctly, coverage summarized honestly.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { ApiError, NetworkError } from '../api/errors'
import { CountryFilter, countryTriggerText } from '../components/controls/CountryFilter'
import { Disclosure } from '../components/controls/Disclosure'
import { RadioRow, SELECT_ABOVE } from '../components/controls/RadioRow'
import { ErrorState } from '../components/ErrorState'
import { Stat } from '../components/Stat'
import { testMeta, testRow } from '../test-utils/fixtures'

describe('Stat', () => {
  test('an estimate never appears without CI and n — and never with a weight code', () => {
    render(<Stat row={testRow()} />)
    expect(screen.getByText('7.21')).toBeInTheDocument()
    expect(screen.getByText(/\[7\.10, 7\.32\]/)).toBeInTheDocument()
    expect(screen.getByText('based on 1,204 people')).toBeInTheDocument()
    expect(screen.queryByText(/w_c1/)).toBeNull()
  })

  test('a small cell appears with its n and no flag (ADR-0011)', () => {
    render(<Stat row={testRow({ n: 12 })} />)
    expect(screen.getByText('7.21')).toBeInTheDocument()
    expect(screen.getByText(/based on 12 people/)).toBeInTheDocument()
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
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The Atlas, Segments and What Matters still work.',
    )
    expect(screen.getByRole('alert')).not.toHaveTextContent(/filters/)
  })

  test('with /health fine, a failed request is ours, in plain words, with Try again (H14)', () => {
    const { rerender } = render(
      <ErrorState error={new NetworkError(new TypeError('x'))} apiReachable />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong on our side.')
    expect(screen.getByRole('alert')).not.toHaveTextContent('offline')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    rerender(<ErrorState error={new ApiError('http', 500, ['Internal server error: X'])} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong on our side.')
    // No developer's words: no status, no server message.
    expect(screen.getByRole('alert')).not.toHaveTextContent(/HTTP|500|Internal server error/)
  })

  test('Try again asks once more for every request that failed', () => {
    const client = new QueryClient()
    const refetch = vi.spyOn(client, 'refetchQueries').mockResolvedValue()
    render(
      <QueryClientProvider client={client}>
        <ErrorState error={new ApiError('http', 502, [])} />
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalledTimes(1)
    const { predicate } = refetch.mock.calls[0]?.[0] as {
      predicate: (query: { state: { status: string } }) => boolean
    }
    expect(predicate({ state: { status: 'error' } })).toBe(true)
    expect(predicate({ state: { status: 'success' } })).toBe(false)
  })
})

describe('RadioRow', () => {
  const answers = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ value: String(i + 1), label: `Answer ${i + 1}` }))

  test('up to six options stay a segmented radio group', () => {
    render(
      <RadioRow
        legend="Showing % who said"
        name="level"
        options={answers(SELECT_ABOVE)}
        value="2"
        onChange={() => undefined}
      />,
    )
    expect(screen.getByRole('group', { name: 'Showing % who said' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(6)
    expect(screen.getByRole('radio', { name: 'Answer 2' })).toBeChecked()
  })

  test('above six options the group is a compact select: same label, same values (ADR-0016)', () => {
    const onChange = vi.fn()
    render(
      <RadioRow
        legend="Showing % who said"
        name="level"
        options={answers(SELECT_ABOVE + 1)}
        value="2"
        onChange={onChange}
      />,
    )
    expect(screen.queryByRole('radio')).toBeNull()
    const select = screen.getByLabelText('Showing % who said')
    expect(select.tagName).toBe('SELECT')
    expect(select).toHaveValue('2')
    expect([...(select as HTMLSelectElement).options].map((o) => o.value)).toEqual(
      answers(7).map((o) => o.value),
    )
    fireEvent.change(select, { target: { value: '7' } })
    expect(onChange).toHaveBeenCalledWith('7')
    // The form may be narrower than its longest option, so a long answer
    // never widens a control row (journey 11 holds the widths).
    expect(select.closest('label')?.className).toContain('selectForm')
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
        legend="Showing % who said"
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
    const select = screen.getByRole('combobox', { name: 'Showing % who said' })
    expect(select).toHaveAccessibleDescription("Answer 0 isn't available.")
    // With a note, the box around both is the form: it is what may shrink.
    expect(select.closest('label')?.parentElement?.className).toContain('selectForm')
  })
})

describe('CountryFilter', () => {
  const countries = testMeta.countries

  function renderFilter(selected: number[] = [], onChange = vi.fn()) {
    render(<CountryFilter countries={countries} selected={selected} onChange={onChange} />)
    return onChange
  }

  test('the trigger is a button that reports its state in a few words, under a "Countries" label', () => {
    const { unmount } = render(
      <CountryFilter countries={countries} selected={[]} onChange={vi.fn()} />,
    )
    expect(screen.getByText('Countries', { selector: 'span' })).toBeInTheDocument()
    const trigger = screen
      .getByText('All countries', { selector: 'summary span' })
      .closest('summary')
    // "Countries" stays in the accessible name (a visually hidden prefix).
    expect(trigger?.textContent).toBe('Countries: All countries')
    unmount()
    render(<CountryFilter countries={countries} selected={[1]} onChange={vi.fn()} />)
    expect(screen.getByText('1 country', { selector: 'summary span' })).toBeInTheDocument()
    expect(countryTriggerText(0, 23)).toBe('All countries')
    expect(countryTriggerText(23, 23)).toBe('All countries')
    expect(countryTriggerText(3, 23)).toBe('3 countries')
  })

  test('the panel starts with All countries; "all" is never shown as nothing ticked (F20)', () => {
    const onChange = renderFilter([])
    const all = screen.getByRole('radio', { name: 'All countries' })
    expect(all).toBeChecked()
    // No list of unticked boxes while all countries are shown.
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    // Choose countries: the ticks appear; a tick chooses that country.
    fireEvent.click(screen.getByRole('radio', { name: 'Choose countries' }))
    expect(screen.getByRole('radio', { name: 'Choose countries' })).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'United States' }))
    expect(onChange).toHaveBeenCalledWith([22])
  })

  test('with countries chosen, All countries returns to the default', () => {
    const onChange = renderFilter([1, 22].slice(0, 1))
    expect(screen.getByRole('radio', { name: 'Choose countries' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Testland' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'All countries' }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  /** Open the panel as a click does: `open`, then its toggle event. */
  const openPanel = () => {
    const details = document.querySelector('details') as HTMLDetailsElement
    details.open = true
    fireEvent(details, new Event('toggle'))
    return details
  }

  test('Escape closes the panel and returns focus to the trigger — from anywhere (H12)', () => {
    renderFilter()
    let details = openPanel()
    fireEvent.keyDown(details, { key: 'Escape' })
    expect(details.open).toBe(false)
    expect(document.activeElement?.tagName.toLowerCase()).toBe('summary')
    fireEvent(details, new Event('toggle'))
    // Escape pressed with focus elsewhere on the page closes it too.
    details = openPanel()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(details.open).toBe(false)
    expect(document.activeElement?.tagName.toLowerCase()).toBe('summary')
  })

  test('focus leaving the panel closes it (H12)', () => {
    render(
      <>
        <CountryFilter countries={testMeta.countries} selected={[]} onChange={() => undefined} />
        <button type="button">Next control</button>
      </>,
    )
    const details = openPanel()
    act(() => screen.getByRole('radio', { name: 'Choose countries' }).focus())
    expect(details.open).toBe(true)
    act(() => screen.getByRole('button', { name: 'Next control' }).focus())
    expect(details.open).toBe(false)
  })

  test('a pointerdown outside closes the panel and leaves focus alone', () => {
    renderFilter()
    let details = openPanel()
    fireEvent.pointerDown(document.body)
    expect(details.open).toBe(false)
    fireEvent(details, new Event('toggle'))
    // …while a pointerdown inside keeps it open.
    details = openPanel()
    fireEvent.pointerDown(screen.getByRole('radio', { name: 'Choose countries' }))
    expect(details.open).toBe(true)
  })
})

describe('Disclosure (H12)', () => {
  test('"What’s the difference?" closes on Escape from anywhere and when focus leaves it', () => {
    render(
      <>
        <Disclosure variant="info" label="What’s the difference?">
          <p>
            Two ways to measure. <a href="#more">More</a>
          </p>
        </Disclosure>
        <button type="button">Next control</button>
      </>,
    )
    const button = screen.getByRole('button', { name: 'What’s the difference?' })
    // Its "i" is a glyph, not a word of its name (H16).
    expect(button.querySelector('[aria-hidden="true"]')).toHaveTextContent('i')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveFocus()
    fireEvent.click(button)
    act(() => screen.getByRole('link', { name: 'More' }).focus())
    expect(button).toHaveAttribute('aria-expanded', 'true')
    act(() => screen.getByRole('button', { name: 'Next control' }).focus())
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })
})
