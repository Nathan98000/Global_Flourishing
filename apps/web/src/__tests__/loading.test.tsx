// The progress affordance (Phase 5, decision 1): skeleton at once, bar
// after 600 ms, one line after 4 s — a stable node that is never
// re-created (so never re-announced) on repaint; the same bar rides a
// refetching figure. Fake timers throughout.

import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ChartFigure } from '../charts/ChartFigure'
import {
  LoadingBlock,
  PROGRESS_AFTER_MS,
  STILL_WORKING_AFTER_MS,
  STILL_WORKING_COPY,
  useDelayedFlags,
} from '../components/Loading'

// The figure's Methods link needs no router here: a plain anchor stands in.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useDelayedFlags', () => {
  test('each flag turns on after its delay and all reset when inactive', () => {
    const { result, rerender } = renderHook(({ active }) => useDelayedFlags(active), {
      initialProps: { active: true },
    })
    expect(result.current).toEqual([false, false])
    act(() => vi.advanceTimersByTime(PROGRESS_AFTER_MS))
    expect(result.current).toEqual([true, false])
    act(() => vi.advanceTimersByTime(STILL_WORKING_AFTER_MS - PROGRESS_AFTER_MS))
    expect(result.current).toEqual([true, true])
    rerender({ active: false })
    expect(result.current).toEqual([false, false])
    // The next wait starts its own clock.
    rerender({ active: true })
    act(() => vi.advanceTimersByTime(PROGRESS_AFTER_MS - 1))
    expect(result.current).toEqual([false, false])
    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toEqual([true, false])
  })

  test('the thresholds are the two exported constants', () => {
    expect(PROGRESS_AFTER_MS).toBe(600)
    expect(STILL_WORKING_AFTER_MS).toBe(4000)
  })
})

describe('LoadingBlock', () => {
  test('is the skeleton at 0 ms, grows a bar at 600 ms and one line at 4 s, never a spinner', () => {
    const { container } = render(<LoadingBlock height={420} label="Loading estimates" />)
    const block = screen.getByRole('status', { name: 'Loading estimates' })
    expect(block).toHaveAttribute('aria-busy', 'true')
    expect(block).toHaveStyle({ height: '420px' })
    expect(container.querySelector('[class*="bar"]')).toBeNull()
    expect(screen.queryByText(STILL_WORKING_COPY)).toBeNull()

    act(() => vi.advanceTimersByTime(PROGRESS_AFTER_MS))
    expect(container.querySelector('[class*="bar"]')).not.toBeNull()
    expect(screen.queryByText(STILL_WORKING_COPY)).toBeNull()

    act(() => vi.advanceTimersByTime(STILL_WORKING_AFTER_MS - PROGRESS_AFTER_MS))
    expect(screen.getByText(STILL_WORKING_COPY)).toBeInTheDocument()
    // Still one status region, its height unchanged: nothing shifts.
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(block).toHaveStyle({ height: '420px' })
    expect(container.querySelector('[class*="spinner"], [role="progressbar"]')).toBeNull()
  })

  test("is a skeleton in the chart's shape: an axis line and eight ghost rows, not a slab (F21)", () => {
    const { container } = render(<LoadingBlock height={420} label="Loading estimates" />)
    const block = screen.getByRole('status', { name: 'Loading estimates' })
    expect(block.className).not.toMatch(/skeleton/)
    const ghost = block.querySelector('[aria-hidden="true"]') as HTMLElement
    expect(ghost.querySelectorAll('[data-ghost="axis"]')).toHaveLength(1)
    const rows = ghost.querySelectorAll('[data-ghost="row"]')
    expect(rows).toHaveLength(8)
    // Each row: a label stub and a mark, the marks shortening down the
    // list like a ranking.
    const lengths = [...rows].map((row) =>
      parseFloat((row.lastElementChild?.firstElementChild as HTMLElement).style.width),
    )
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a))
    // The ghost carries no text; the label is the block's alone.
    expect(ghost.textContent).toBe('')
    // The bar still joins it at 600 ms.
    act(() => vi.advanceTimersByTime(PROGRESS_AFTER_MS))
    expect(container.querySelector('[class*="bar"]')).not.toBeNull()
  })

  test('the 4 s line is one stable node — not re-created on repaint, so not re-announced', () => {
    const { rerender } = render(<LoadingBlock height={300} label="Loading" />)
    act(() => vi.advanceTimersByTime(STILL_WORKING_AFTER_MS))
    const note = screen.getByText(STILL_WORKING_COPY)
    for (let i = 0; i < 5; i += 1) {
      rerender(<LoadingBlock height={300} label="Loading" />)
      act(() => vi.advanceTimersByTime(1000))
    }
    expect(screen.getAllByText(STILL_WORKING_COPY)).toHaveLength(1)
    expect(screen.getByText(STILL_WORKING_COPY)).toBe(note)
  })
})

describe('ChartFigure while refetching', () => {
  // The host toggles the refetch the way a view's query would.
  function Host() {
    const [isRefreshing, setRefreshing] = useState(true)
    return (
      <>
        <button type="button" onClick={() => setRefreshing(false)}>
          settle
        </button>
        <ChartFigure
          title="Happiness"
          ariaLabel="Happiness by country."
          isRefreshing={isRefreshing}
        >
          <svg />
        </ChartFigure>
      </>
    )
  }

  test('keeps the chart dimmed and wears the same thin bar after 600 ms', () => {
    const { container } = render(<Host />)
    const chart = screen.getByRole('img', { name: 'Happiness by country.' })
    expect(chart).toHaveAttribute('data-refreshing', 'true')
    // No loading block ever replaces the figure…
    expect(screen.queryByRole('status')).toBeNull()
    expect(container.querySelector('[class*="_bar_"]')).toBeNull()
    act(() => vi.advanceTimersByTime(PROGRESS_AFTER_MS))
    expect(container.querySelector('[class*="_bar_"]')).not.toBeNull()
    // …and the bar leaves with the refetch.
    fireEvent.click(screen.getByRole('button', { name: 'settle' }))
    expect(container.querySelector('[class*="_bar_"]')).toBeNull()
    expect(chart).not.toHaveAttribute('data-refreshing')
  })
})
