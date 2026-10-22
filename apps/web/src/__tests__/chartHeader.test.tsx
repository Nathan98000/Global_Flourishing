// The chart's header (G4): the title and subtitle at full width, then one
// toolbar row — the page's controls, then the key, how to read the chart
// and the downloads — then anything too long for that row.

import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { ChartFigure, NO_PICTURE } from '../charts/ChartFigure'
import { ChartKey } from '../charts/ChartKey'
import { SortHead } from '../charts/SortHead'

function follows(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
}

describe('ChartFigure header', () => {
  test('title, then the toolbar row (controls, key, links), then the line under it', () => {
    render(
      <ChartFigure
        title="Life evaluation today and Feelings about household income"
        subtitle="all countries · 2023"
        ariaLabel="A chart"
        toolbar={<button type="button">Straight-line</button>}
        chartKey={<ChartKey mark="dot" label="mean" ciLevel={0.95} />}
        afterToolbar={<span>Adjust for who answered in each state</span>}
      >
        <svg />
      </ChartFigure>,
    )
    const title = screen.getByText(/Life evaluation today and/)
    const control = screen.getByRole('button', { name: 'Straight-line' })
    const key = screen.getByText('mean')
    const howTo = screen.getByRole('link', { name: 'How to read this chart' })
    const download = screen.getByRole('button', { name: /Download/ })
    const after = screen.getByText('Adjust for who answered in each state')
    // The title is not inside the toolbar's row: nothing sits beside it.
    expect(title.closest('[data-toolbar]')).toBeNull()
    expect(follows(title, control)).toBe(true)
    expect(follows(control, key)).toBe(true)
    expect(follows(key, howTo)).toBe(true)
    expect(follows(howTo, download)).toBe(true)
    expect(follows(download, after)).toBe(true)
    expect(after.closest('[data-toolbar]')).toBeNull()
  })
})

describe('Download ▾ (H12, H13)', () => {
  const figure = (picture = true) =>
    render(
      <>
        <ChartFigure
          title="A grid"
          ariaLabel="A chart"
          picture={picture}
          csv={{ kind: 'client', onDownload: () => undefined }}
        >
          <div />
        </ChartFigure>
        <button type="button">Elsewhere</button>
      </>,
    )

  test('it closes when focus leaves it, and on Escape from anywhere, focus back on its button', () => {
    figure()
    const button = screen.getByRole('button', { name: 'Download' })
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    act(() => screen.getByRole('button', { name: 'Download CSV' }).focus())
    expect(button).toHaveAttribute('aria-expanded', 'true')
    act(() => screen.getByRole('button', { name: 'Elsewhere' }).focus())
    expect(button).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(button)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveFocus()
  })

  test('a chart drawn in HTML offers the CSV alone, and says why — blaming no browser', () => {
    figure(false)
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Download PNG' })).toBeNull()
    expect(screen.getByText(NO_PICTURE)).toBeInTheDocument()
    expect(NO_PICTURE).toBe(
      'This chart can’t be saved as a picture — the CSV has the same numbers.',
    )
    expect(document.body).not.toHaveTextContent(/this browser/)
  })
})

describe('the key beside the column labels on a phone (H15)', () => {
  test('it takes its own line above them when the room between them is too small — by measuring', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('40rem'),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }))
    const observers: (() => void)[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          observers.push(callback)
        }
        observe() {}
        disconnect() {}
      },
    )
    // A row 300 px wide; each label 100 px; the key 120 px: no room.
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
    const sizes = vi
      .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.hasAttribute('data-head-key') ? 120 : 100
      })
    try {
      const { container } = render(
        <ChartFigure
          title="Change"
          ariaLabel="A chart"
          sortHead={<SortHead names="Country" value="Mean change" dir="desc" onToggle={() => {}} />}
          chartKey={<ChartKey mark="dot" label="mean change" ciLevel={0.95} />}
        >
          <svg />
        </ChartFigure>,
      )
      const heads = container.querySelector('[data-head-key]')?.parentElement as HTMLElement
      expect(heads).toHaveAttribute('data-key-above')
      // The key comes first, on its own line, above the labels.
      expect(heads.firstElementChild).toHaveAttribute('data-head-key')
      // Room enough (a 600 px row): beside them again.
      width.mockReturnValue(600)
      act(() => observers.forEach((measure) => measure()))
      expect(heads).not.toHaveAttribute('data-key-above')
    } finally {
      width.mockRestore()
      sizes.mockRestore()
      vi.unstubAllGlobals()
    }
  })
})
