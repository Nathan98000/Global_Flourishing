// The chart's header (G4): the title and subtitle at full width, then one
// toolbar row — the page's controls, then the key, how to read the chart
// and the downloads — then anything too long for that row.

import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { ChartFigure } from '../charts/ChartFigure'
import { ChartKey } from '../charts/ChartKey'

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
