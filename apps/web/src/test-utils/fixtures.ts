// Synthetic in-memory fixtures for unit tests (never copied from the real
// release — CLAUDE.md). File-based fixtures from `make web-fixtures` are
// separate (test-utils/staticTier.ts); these are for tests that mock fetch.

import type {
  EstimateResponse,
  EstimateRow,
  Meta,
  ResponseMeta,
  VariableSummary,
} from '../api/types'

export const testMeta: Meta = {
  data_version: 'test.1.0.0',
  git_sha: null,
  countries: [
    { code: 1, name: 'Testland', iso3: 'TST' },
    { code: 22, name: 'United States', iso3: 'USA' },
  ],
  waves: ['Y1', 'MY', 'Y2'],
  weight_table: [],
  suppression: { threshold: 50, flag_below: 100 },
  ci_level: 0.95,
  breakdowns: [
    'age_band',
    'country_code',
    'education_3',
    'employment',
    'gender',
    'income_quintile',
    'marital_status',
    'urban_rural',
  ],
  breakdown_labels: {
    age_band: {
      display_name: 'Age band',
      levels: [
        { value: '18-24', label: '18–24' },
        { value: '25-29', label: '25–29' },
      ],
    },
    gender: {
      display_name: 'Gender',
      levels: [
        { value: 1, label: 'Male' },
        { value: 2, label: 'Female' },
      ],
    },
  },
  families: ['demographics', 'wellbeing'],
}

export const happyVariable: VariableSummary = {
  name: 'HAPPY',
  display_name: 'Happiness',
  label: 'Happiness (label)',
  family: 'wellbeing',
  scale_type: 'scale_0_10',
  direction: 'higher_better',
  min: 0,
  max: 10,
  waves_available: ['Y1', 'Y2'],
  is_country_specific: false,
  is_derived: false,
  servable: true,
  default_stat: 'mean',
}

export const sfiVariable: VariableSummary = {
  name: 'sfi',
  display_name: 'Secure Flourishing Index',
  label: 'Mean of the 12 SFI items, 0–10.',
  family: 'derived',
  scale_type: 'scale_0_10',
  direction: 'higher_better',
  min: 0,
  max: 10,
  waves_available: ['Y1', 'Y2'],
  is_country_specific: false,
  is_derived: true,
  servable: true,
  default_stat: 'mean',
}

export const attendVariable: VariableSummary = {
  ...happyVariable,
  name: 'ATTEND_SVCS',
  display_name: 'Service attendance',
  family: 'religion',
  scale_type: 'ordinal',
  direction: 'none',
  min: 1,
  max: 3,
  default_stat: 'proportion',
}

export function testRow(overrides: Partial<EstimateRow> = {}): EstimateRow {
  return {
    group: { country_code: 1 },
    stat: 'mean',
    estimate: 7.21,
    se: 0.055,
    ci_lo: 7.1,
    ci_hi: 7.32,
    ci_level: 0.95,
    ci_method: 'normal',
    n: 1204,
    sum_w: 1189.4,
    n_psu: 120,
    n_strata: 12,
    df: 108,
    se_method: 'taylor',
    weight: 'w_c1',
    suppressed: false,
    flagged: false,
    ...overrides,
  }
}

export function testResponseMeta(overrides: Partial<ResponseMeta> = {}): ResponseMeta {
  return {
    data_version: 'test.1.0.0',
    outcome: 'HAPPY',
    scale_type: 'scale_0_10',
    direction: 'higher_better',
    stat: 'mean',
    waves: ['Y1'],
    scope: 'global',
    oriented: false,
    weight_key: 'y1',
    weight: 'w_c1',
    se_method: 'taylor',
    ci_level: 0.95,
    suppression: { threshold: 50, flag_below: 100 },
    n_frame: 2400,
    n_valid: 2361,
    by: ['country_code'],
    filters: {},
    ...overrides,
  }
}

export function testResponse(
  rows: EstimateRow[],
  metaOverrides: Partial<ResponseMeta> = {},
): EstimateResponse {
  return { meta: testResponseMeta(metaOverrides), rows }
}
