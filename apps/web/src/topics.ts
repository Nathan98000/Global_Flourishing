// Topic names for the catalog families (owner decision 1, 17 Sept 2026):
// the picker groups the catalog's families under these display names, in
// this order. This is navigation copy — the one place the client names
// something the server doesn't; every data label (display names, value
// labels, wordings, directions) still comes from the server. A family
// the map doesn't know falls back to a prettified code and sorts last,
// so a new pipeline family can never break the picker.

import type { VariableSummary } from './api/types'

const TOPIC_NAMES: Record<string, string> = {
  derived: 'Flourishing index & its domains',
  sfi: 'Flourishing index questions',
  wellbeing: 'Wellbeing',
  mental_health: 'Mental health',
  physical_health: 'Physical health & habits',
  social_civic: 'Social & civic life',
  character: 'Character & personality',
  religion: 'Religion & spirituality',
  politics: 'Politics & government',
  childhood: 'Childhood',
  midyear: 'What matters to people',
  demographics: 'Demographics',
}

const TOPIC_ORDER = Object.keys(TOPIC_NAMES)

export function topicName(family: string): string {
  const named = TOPIC_NAMES[family]
  if (named) return named
  const pretty = family.replace(/_/g, ' ')
  return pretty.charAt(0).toUpperCase() + pretty.slice(1)
}

/** Answer types in words (§9): the catalog's scale_type codes never
 * reach the page. Same prettify fallback as topicName, so an unknown
 * type cannot break the codebook. */
const SCALE_TYPE_NAMES: Record<string, string> = {
  scale_0_10: '0–10 scale',
  binary: 'Yes / no',
  ordinal: 'Ordered scale',
  nominal: 'Categories',
  count: 'Count',
}

export function scaleTypeName(scale: string): string {
  const named = SCALE_TYPE_NAMES[scale]
  if (named) return named
  const pretty = scale.replace(/_/g, ' ')
  return pretty.charAt(0).toUpperCase() + pretty.slice(1)
}

export interface Topic {
  family: string
  name: string
  /** Servable measures in this topic — what the measure select offers. */
  measures: VariableSummary[]
}

/** The topics, owner order first, unknown families after, empty ones dropped. */
export function topicsOf(variables: VariableSummary[]): Topic[] {
  const byFamily = new Map<string, VariableSummary[]>()
  for (const variable of variables) {
    if (!variable.servable) continue
    const bucket = byFamily.get(variable.family) ?? []
    bucket.push(variable)
    byFamily.set(variable.family, bucket)
  }
  const families = [...byFamily.keys()].sort((a, b) => {
    const ia = TOPIC_ORDER.indexOf(a)
    const ib = TOPIC_ORDER.indexOf(b)
    if (ia === -1 && ib === -1) return a.localeCompare(b)
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
  return families.map((family) => ({
    family,
    name: topicName(family),
    measures: (byFamily.get(family) ?? []).sort((a, b) =>
      a.display_name.localeCompare(b.display_name),
    ),
  }))
}

// --- Subtopics (ADR-0016) ----------------------------------------------------
// Display names for the catalog's subfamily codes (owner decision, 25 Sept
// 2026) — navigation copy like the topic names above. Which measures
// belong to which subtopic is the server's: `subfamily` rides on every
// variable summary. A code this map doesn't know falls back to a
// prettified code and sorts last, like an unknown family.

const SUBTOPIC_NAMES: Record<string, string> = {
  affiliation: 'Religious affiliation',
  beliefs: 'Beliefs & experiences',
  practice: 'Religious practice',
  daily_life: 'Religion in daily life',
  teachings: 'Importance of teachings, by tradition',
  teachings_country: "Importance of the country's main religion",
}

const SUBTOPIC_ORDER = Object.keys(SUBTOPIC_NAMES)

export function subtopicName(code: string): string {
  const named = SUBTOPIC_NAMES[code]
  if (named) return named
  const pretty = code.replace(/_/g, ' ')
  return pretty.charAt(0).toUpperCase() + pretty.slice(1)
}

export interface Subtopic {
  /** The catalog's subfamily code; '' for a topic's measures without one. */
  code: string
  name: string
  measures: VariableSummary[]
}

/** A topic's subtopics, owner order first, unknown codes after (A–Z),
 * each holding its measures A–Z. Empty when no measure of the topic
 * carries a subfamily, so a topic without subtopics renders unchanged;
 * in a topic that has them, a measure without one lists last under
 * "Other". */
export function subtopicsOf(measures: readonly VariableSummary[]): Subtopic[] {
  const byCode = new Map<string, VariableSummary[]>()
  for (const measure of measures) {
    const code = measure.subfamily ?? ''
    const bucket = byCode.get(code) ?? []
    bucket.push(measure)
    byCode.set(code, bucket)
  }
  if ([...byCode.keys()].every((code) => code === '')) return []
  const codes = [...byCode.keys()].sort((a, b) => {
    if (a === '') return 1
    if (b === '') return -1
    const ia = SUBTOPIC_ORDER.indexOf(a)
    const ib = SUBTOPIC_ORDER.indexOf(b)
    if (ia === -1 && ib === -1) return a.localeCompare(b)
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
  return codes.map((code) => ({
    code,
    name: code ? subtopicName(code) : 'Other',
    measures: (byCode.get(code) ?? []).sort((a, b) => a.display_name.localeCompare(b.display_name)),
  }))
}

// --- What Matters (Phase 5) --------------------------------------------------
// Navigation copy for the midyear family: which of its items form the
// ranking. Codes only — every display name, wording and value label
// still comes from the catalog.

export const MIDYEAR_FAMILY = 'midyear'

/** The seven importance items that form the What Matters ranking; the
 * family's other items are chartable on their own. */
export const IMPORTANCE_ITEMS: readonly string[] = [
  'MONEY',
  'GOOD_RELATION',
  'MEANINGFUL',
  'HEALTHY',
  'REL_LIFE',
  'HAPPY_IMPORT',
  'GOOD_PERSON',
]

/** The midyear family as the catalog serves it, split into the ranking
 * set (in the catalog's own order) and the chartable rest (A–Z). */
export function splitMidyear(variables: readonly VariableSummary[]): {
  ranking: VariableSummary[]
  chartable: VariableSummary[]
} {
  const midyear = variables.filter(
    (variable) => variable.family === MIDYEAR_FAMILY && variable.servable,
  )
  const ranking = midyear.filter((variable) => IMPORTANCE_ITEMS.includes(variable.name))
  const chartable = midyear
    .filter((variable) => !IMPORTANCE_ITEMS.includes(variable.name))
    .sort((a, b) => a.display_name.localeCompare(b.display_name))
  return { ranking, chartable }
}
