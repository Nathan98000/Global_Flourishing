// PNG serializer (token inlining, stamping), the download names and CSV helpers.

import { describe, expect, test } from 'vitest'
import { correlationTableToCsv, responseToCsv } from '../export/csv'
import { exportFilename, slugify } from '../export/filename'
import { CITATION_LINE, inlineTokenColors, serializeSvg, stampLines } from '../export/png'
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

  test('the stamp names the chart; the footer is the citation line alone (ADR-0016)', () => {
    const { header, footer } = stampLines({ title: 'Happiness — Wave 1' })
    expect(header).toBe('Happiness — Wave 1')
    expect(footer).toBe(CITATION_LINE)
    expect(footer).toContain('doi.org/10.17605/OSF.IO/3JTZ8')
    expect(footer).not.toMatch(/data /)
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

describe('correlation table CSV (Compare several)', () => {
  test('its own meta, then every pair — a pair built from the same answers with no numbers', () => {
    const correlation = testRow({
      group: {},
      predictor: 'LONELY',
      stat: 'pearson_r',
      estimate: -0.52,
      se: null,
      ci_lo: null,
      ci_hi: null,
      ci_method: 'none',
      se_method: 'none',
      n: 54,
      sum_w: 55.5,
    })
    const csv = correlationTableToCsv({
      meta: {
        data_version: 'test.1.0.0',
        vars: ['HAPPY', 'LONELY', 'sfi'],
        wave: 'Y1',
        stat: 'pearson_r',
        weight_key: 'y1',
        weight: 'w_c1',
        ci_level: 0.95,
        suppression: { threshold: 0, flag_below: 0 },
        n_frame: 60,
        filters: { country_code: [22] },
        min_n: 100,
      },
      pairs: [
        { a: 'HAPPY', b: 'LONELY', shares_answers: false, below_min_n: true, correlation },
        { a: 'HAPPY', b: 'sfi', shares_answers: true, below_min_n: false, correlation: null },
      ],
    })
    const lines = csv.trim().split('\n')
    expect(lines).toContain('# vars: HAPPY,LONELY,sfi')
    expect(lines).toContain('# min_n: 100')
    expect(lines).toContain('# suppression: none (all cells shown)')
    expect(lines).toContain('# filter country_code: 22')
    const header = lines.find((line) => line.startsWith('a,b,'))
    expect(header).toBe(
      'a,b,shares_answers,below_min_n,stat,estimate,se,ci_lo,ci_hi,ci_level,ci_method,n,sum_w,n_psu,n_strata,df,se_method,weight,suppressed,flagged',
    )
    expect(lines).toContain(
      'HAPPY,LONELY,False,True,pearson_r,-0.52,,,,0.95,none,54,55.5,120,12,108,none,w_c1,False,False',
    )
    expect(lines[lines.length - 1]).toBe('HAPPY,sfi,True,False,,,,,,,,,,,,,,,,')
  })
})
