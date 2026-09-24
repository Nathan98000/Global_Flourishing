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
  '--div-neg-mark',
  '--div-pos-mark',
]

/** The diverging tints (Phase 6), negative → neutral → positive: five
 * steps per sign around the page tone. */
const DIVERGING = [
  '--div-n5',
  '--div-n4',
  '--div-n3',
  '--div-n2',
  '--div-n1',
  '--div-0',
  '--div-p1',
  '--div-p2',
  '--div-p3',
  '--div-p4',
  '--div-p5',
]

// Sub-3:1 in light mode by design (validated palette, relief rule):
// three of the six fixed SFI hues. The warm redesign series (teal /
// burnt orange / violet) all clear 3:1 on the paper surface.
const LIGHT_RELIEF = new Set(['--sfi-happiness', '--sfi-health', '--sfi-relationships'])

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
    // Selected segmented-control option: ink on the selected tint.
    assertContrast(vars, '--ink', '--control-selected', 4.5, theme)
  })

  test('tooltip text reads on the tooltip fill (Plot’s --plot-background is the surface)', () => {
    expect(vars['--plot-background']).toBe(vars['--surface'])
    // The tip's text is the plot's current colour (secondary ink), and a
    // value in ink; both clear AA on the fill.
    assertContrast(vars, '--ink-secondary', '--plot-background', 4.5, theme)
    assertContrast(vars, '--ink', '--plot-background', 4.5, theme)
    // The tip stroke is the hairline rule, visible on the fill.
    assertContrast(vars, '--grid', '--plot-background', 1.1, theme)
  })

  test('focus ring is visible (3:1 non-text)', () => {
    assertContrast(vars, '--focus-ring', '--page', 3, theme)
  })

  test('the sequential ramp reads against the surface', () => {
    // The deep end carries the high values: full non-text contrast.
    assertContrast(vars, '--seq-700', '--surface', 3, theme)
    // The light end must be a *visible tint* on the surface — the floor
    // that rejected a blue ramp indistinguishable on off-white paper —
    // and a visible step away from the next bin.
    assertContrast(vars, '--seq-100', '--surface', 1.25, theme)
    assertContrast(vars, '--seq-100', '--seq-200', 1.1, theme)
  })

  test('"no estimate" is a neutral with an outline, apart from the lowest bin', () => {
    // The outline is what separates the empty fill from any tint.
    assertContrast(vars, '--map-empty-outline', '--map-empty', 2, theme)
    assertContrast(vars, '--map-empty', '--surface', 1.15, theme)
    // The neutral is achromatic next to the tinted first step: the
    // spread of its RGB channels is a fraction of the ramp's.
    const spread = (hex: string) => {
      const raw = hex.replace('#', '')
      const channels = [0, 2, 4].map((i) => Number.parseInt(raw.slice(i, i + 2), 16))
      return Math.max(...channels) - Math.min(...channels)
    }
    expect(spread(vars['--map-empty'] as string) * 2).toBeLessThan(
      spread(vars['--seq-100'] as string),
    )
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

  test('the diverging ramp keeps ink text AA on every tint and has eleven distinct steps', () => {
    for (const tint of DIVERGING) assertContrast(vars, '--ink', tint, 4.5, theme)
    expect(new Set(DIVERGING.map((name) => vars[name])).size).toBe(11)
    // Both ends are visible against the neutral middle (the map ramp's floor).
    assertContrast(vars, '--div-n5', '--div-0', 1.15, theme)
    assertContrast(vars, '--div-p5', '--div-0', 1.15, theme)
    // The end step is a stronger step than the one before it, both ways.
    const step = (a: string, b: string) => contrast(vars[a] as string, vars[b] as string)
    expect(step('--div-n5', '--div-n4')).toBeGreaterThan(step('--div-n4', '--div-n3'))
    expect(step('--div-p5', '--div-p4')).toBeGreaterThan(step('--div-p4', '--div-p3'))
    // The two signed marks are told apart (rust vs teal, not one hue).
    expect(vars['--div-neg-mark']).not.toBe(vars['--div-pos-mark'])
  })
})

test('the dark media block and the dark stamp define identical tokens', () => {
  expect(darkMedia).toEqual(darkStamped)
})

test('native controls follow the stamped theme, not the OS', () => {
  // A stamped light theme forces light form controls and scrollbars
  // under an OS dark preference, and vice versa.
  const lightStamp = css.slice(css.indexOf(":root[data-theme='light']"))
  expect(lightStamp.slice(0, lightStamp.indexOf('}'))).toContain('color-scheme: light')
  const darkStamp = css.slice(css.indexOf(":root[data-theme='dark']"))
  expect(darkStamp.slice(0, darkStamp.indexOf('}'))).toContain('color-scheme: dark')
})

test('the relief exception list matches reality (light marks below 3:1)', () => {
  for (const mark of MARKS) {
    const ratio = contrast(light[mark] as string, light['--surface'] as string)
    expect(ratio < 3, `${mark} light contrast ${ratio.toFixed(2)}`).toBe(LIGHT_RELIEF.has(mark))
  }
})
