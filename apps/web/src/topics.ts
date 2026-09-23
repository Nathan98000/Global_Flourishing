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

// --- What Matters (Phase 5) --------------------------------------------------
// Navigation copy for the midyear family: which of its items form the
// ranking, and the two prepared crossings. Codes only — every display
// name, wording and value label still comes from the catalog.

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
 * set (in the brief's order) and the chartable rest (A–Z). */
export function splitMidyear(variables: readonly VariableSummary[]): {
  ranking: VariableSummary[]
  chartable: VariableSummary[]
} {
  const midyear = variables.filter(
    (variable) => variable.family === MIDYEAR_FAMILY && variable.servable,
  )
  const byName = new Map(midyear.map((variable) => [variable.name, variable]))
  const ranking = IMPORTANCE_ITEMS.map((name) => byName.get(name)).filter(
    (variable): variable is VariableSummary => variable !== undefined,
  )
  const chartable = midyear
    .filter((variable) => !IMPORTANCE_ITEMS.includes(variable.name))
    .sort((a, b) => a.display_name.localeCompare(b.display_name))
  return { ranking, chartable }
}

/** The two prepared crossings — each an ordinary breakdown request of
 * `outcome` by `by`, made only when the catalog offers both at one
 * wave. The framing is the Methods page's: associated with, not caused
 * by. */
export interface Crossing {
  key: string
  title: string
  outcome: string
  by: string
}

export const WHAT_MATTERS_CROSSINGS: readonly Crossing[] = [
  {
    key: 'media',
    title: 'Time on social media and mental health',
    outcome: 'MENTAL_HEALTH',
    by: 'TIME_MEDIA',
  },
  {
    key: 'food',
    title: 'Running out of food and financial stability',
    outcome: 'sfi_financial',
    by: 'FOOD_INSECURE',
  },
]

/** The wave at which both sides of a crossing were asked, if any. */
export function crossingWave(
  crossing: Crossing,
  byName: Record<string, VariableSummary | undefined>,
): string | undefined {
  const outcome = byName[crossing.outcome]
  const by = byName[crossing.by]
  if (!outcome || !by) return undefined
  return outcome.waves_available.find((wave) => by.waves_available.includes(wave))
}
