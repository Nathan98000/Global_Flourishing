// Segments' panels (G6): a level with no estimate takes no row; the window
// fits the cells with enough people behind them, and a thin cell beyond
// it sits at the edge with an arrow pointing on.

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { SmallMultiples } from '../charts/SmallMultiples'
import { happyVariable, testMeta, testResponseMeta, testRow } from '../test-utils/fixtures'

// The release's four gender answers (the fixture carries two).
const meta = {
  ...testMeta,
  breakdown_labels: {
    ...testMeta.breakdown_labels,
    gender: {
      display_name: 'Gender',
      levels: [
        { value: 1, label: 'Male' },
        { value: 2, label: 'Female' },
        { value: 3, label: 'Other' },
        { value: 4, label: 'Prefer not to answer' },
      ],
    },
  },
}

const rows = [
  testRow({ group: { country_code: 1, gender: 1 }, estimate: 7.2, ci_lo: 7.1, ci_hi: 7.3 }),
  testRow({ group: { country_code: 1, gender: 2 }, estimate: 7.4, ci_lo: 7.3, ci_hi: 7.5 }),
  // One person: thin, far below the others, no interval.
  testRow({
    group: { country_code: 1, gender: 3 },
    estimate: 1.5,
    se: 0,
    ci_lo: null,
    ci_hi: null,
    n: 1,
    flagged: true,
  }),
  // Nobody: no estimate anywhere.
  testRow({
    group: { country_code: 1, gender: 4 },
    estimate: null,
    se: null,
    ci_lo: null,
    ci_hi: null,
    n: 0,
  }),
]

describe('SmallMultiples', () => {
  test('no row for a level without an estimate; the window fits the solid cells; an arrow for the thin one beyond', () => {
    const { container } = render(
      <SmallMultiples
        rows={rows}
        meta={meta}
        responseMeta={testResponseMeta({ by: ['country_code', 'gender'] })}
        variable={happyVariable}
        color="var(--series-1)"
        levelColumn="gender"
        levelDomain={['Male', 'Female', 'Other', 'Prefer not to answer']}
        sort="estimate"
      />,
    )
    const text = container.querySelector('svg')?.textContent ?? ''
    expect(text).toContain('Other')
    expect(text).not.toContain('Prefer not to answer')
    const ticks = [...container.querySelectorAll('[aria-description="panel tick label"] text')].map(
      (node) => Number(node.textContent),
    )
    // Fitted to 7.1–7.5, not stretched down to the one person's 1.5.
    expect(Math.min(...ticks)).toBeGreaterThan(5)
    expect(text).toContain('◂')
  })
})

describe('Segments panels (H11, H2)', () => {
  // Testland answers Male and Female; the United States only Male (its
  // Female row has no estimate).
  const panelRows = [
    testRow({ group: { country_code: 1, gender: 1 }, estimate: 7.2, ci_lo: 7.1, ci_hi: 7.3 }),
    testRow({ group: { country_code: 1, gender: 2 }, estimate: 7.4, ci_lo: 7.3, ci_hi: 7.5 }),
    testRow({ group: { country_code: 22, gender: 1 }, estimate: 6.8, ci_lo: 6.7, ci_hi: 6.9 }),
    testRow({
      group: { country_code: 22, gender: 2 },
      estimate: null,
      se: null,
      ci_lo: null,
      ci_hi: null,
      n: 0,
    }),
  ]
  const chart = () =>
    render(
      <div role="group" aria-label="chart">
        <SmallMultiples
          rows={panelRows}
          meta={meta}
          responseMeta={testResponseMeta({ by: ['country_code', 'gender'] })}
          variable={happyVariable}
          color="var(--series-1)"
          levelColumn="gender"
          levelDomain={['Male', 'Female', 'Other', 'Prefer not to answer']}
          facetDomain={['Testland', 'United States']}
          sort="estimate"
        />
      </div>,
    )

  test('a level takes a row only in the panels where it has an estimate', () => {
    const { container } = chart()
    // One drawing, a plot per panel, each with its own rows.
    const drawing = container.querySelector('svg') as SVGSVGElement
    const panels = [...drawing.querySelectorAll(':scope > svg')]
    expect(panels).toHaveLength(2)
    const labels = (panel: Element) =>
      [...panel.querySelectorAll('[aria-label="y-axis tick label"] text')].map(
        (node) => node.textContent,
      )
    expect(labels(panels[0] as Element)).toEqual(['Male', 'Female'])
    expect(labels(panels[1] as Element)).toEqual(['Male'])
    // The second panel is shorter, and sits under the first.
    const height = (panel: Element) => Number(panel.getAttribute('height'))
    expect(height(panels[1] as Element)).toBeLessThan(height(panels[0] as Element))
    expect(Number(panels[1]?.getAttribute('y'))).toBeGreaterThanOrEqual(
      height(panels[0] as Element),
    )
    expect(Number(drawing.getAttribute('height'))).toBeGreaterThan(
      height(panels[0] as Element) + height(panels[1] as Element),
    )
  })

  test('a keyboard reads it panel by panel: one tab stop, ↑ ↓ within, Page Down to the next country', () => {
    chart()
    const group = screen.getByRole('group', { name: 'chart' })
    const lists = within(group).getAllByRole('list')
    expect(lists.map((list) => list.getAttribute('aria-label'))).toEqual([
      'Testland',
      'United States',
    ])
    const items = within(group).getAllByRole('listitem')
    // Each named by its group and the value it stands for.
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual([
      'Male, 7.20',
      'Female, 7.40',
      'Male, 6.80',
    ])
    expect(items.map((item) => item.tabIndex)).toEqual([0, -1, -1])
    const [male, female, usMale] = items as [HTMLElement, HTMLElement, HTMLElement]
    act(() => male.focus())
    // The card names the country and the group.
    const card = within(group).getByRole('tooltip')
    expect(card).toHaveTextContent('Testland')
    expect(card).toHaveTextContent('Gender: Male')
    expect(card).toHaveTextContent('95% CI: [7.10, 7.30]')
    fireEvent.keyDown(male, { key: 'ArrowDown' })
    expect(female).toHaveFocus()
    // ↓ holds at the panel's end; Page Down goes to the next country's
    // same group, or its nearest.
    fireEvent.keyDown(female, { key: 'ArrowDown' })
    expect(female).toHaveFocus()
    fireEvent.keyDown(female, { key: 'PageDown' })
    expect(usMale).toHaveFocus()
    expect(within(group).getByRole('tooltip')).toHaveTextContent('United States')
    fireEvent.keyDown(usMale, { key: 'PageDown' })
    expect(usMale).toHaveFocus()
    fireEvent.keyDown(usMale, { key: 'PageUp' })
    expect(male).toHaveFocus()
    fireEvent.keyDown(male, { key: 'End' })
    expect(female).toHaveFocus()
    fireEvent.keyDown(female, { key: 'Home' })
    expect(male).toHaveFocus()
    expect(items.map((item) => item.tabIndex)).toEqual([0, -1, -1])
  })
})
