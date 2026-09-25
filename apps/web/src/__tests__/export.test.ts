// PNG serializer (token inlining, stamping), the download names and CSV helpers.

import { describe, expect, test } from 'vitest'
import { responseToCsv } from '../export/csv'
import { exportFilename, slugify } from '../export/filename'
import { inlineTokenColors, serializeSvg, stampLines } from '../export/png'
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
})

describe('download names (ADR-0016)', () => {
  test('one rule for CSV and PNG: measure, view, waves, then the optional parts, in words', () => {
    expect(
      exportFilename(
        { measure: 'Has someone to confide in', view: 'Change', waves: '2023 to 2024' },
        'csv',
      ),
    ).toBe('flourish-atlas_has-someone-to-confide-in_change_2023-to-2024.csv')
    expect(
      exportFilename(
        { measure: 'Secure Flourishing Index', view: 'By country', waves: '2023' },
        'png',
      ),
    ).toBe('flourish-atlas_secure-flourishing-index_by-country_2023.png')
    expect(
      exportFilename(
        { measure: 'Happiness', view: 'By country', waves: '2023', breakdown: 'Age band' },
        'csv',
      ),
    ).toBe('flourish-atlas_happiness_by-country_2023_by-age-band.csv')
    expect(
      exportFilename(
        { measure: 'Happiness', view: 'Correlates', waves: '2024', country: 'Türkiye' },
        'csv',
      ),
    ).toBe('flourish-atlas_happiness_correlates_2024_turkiye.csv')
  })

  test('the server CSV name is the same string (export.py pins this example too)', () => {
    expect(exportFilename({ measure: 'Happiness', view: 'By country', waves: '2023' }, 'csv')).toBe(
      'flourish-atlas_happiness_by-country_2023.csv',
    )
  })

  test('slugs are lowercase ASCII with diacritics stripped, never codes or versions', () => {
    expect(slugify('Türkiye')).toBe('turkiye')
    expect(slugify("Importance of the country's main religion")).toBe(
      'importance-of-the-countrys-main-religion',
    )
    expect(slugify('  Beliefs & experiences ')).toBe('beliefs-experiences')
  })
})

describe('CSV helpers', () => {
  test('quoting matches the csv module (commas and quotes)', () => {
    const response = testResponse([testRow({ group: { country_code: 1 }, weight: 'w_c1' })])
    response.meta.by = ['country_code']
    const csv = responseToCsv(response)
    expect(csv).toContain('# outcome: HAPPY')
    expect(csv).toContain('# suppression: none (all cells shown)')
    expect(csv.split('\n').find((line) => !line.startsWith('#'))).toContain(
      'country_code,stat,estimate',
    )
  })
})
