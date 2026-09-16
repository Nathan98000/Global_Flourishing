// PNG serializer (token inlining, stamping, naming) and CSV helpers.

import { describe, expect, test } from 'vitest'
import { csvFilename, responseToCsv } from '../export/csv'
import { inlineTokenColors, pngFilename, serializeSvg, stampLines } from '../export/png'
import { testResponse, testRow } from '../test-utils/fixtures'

const RESOLVE: Record<string, string> = {
  '--sfi-happiness': '#eda100',
  '--surface': '#fcfcfb',
  '--ink': '#0b0b0b',
}

const resolver = (name: string) => RESOLVE[name] ?? '#123456'

describe('PNG export', () => {
  test('inlines every var(--token) so the raster matches the screen', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 100 50')
    svg.innerHTML =
      '<rect fill="var(--sfi-happiness)" stroke="var(--ink)"/>' +
      '<text style="fill: var(--ink); font-size: 10px">hi</text>'
    const serialized = serializeSvg(svg, resolver)
    expect(serialized).toContain('#eda100')
    expect(serialized).toContain('#0b0b0b')
    expect(serialized).not.toContain('var(--')
    expect(serialized).toContain('width="100"') // explicit size for the rasterizer
  })

  test('inlineTokenColors touches attributes and styles, nothing else', () => {
    const div = document.createElement('div')
    div.innerHTML = '<p style="color: var(--ink)">x</p><i fill="none"></i>'
    inlineTokenColors(div, resolver)
    expect(div.innerHTML).toContain('#0b0b0b')
    expect(div.innerHTML).toContain('fill="none"')
  })

  test('the stamp names the chart, the data version and the DOI', () => {
    const { header, footer } = stampLines({ title: 'Happiness — Wave 1', dataVersion: '2025.1' })
    expect(header).toBe('Happiness — Wave 1')
    expect(footer).toContain('data 2025.1')
    expect(footer).toContain('doi.org/10.17605/OSF.IO/3JTZ8')
  })

  test('filenames are safe and versioned', () => {
    expect(pngFilename('Happiness — Wave 1 (2023)', '2025.1')).toBe(
      'flourish_Happiness-Wave-1-2023_2025.1.png',
    )
  })
})

describe('CSV helpers', () => {
  test('the filename mirrors the server rule (export.py)', () => {
    expect(csvFilename('HAPPY', 'Y1', 'mean', '2025.1')).toBe('flourish_HAPPY_Y1_mean_2025.1.csv')
    expect(csvFilename('sfi', 'Y2', 'quantile', null)).toBe('flourish_sfi_Y2_quantile_nodata.csv')
  })

  test('quoting matches the csv module (commas and quotes)', () => {
    const response = testResponse([testRow({ group: { country_code: 1 }, weight: 'w_c1' })])
    response.meta.by = ['country_code']
    const csv = responseToCsv(response)
    expect(csv).toContain('# outcome: HAPPY')
    expect(csv).toContain('# suppression: n<50 suppressed, n<100 flagged')
    expect(csv.split('\n').find((line) => !line.startsWith('#'))).toContain(
      'country_code,stat,estimate',
    )
  })
})
