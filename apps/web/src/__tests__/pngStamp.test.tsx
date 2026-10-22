// The PNG carries the chart's header (G8): its key read off the figure,
// its subtitle wrapped to the image's width.

import { render } from '@testing-library/react'
import { expect, test } from 'vitest'
import { ChartKey } from '../charts/ChartKey'
import { keyFromFigure, wrapWords } from '../export/png'

test('the key in the image is the key on the page', () => {
  const { container } = render(
    <figure>
      <ChartKey
        mark="dot"
        label="mean"
        color="var(--sfi-happiness)"
        ciLevel={0.95}
        thinBelow={30}
      />
    </figure>,
  )
  expect(keyFromFigure(container.querySelector('figure'))).toEqual([
    { glyph: 'dot', label: 'mean', color: 'var(--sfi-happiness)' },
    { glyph: 'whisker', label: '95% CI', color: 'var(--sfi-happiness)' },
    { glyph: 'thin-dot', label: '* fewer than 30 people', color: 'var(--sfi-happiness)' },
  ])
  expect(keyFromFigure(null)).toEqual([])
})

test('a long subtitle wraps to the image, never past it', () => {
  const measure = (text: string) => text.length * 6
  const lines = wrapWords('Mean score, 0–10 · 2023 · all countries · highest first', 120, measure)
  expect(lines.length).toBeGreaterThan(1)
  expect(lines.every((line) => measure(line) <= 120)).toBe(true)
  expect(lines.join(' ')).toBe('Mean score, 0–10 · 2023 · all countries · highest first')
})
