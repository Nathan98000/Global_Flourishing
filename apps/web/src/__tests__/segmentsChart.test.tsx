// Segments' panels (G6): a level with no estimate takes no row; the window
// fits the cells with enough people behind them, and a thin cell beyond
// it sits at the edge with an arrow pointing on.

import { render } from '@testing-library/react'
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
