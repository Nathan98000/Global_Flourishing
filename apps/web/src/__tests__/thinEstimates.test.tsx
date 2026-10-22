// Thin estimates (ADR-0031): an estimate few people are behind is shown,
// drawn hollow with an asterisk on its value, and its card says so; an
// estimate with a zero SE has no interval, and its card says why.

import { render } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { ChartKey } from '../charts/ChartKey'
import { RankedBar } from '../charts/RankedBar'
import { THIN_LINE, ciLine, isThin, starValue, tipText } from '../charts/theme'
import { keyThinBelow } from '../views/viewState'
import { happyVariable, testMeta, testResponseMeta, testRow } from '../test-utils/fixtures'

describe('the card', () => {
  test('a thin estimate says so after its sample size', () => {
    const row = testRow({ estimate: 7.12, ci_lo: 6.2, ci_hi: 8.04, n: 24, flagged: true })
    expect(tipText(row, 'Vermont').split('\n')).toEqual([
      'Vermont',
      'Mean: 7.12',
      '95% CI: [6.20, 8.04]',
      'Based on 24 people',
      THIN_LINE,
    ])
    expect(tipText(testRow(), 'Ohio')).not.toContain(THIN_LINE)
  })

  test('a zero SE has no interval, and the card says why', () => {
    const one = testRow({ estimate: 9, se: 0, ci_lo: null, ci_hi: null, n: 1, flagged: true })
    expect(ciLine(one)).toBe('No 95% CI — one person')
    const same = testRow({ estimate: 10, se: 0, ci_lo: null, ci_hi: null, n: 4 })
    expect(ciLine(same)).toBe('No 95% CI — everyone gave the same answer')
    const none = testRow({ stat: 'proportion', estimate: 0, se: 0, ci_lo: null, ci_hi: null })
    expect(ciLine(none)).toBe('No 95% CI — nobody in this group gave this answer')
    const all = testRow({ stat: 'proportion', estimate: 1, se: 0, ci_lo: null, ci_hi: null })
    expect(ciLine(all)).toBe('No 95% CI — everyone in this group gave this answer')
    const steady = testRow({ stat: 'change', estimate: 0, se: 0, ci_lo: null, ci_hi: null })
    expect(ciLine(steady)).toBe('No 95% CI — everyone changed by the same amount')
  })

  test('no flag without an estimate; the value is starred only when thin', () => {
    expect(isThin(testRow({ flagged: true, estimate: null }))).toBe(false)
    expect(starValue('7.12', testRow({ flagged: true }))).toBe('7.12*')
    expect(starValue('7.12', testRow())).toBe('7.12')
  })
})

describe('the key', () => {
  test('names the threshold only when the chart holds a thin estimate', () => {
    const rows = [testRow(), testRow({ flagged: true })]
    expect(keyThinBelow(rows, { flag_below: 30 })).toBe(30)
    expect(keyThinBelow([testRow()], { flag_below: 30 })).toBeUndefined()
    expect(keyThinBelow(rows, { flag_below: 0 })).toBeUndefined()
    expect(keyThinBelow(rows, undefined)).toBeUndefined()
    const { container } = render(<ChartKey mark="dot" label="mean" ciLevel={0.95} thinBelow={30} />)
    expect(container.textContent).toContain('* fewer than 30 people')
    const plain = render(<ChartKey mark="dot" label="mean" ciLevel={0.95} />)
    expect(plain.container.textContent).not.toContain('fewer than')
  })
})

describe('the chart', () => {
  test('a thin row is hollow and its value starred', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    try {
      const rows = [
        testRow({ group: { country_code: 1 }, estimate: 7.5 }),
        testRow({ group: { country_code: 22 }, estimate: 7.1, n: 12, flagged: true }),
      ]
      const { container } = render(
        <RankedBar
          rows={rows}
          meta={testMeta}
          responseMeta={testResponseMeta()}
          variable={happyVariable}
          color="var(--sfi-happiness)"
        />,
      )
      const fills = [...container.querySelectorAll('[aria-label="dot"] circle')].map((dot) =>
        dot.getAttribute('fill'),
      )
      expect(fills).toContain('var(--surface)')
      expect(fills).toContain('var(--sfi-happiness)')
      const values = [...container.querySelectorAll('[aria-label="text"] text')].map(
        (node) => node.textContent,
      )
      expect(values).toContain('7.10*')
      expect(values).toContain('7.50')
    } finally {
      canvas.mockRestore()
      vi.unstubAllGlobals()
    }
  })
})
