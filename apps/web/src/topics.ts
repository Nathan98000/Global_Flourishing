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
