// Download names in words (ADR-0016). One helper names every CSV and PNG:
//   flourish-atlas_<measure>_<view>_<waves>[_by-<breakdown>][_<country>].<ext>
// Each part is a lowercase ASCII slug of its display text — diacritics
// stripped, so Türkiye becomes turkiye — never a code and never the data
// version. The server's CSV route (export.py `_filename`) produces the
// same string for the same view from the catalog's display name; a test
// on each side pins one identical example.

export interface ExportName {
  /** The measure's display name ("Secure Flourishing Index"). */
  measure: string
  /** The view in words ("By country", "Change", "Compare", "By state"). */
  view: string
  /** The wave or waves in words ("2023", "2023 to 2024", "Midyear"). */
  waves: string
  /** A breakdown's display name ("Gender") when the rows are split by one. */
  breakdown?: string
  /** One country's name when the view is about a single country. */
  country?: string
}

/** "Türkiye" → "turkiye", "Age band" → "age-band", "2023 to 2024" → "2023-to-2024". */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/['’]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function exportFilename(name: ExportName, ext: 'csv' | 'png'): string {
  const parts = [
    'flourish-atlas',
    slugify(name.measure),
    slugify(name.view),
    slugify(name.waves),
    name.breakdown ? `by-${slugify(name.breakdown)}` : '',
    name.country ? slugify(name.country) : '',
  ].filter(Boolean)
  return `${parts.join('_')}.${ext}`
}
