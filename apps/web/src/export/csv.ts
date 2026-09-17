// Client-side CSV, byte-compatible with /v1/export.csv (serialize.py):
// the same `#` meta comment lines, the same column order, Python-style
// value rendering. Used only when the view was served statically AND the
// API is unreachable — and pinned to a real server response by the
// parity test against _fixtures/export-sample.csv.

import type { EstimateResponse, EstimateRow } from '../api/types'

const SUBROW_KEYS = ['level', 'p', 'leg', 'from_level', 'to_level', 'measure'] as const

const RECORD_FIELDS = [
  'stat',
  'estimate',
  'se',
  'ci_lo',
  'ci_hi',
  'ci_level',
  'ci_method',
  'n',
  'sum_w',
  'n_psu',
  'n_strata',
  'df',
  'se_method',
  'weight',
  'suppressed',
  'flagged',
] as const

// ResponseMeta model-field order (schemas.py), minus the two specials.
const META_FIELDS = [
  'data_version',
  'outcome',
  'scale_type',
  'direction',
  'stat',
  'waves',
  'scope',
  'oriented',
  'weight_key',
  'weight',
  'se_method',
  'ci_level',
  'n_frame',
  'n_valid',
  'by',
] as const

/** Python str() for the values that appear here. */
function pythonStr(value: unknown): string {
  if (value === null || value === undefined) return 'None'
  if (value === true) return 'True'
  if (value === false) return 'False'
  return String(value)
}

/** csv module rendering: empty for None, Python str() otherwise. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  return pythonStr(value)
}

function quoted(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

export function responseToCsv(response: EstimateResponse): string {
  const meta = response.meta
  const lines: string[] = []
  for (const field of META_FIELDS) {
    const value = meta[field]
    const rendered = Array.isArray(value) ? value.map(String).join(',') : pythonStr(value)
    lines.push(`# ${field}: ${rendered}`)
  }
  if (meta.suppression.threshold === 0 && meta.suppression.flag_below === 0) {
    // ADR-0011 default: every cell is shown (byte-identical to the API).
    lines.push('# suppression: none (all cells shown)')
  } else {
    lines.push(
      `# suppression: n<${meta.suppression.threshold} suppressed, ` +
        `n<${meta.suppression.flag_below} flagged`,
    )
  }
  for (const [column, values] of Object.entries(meta.filters)) {
    lines.push(`# filter ${column}: ${values.map(String).join(',')}`)
  }

  const groupColumns = meta.by
  const subrowKeys = SUBROW_KEYS.filter((key) =>
    response.rows.some((row) => row[key] !== null && row[key] !== undefined),
  )
  lines.push([...groupColumns, ...subrowKeys, ...RECORD_FIELDS].map(quoted).join(','))
  for (const row of response.rows) {
    lines.push(
      [
        ...groupColumns.map((column) => cell(row.group[column])),
        ...subrowKeys.map((key) => cell(row[key])),
        ...RECORD_FIELDS.map((field) => cell(row[field as keyof EstimateRow])),
      ]
        .map(quoted)
        .join(','),
    )
  }
  return `${lines.join('\n')}\n`
}

/** Mirror of the server's Content-Disposition filename (export.py). */
export function csvFilename(
  outcome: string,
  wave: string,
  stat: string,
  dataVersion: string | null,
): string {
  const raw = `flourish_${outcome}_${wave}_${stat}_${dataVersion ?? 'nodata'}`
  return `${raw.replace(/[^A-Za-z0-9._-]/g, '-')}.csv`
}

export function downloadTextFile(name: string, text: string, type = 'text/csv'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}
