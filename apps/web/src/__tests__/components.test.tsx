// The shared primitives: suppression rendered in place, errors rendered
// distinctly, coverage summarized honestly.

import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { ApiError, NetworkError } from '../api/errors'
import { CoverageBanner } from '../components/CoverageBanner'
import { ErrorState } from '../components/ErrorState'
import { EstimateTable } from '../components/EstimateTable'
import { Stat } from '../components/Stat'
import { coverageFromEstimates, summarize, summarizeCoverage } from '../coverage'
import { attendVariable, testMeta, testResponse, testRow } from '../test-utils/fixtures'
import { renderWithRouter } from '../test-utils/router'
import type { MissingnessRow } from '../api/types'

describe('Stat', () => {
  test('an estimate never appears without CI, n and weight', () => {
    render(<Stat row={testRow()} />)
    expect(screen.getByText('7.21')).toBeInTheDocument()
    expect(screen.getByText(/\[7\.10, 7\.32\]/)).toBeInTheDocument()
    expect(screen.getByText(/n = 1,204 · w_c1/)).toBeInTheDocument()
  })

  test('a small cell appears with its n and no flag (ADR-0011)', () => {
    render(<Stat row={testRow({ n: 12 })} />)
    expect(screen.getByText('7.21')).toBeInTheDocument()
    expect(screen.getByText(/n = 12/)).toBeInTheDocument()
    expect(screen.queryByText(/withheld|small cell/)).toBeNull()
  })
})

describe('ErrorState', () => {
  test('renders the 422 message list verbatim', () => {
    const details = ['HAPPY is not asked at MY; it is available at Y1, Y2', 'stat must be one of …']
    render(<ErrorState error={new ApiError('validation', 422, details)} />)
    expect(screen.getByRole('alert')).toHaveTextContent('The API rejected this query')
    for (const message of details) expect(screen.getByText(message)).toBeInTheDocument()
  })

  test('503, 429 and network failure are three different messages', () => {
    const { rerender } = render(<ErrorState error={new ApiError('no-data', 503, [])} />)
    expect(screen.getByRole('alert')).toHaveTextContent('no data build')
    rerender(<ErrorState error={new ApiError('rate-limit', 429, [], 30)} />)
    expect(screen.getByRole('alert')).toHaveTextContent('about 30s')
    rerender(<ErrorState error={new NetworkError(new TypeError('x'))} />)
    // Plain words, not engineer words (F6).
    expect(screen.getByRole('alert')).toHaveTextContent('Live data service is offline')
    expect(screen.getByRole('alert')).toHaveTextContent('standard views still work')
  })
})

describe('EstimateTable', () => {
  test('labels come from meta; a small cell keeps its estimate and n', () => {
    const response = testResponse(
      [
        testRow({ group: { country_code: 22 } }),
        // A 31-person cell with no computable interval (lone PSU): shown,
        // with its n, the interval as an em dash — never a gap (ADR-0011).
        testRow({
          group: { country_code: 1 },
          estimate: 6.4,
          se: null,
          ci_lo: null,
          ci_hi: null,
          n: 31,
        }),
      ],
      { by: ['country_code'] },
    )
    render(<EstimateTable response={response} meta={testMeta} />)
    expect(screen.getByRole('columnheader', { name: 'Country' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '95% CI' })).toBeInTheDocument()
    expect(screen.getByText('United States')).toBeInTheDocument()
    expect(screen.getByText('Testland')).toBeInTheDocument()
    expect(screen.getByText('6.40')).toBeInTheDocument()
    expect(screen.getByText('31')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument() // the missing interval
    expect(screen.queryByText(/withheld/)).toBeNull()
  })

  test('breakdown levels use the served labels', () => {
    const response = testResponse([testRow({ group: { country_code: 1, gender: 2 } })], {
      by: ['country_code', 'gender'],
    })
    render(<EstimateTable response={response} meta={testMeta} />)
    expect(screen.getByRole('columnheader', { name: 'Gender' })).toBeInTheDocument()
    expect(screen.getByText('Female')).toBeInTheDocument()
  })

  test('level sub-rows appear for distributions', () => {
    const response = testResponse(
      [
        testRow({ group: { country_code: 1 }, level: 0, stat: 'distribution', estimate: 0.05 }),
        testRow({ group: { country_code: 1 }, level: 1, stat: 'distribution', estimate: 0.07 }),
      ],
      { stat: 'distribution', outcome: attendVariable.name },
    )
    render(<EstimateTable response={response} meta={testMeta} />)
    expect(screen.getByRole('columnheader', { name: 'Level' })).toBeInTheDocument()
    expect(screen.getByText('5.0%')).toBeInTheDocument()
  })
})

describe('CoverageBanner', () => {
  const rows: MissingnessRow[] = [
    {
      wave: 'Y1',
      country_code: 1,
      n_present: 100,
      n_valid: 95,
      n_skipped: 5,
      n_dk: 0,
      n_refused: 0,
    },
    {
      wave: 'Y1',
      country_code: 22,
      n_present: 200,
      n_valid: 190,
      n_skipped: 10,
      n_dk: 0,
      n_refused: 0,
    },
    {
      wave: 'Y2',
      country_code: 1,
      n_present: 23,
      n_valid: 22,
      n_skipped: 1,
      n_dk: 0,
      n_refused: 0,
    },
    {
      wave: 'Y2',
      country_code: 22,
      n_present: 180,
      n_valid: 175,
      n_skipped: 5,
      n_dk: 0,
      n_refused: 0,
    },
  ]

  const renderBanner = (wave: 'MY' | 'Y2') =>
    renderWithRouter(
      <CoverageBanner
        wave={wave}
        summary={summarizeCoverage(rows, wave)}
        countries={testMeta.countries}
      />,
    )

  test('names the extremes in plain words and offers the per-country table', async () => {
    renderBanner('Y2')
    const banner = await screen.findByRole('complementary')
    expect(banner).toHaveTextContent('Not everyone came back for the 2024 round')
    expect(banner).toHaveTextContent('23%')
    expect(banner).toHaveTextContent('Testland')
    expect(banner).toHaveTextContent('90%')
    expect(banner).toHaveTextContent('United States')
    expect(screen.getByText('Follow-up by country')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Why this matters' })).toBeInTheDocument()
  })

  test('renders nothing without comparable waves', async () => {
    renderBanner('MY')
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull())
  })
})

describe('coverageFromEstimates', () => {
  test('derived scores get coverage from per-country n against Wave 1', () => {
    const atY2 = [
      testRow({ group: { country_code: 1 }, n: 23 }),
      testRow({ group: { country_code: 22 }, n: 180 }),
    ]
    const atY1 = [
      testRow({ group: { country_code: 1 }, n: 100 }),
      testRow({ group: { country_code: 22 }, n: 200 }),
    ]
    const summary = summarize(coverageFromEstimates(atY2, atY1))
    expect(summary.lowest?.country_code).toBe(1)
    expect(summary.lowest?.fraction).toBeCloseTo(0.23)
    expect(summary.highest?.fraction).toBeCloseTo(0.9)
  })

  test('proportions take the largest cell per country, suppressed rows still count', () => {
    const atWave = [
      testRow({ group: { country_code: 1 }, level: 0, n: 80 }),
      testRow({ group: { country_code: 1 }, level: 1, n: 80 }),
      testRow({ group: { country_code: 22 }, suppressed: true, estimate: null, n: 40 }),
    ]
    const baseline = [
      testRow({ group: { country_code: 1 }, n: 100 }),
      testRow({ group: { country_code: 22 }, n: 100 }),
    ]
    const coverage = coverageFromEstimates(atWave, baseline)
    expect(coverage.find((entry) => entry.country_code === 1)?.presentAtWave).toBe(80)
    expect(coverage.find((entry) => entry.country_code === 22)?.fraction).toBeCloseTo(0.4)
  })

  test('an empty wave is "no coverage story", not 0%', () => {
    expect(coverageFromEstimates([], [testRow()])).toEqual([])
  })
})
