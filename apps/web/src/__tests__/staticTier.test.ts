// Against the real exporter's bytes (make web-fixtures): the client's
// path computation mirrors the exporter's file naming, the catalog tier
// parses as the generated types, and the client-side CSV fallback
// matches a real /v1/export.csv response for the same query.

import { describe, expect, test } from 'vitest'
import { staticPathFor } from '../api/estimates'
import type { EstimateResponse, Meta, VariableList } from '../api/types'
import { responseToCsv } from '../export/csv'
import { fixtureTierPresent, readFixtureJson, readFixtureText } from '../test-utils/staticTier'

interface IndexFile {
  data_version: string
  catalog_files: string[]
  files: {
    path: string
    outcome: string
    wave?: string
    stat?: string
    by?: string[]
    kind?: string
  }[]
}

if (!fixtureTierPresent()) {
  throw new Error('fixture tier missing — run `make web-fixtures` before vitest')
}

const meta = readFixtureJson<Meta>('meta.json')
const variables = readFixtureJson<VariableList>('variables.json')
const index = readFixtureJson<IndexFile>('index.json')
const byName = new Map(variables.variables.map((variable) => [variable.name, variable]))

describe('the catalog tier', () => {
  test('meta.json has everything the app boots from, minus git_sha', () => {
    expect(meta.data_version).toBe('synthetic.0.0.1')
    expect(meta.countries.length).toBeGreaterThan(0)
    expect(meta.breakdowns).toContain('country_code')
    expect(meta.breakdown_labels['gender']?.levels[0]).toEqual({ value: 1, label: 'Male' })
    expect('git_sha' in meta).toBe(false)
    expect(meta.suppression).toEqual({ threshold: 0, flag_below: 0 })
  })

  test('variables.json carries default_stat and servability', () => {
    expect(byName.get('HAPPY')?.default_stat).toBe('mean')
    expect(byName.get('ATTEND_SVCS')?.default_stat).toBe('proportion')
    expect(byName.get('INCOME')?.servable).toBe(false)
    expect(byName.get('sfi')?.is_derived).toBe(true)
  })

  test('every variable detail file parses and matches its summary', () => {
    for (const summary of variables.variables.slice(0, 8)) {
      const detail = readFixtureJson<Record<string, unknown>>(`v1/${summary.name}/variable.json`)
      expect(detail['name']).toBe(summary.name)
      expect(detail['default_stat']).toBe(summary.default_stat)
    }
  })
})

describe('staticPathFor mirrors the exporter', () => {
  test('every estimate file the exporter wrote is a path the client computes', () => {
    const estimateFiles = index.files.filter((file) => file.kind === undefined)
    expect(estimateFiles.length).toBeGreaterThan(20)
    for (const file of estimateFiles) {
      const variable = byName.get(file.outcome)
      expect(variable, file.outcome).toBeDefined()
      const path = staticPathFor(
        {
          outcome: file.outcome,
          wave: file.wave as 'Y1' | 'MY' | 'Y2',
          stat: file.stat as 'mean' | 'proportion' | 'distribution',
          by: file.by ?? [],
        },
        { variable, breakdowns: meta.breakdowns },
      )
      expect(path, `${file.path} should be computable`).toBe(file.path)
    }
  })

  test('and computed paths point at files that really exist', () => {
    const path = staticPathFor(
      { outcome: 'HAPPY', wave: 'Y1', stat: 'mean', by: ['country_code'] },
      { variable: byName.get('HAPPY'), breakdowns: meta.breakdowns },
    )
    expect(path).toBe('v1/HAPPY/Y1/mean_by-country_code.json')
    const envelope = readFixtureJson<EstimateResponse>(path as string)
    expect(envelope.rows.length).toBeGreaterThan(0)
    expect(envelope.meta.weight).toBe('w_c1')
  })
})

describe('CSV parity (client fallback vs the live server)', () => {
  test('the client CSV for the same query equals /v1/export.csv', () => {
    const envelope = readFixtureJson<EstimateResponse>('v1/HAPPY/Y1/mean_by-country_code.json')
    const clientCsv = responseToCsv(envelope)
    const serverCsv = readFixtureText('_fixtures/export-sample.csv')

    const metaLines = (csv: string) => csv.split('\n').filter((line) => line.startsWith('#'))
    const headerRow = (csv: string) => csv.split('\n').find((line) => !line.startsWith('#'))
    expect(metaLines(clientCsv)).toEqual(metaLines(serverCsv))
    expect(headerRow(clientCsv)).toBe(headerRow(serverCsv))
    // Same envelope in, same bytes out.
    expect(clientCsv).toBe(serverCsv)
  })
})
