// Both themes must be AA-clean (exit criterion 4): text tokens ≥ 4.5:1,
// chart marks ≥ 3:1 against the plot surface — except the three light
// hues documented under the dataviz relief rule (ADR-0010), which is why
// every chart also ships direct labels and a data table.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

// vitest runs from apps/web (jsdom rewrites import.meta.url, so resolve
// from the package root instead).
const css = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8')

function block(after: string): Record<string, string> {
  const start = css.indexOf(after)
  expect(start, `token scope ${after} exists`).toBeGreaterThan(-1)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  const vars: Record<string, string> = {}
  for (const match of css.slice(open, close).matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    vars[`--${match[1]}`] = (match[2] ?? '').trim()
  }
  return vars
}

const light = block(':root {')
const darkStamped = block(":root[data-theme='dark']")
const darkMedia = block(":root:not([data-theme='light'])")

function luminance(hex: string): number {
  const raw = hex.replace('#', '')
  const channels = [0, 2, 4].map((i) => Number.parseInt(raw.slice(i, i + 2), 16) / 255)
  const linear = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

function assertContrast(
  vars: Record<string, string>,
  fg: string,
  bg: string,
  minimum: number,
  theme: string,
) {
  const fgHex = vars[fg]
  const bgHex = vars[bg]
  expect(fgHex, `${theme} ${fg}`).toMatch(/^#[0-9a-f]{6}$/i)
  expect(bgHex, `${theme} ${bg}`).toMatch(/^#[0-9a-f]{6}$/i)
  expect(
    contrast(fgHex as string, bgHex as string),
    `${theme}: ${fg} on ${bg}`,
  ).toBeGreaterThanOrEqual(minimum)
}

const MARKS = [
  '--sfi-happiness',
  '--sfi-health',
  '--sfi-meaning',
  '--sfi-character',
  '--sfi-relationships',
  '--sfi-financial',
  '--series-1',
  '--series-2',
  '--series-3',
]

// Sub-3:1 in light mode by design (validated palette, relief rule);
// --series-3 shares the health hue.
const LIGHT_RELIEF = new Set([
  '--sfi-happiness',
  '--sfi-health',
  '--sfi-relationships',
  '--series-3',
])

describe.each([
  ['light', light],
  ['dark', darkStamped],
] as const)('%s theme', (theme, vars) => {
  test('text tokens clear AA (4.5:1)', () => {
    assertContrast(vars, '--ink', '--surface', 4.5, theme)
    assertContrast(vars, '--ink', '--page', 4.5, theme)
    assertContrast(vars, '--ink-secondary', '--surface', 4.5, theme)
    assertContrast(vars, '--accent', '--surface', 4.5, theme)
    assertContrast(vars, '--warn-text', '--warning-bg', 4.5, theme)
    assertContrast(vars, '--error-text', '--surface', 4.5, theme)
    assertContrast(vars, '--ink', '--notice-bg', 4.5, theme)
    assertContrast(vars, '--ink', '--warning-bg', 4.5, theme)
  })

  test('focus ring is visible (3:1 non-text)', () => {
    assertContrast(vars, '--focus-ring', '--page', 3, theme)
  })

  test('chart marks clear 3:1 against the plot surface', () => {
    for (const mark of MARKS) {
      if (theme === 'light' && LIGHT_RELIEF.has(mark)) continue
      assertContrast(vars, mark, '--surface', 3, theme)
    }
  })

  test('sfi hues stay six distinct values', () => {
    const hues = MARKS.slice(0, 6).map((name) => vars[name])
    expect(new Set(hues).size).toBe(6)
  })
})

test('the dark media block and the dark stamp define identical tokens', () => {
  expect(darkMedia).toEqual(darkStamped)
})

test('the relief exception list matches reality (light marks below 3:1)', () => {
  for (const mark of MARKS) {
    const ratio = contrast(light[mark] as string, light['--surface'] as string)
    expect(ratio < 3, `${mark} light contrast ${ratio.toFixed(2)}`).toBe(LIGHT_RELIEF.has(mark))
  }
})
