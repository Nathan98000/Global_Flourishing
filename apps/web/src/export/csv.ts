// Client-side CSV, byte-compatible with /v1/export.csv (serialize.py):
// the same `#` meta comment lines, the same column order, Python-style
// value rendering. Used only when the view was served statically AND the
// API is unreachable — and pinned to a real server response by the
// parity test against _fixtures/export-sample.csv.

import type {
  CorrelationsResponse,
  EstimateResponse,
  EstimateRow,
  PairResponse,
} from '../api/types'

const SUBROW_KEYS = ['predictor', 'level', 'p', 'leg', 'from_level', 'to_level', 'measure'] as const

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

/** A correlation table (/v1/correlations) as CSV: its own meta as `#`
 * lines, then one line per pair — both questions, whether they share
 * answers or rest on too few people, and the correlation's record (empty
 * where none was taken). Same value rendering as responseToCsv. */
export function correlationTableToCsv(table: CorrelationsResponse): string {
  const meta = table.meta
  const lines = [
    `# data_version: ${pythonStr(meta.data_version)}`,
    `# vars: ${meta.vars.join(',')}`,
    `# wave: ${meta.wave}`,
    `# stat: ${meta.stat}`,
    `# weight_key: ${meta.weight_key}`,
    `# weight: ${meta.weight}`,
    `# ci_level: ${pythonStr(meta.ci_level)}`,
    `# n_frame: ${meta.n_frame}`,
    `# min_n: ${meta.min_n}`,
    meta.suppression.threshold === 0 && meta.suppression.flag_below === 0
      ? '# suppression: none (all cells shown)'
      : `# suppression: n<${meta.suppression.threshold} suppressed, n<${meta.suppression.flag_below} flagged`,
    ...Object.entries(meta.filters).map(
      ([column, values]) => `# filter ${column}: ${values.map(String).join(',')}`,
    ),
  ]
  lines.push(['a', 'b', 'shares_answers', 'below_min_n', ...RECORD_FIELDS].map(quoted).join(','))
  for (const pair of table.pairs) {
    const row = pair.correlation
    lines.push(
      [
        pair.a,
        pair.b,
        pythonStr(pair.shares_answers),
        pythonStr(pair.below_min_n),
        ...RECORD_FIELDS.map((field) => (row ? cell(row[field as keyof EstimateRow]) : '')),
      ]
        .map(quoted)
        .join(','),
    )
  }
  return `${lines.join('\n')}\n`
}

/** Compare two's cross-tab (/v1/correlations/pair) as CSV: its meta as
 * `#` lines — the two questions, the correlation with its n, the flag
 * thresholds — then one line per cell: the column's answer, its share of
 * respondents and n, the row's answer, and the cell's record (its share
 * of the column, with CI and n), flagged or not. Same value rendering as
 * responseToCsv. */
export function pairToCsv(pair: PairResponse): string {
  const meta = pair.shares.meta
  const correlation = pair.correlation
  const lines = [
    `# data_version: ${pythonStr(meta.data_version)}`,
    `# x: ${pair.x}`,
    `# y: ${pair.y}`,
    `# waves: ${meta.waves.join(',')}`,
    `# weight_key: ${meta.weight_key}`,
    `# weight: ${meta.weight}`,
    `# se_method: ${meta.se_method}`,
    `# ci_level: ${pythonStr(meta.ci_level)}`,
    `# n_frame: ${meta.n_frame}`,
    `# n_valid: ${meta.n_valid}`,
    `# correlation: ${cell(correlation.estimate)} (${correlation.stat}, n=${correlation.n})`,
    `# cell_flag_below: ${pair.cell_flag_below}`,
    `# column_flag_below: ${pair.column_flag_below}`,
    meta.suppression.threshold === 0 && meta.suppression.flag_below === 0
      ? '# suppression: none (all cells shown)'
      : `# suppression: n<${meta.suppression.threshold} suppressed, n<${meta.suppression.flag_below} flagged`,
    ...Object.entries(meta.filters).map(
      ([column, values]) => `# filter ${column}: ${values.map(String).join(',')}`,
    ),
  ]
  lines.push(
    ['x', 'x_label', 'x_share', 'x_n', 'y', 'y_label', ...RECORD_FIELDS, 'cell_flagged']
      .map(quoted)
      .join(','),
  )
  const columns = new Map(pair.columns.map((column) => [column.code, column]))
  const rows = new Map(pair.rows.map((row) => [row.code, row]))
  pair.cells.forEach((entry, index) => {
    const record = pair.shares.rows[index]
    const column = columns.get(entry.x)
    lines.push(
      [
        String(entry.x),
        column?.label ?? '',
        cell(column?.share),
        cell(column?.n),
        String(entry.y),
        rows.get(entry.y)?.label ?? '',
        ...RECORD_FIELDS.map((field) => (record ? cell(record[field as keyof EstimateRow]) : '')),
        pythonStr(entry.flagged),
      ]
        .map(quoted)
        .join(','),
    )
  })
  return `${lines.join('\n')}\n`
}

export function downloadTextFile(name: string, text: string, type = 'text/csv'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}
