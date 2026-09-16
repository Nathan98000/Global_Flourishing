// The shared primitives: suppression rendered in place, errors rendered
// distinctly, coverage summarized honestly.

import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { ApiError, NetworkError } from '../api/errors'
import { CoverageBanner } from '../components/CoverageBanner'
import { ErrorState } from '../components/ErrorState'
import { EstimateTable } from '../components/EstimateTable'
import { Stat } from '../components/Stat'
import { attendVariable, testMeta, testResponse, testRow } from '../test-utils/fixtures'
import type { MissingnessRow } from '../api/types'

describe('Stat', () => {
  test('an estimate never appears without CI, n and weight', () => {
    render(<Stat row={testRow()} threshold={50} />)
    expect(screen.getByText('7.21')).toBeInTheDocument()
    expect(screen.getByText(/\[7\.10, 7\.32\]/)).toBeInTheDocument()
    expect(screen.getByText(/n = 1,204 · w_c1/)).toBeInTheDocument()
  })

  test('suppressed shows the withheld state with its n', () => {
    render(<Stat row={testRow({ suppressed: true, estimate: null, n: 12 })} threshold={50} />)
    expect(screen.getByText(/withheld \(n = 12, below 50\)/)).toBeInTheDocument()
    expect(screen.queryByText('7.21')).not.toBeInTheDocument()
  })

  test('flagged cells carry the small-cell marker', () => {
    render(<Stat row={testRow({ flagged: true, n: 73 })} threshold={50} />)
    expect(screen.getByText(/small cell, n = 73/)).toBeInTheDocument()
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
    expect(screen.getByRole('alert')).toHaveTextContent('unreachable')
  })
})

describe('EstimateTable', () => {
  test('labels come from meta and suppressed rows stay in the table', () => {
    const response = testResponse(
      [
        testRow({ group: { country_code: 22 } }),
        testRow({ group: { country_code: 1 }, suppressed: true, estimate: null, n: 31 }),
      ],
      { by: ['country_code'] },
    )
    render(<EstimateTable response={response} meta={testMeta} />)
    expect(screen.getByRole('columnheader', { name: 'Country' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '95% CI' })).toBeInTheDocument()
    expect(screen.getByText('United States')).toBeInTheDocument()
    expect(screen.getByText('Testland')).toBeInTheDocument()
    expect(screen.getByText(/withheld \(n = 31/)).toBeInTheDocument()
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

  test('names the extremes and offers the per-country table', () => {
    render(<CoverageBanner wave="Y2" missingness={rows} countries={testMeta.countries} />)
    const banner = screen.getByRole('complementary')
    expect(banner).toHaveTextContent('23% in Testland')
    expect(banner).toHaveTextContent('90% in United States')
    expect(screen.getByText('Coverage by country')).toBeInTheDocument()
  })

  test('renders nothing without comparable waves', () => {
    const { container } = render(
      <CoverageBanner wave="MY" missingness={rows} countries={testMeta.countries} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
