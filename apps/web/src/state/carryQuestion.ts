// The question travels (H10, ADR-0033): the nav's links to the pages that
// chart one question — the Atlas, Change, US States and Segments — carry
// the question in view, and its year where the page takes one, when that
// page can show it; Correlates, What Matters and Methods keep plain
// links. Only the links' targets change: no parameter is renamed, and
// every old link still opens a view.

import { useLocation } from '@tanstack/react-router'
import { useEstimates } from '../api/estimates'
import type { Wave } from '../api/types'
import { useVariables } from '../api/variables'
import { US_COUNTRY_CODE } from '../views/stateRows'
import { ATLAS_DEFAULTS, atlasRequest } from './search'

/** The pages whose URL names a question (`outcome`), and those of them
 * that name its year (`wave`). */
const QUESTION_PAGES: readonly string[] = ['/', '/change', '/states', '/segments']
const YEAR_PAGES: readonly string[] = ['/', '/states', '/segments']

/** What a nav link to `to` carries: its search, or undefined for a plain
 * link. */
export type CarriedSearch = (to: string) => Record<string, string> | undefined

export function useCarriedQuestion(): CarriedSearch {
  const { pathname, search } = useLocation({
    select: (location) => ({
      pathname: location.pathname,
      search: location.search as Record<string, unknown>,
    }),
  })
  const variables = useVariables()
  const outcome =
    QUESTION_PAGES.includes(pathname) && typeof search['outcome'] === 'string'
      ? search['outcome']
      : undefined
  const variable = outcome !== undefined ? variables.data?.byName[outcome] : undefined
  const asked = variable?.servable ? variable.waves_available : []
  // The year in view where the question was asked then; else the first
  // year it was asked — what the target can show.
  const inView =
    YEAR_PAGES.includes(pathname) && typeof search['wave'] === 'string' ? search['wave'] : undefined
  const wave = inView !== undefined && asked.includes(inView) ? inView : asked[0]
  // US States charts a question the United States answered: the
  // question's by-country file says whether it has the US — read where it
  // is already loaded (the Atlas, Segments), never fetched for the nav;
  // not known, the link stays plain.
  const byCountry = useEstimates(
    variable?.servable && wave !== undefined && pathname !== '/states'
      ? atlasRequest({ ...ATLAS_DEFAULTS, outcome: variable.name, wave: wave as Wave }, variable)
      : null,
    { cachedOnly: true },
  )
  const usAnswered =
    pathname === '/states' ||
    (byCountry.data?.response.rows ?? []).some(
      (row) => Number(row.group['country_code']) === US_COUNTRY_CODE && row.estimate !== null,
    )
  return (to) => {
    if (variable === undefined || !variable.servable || wave === undefined) return undefined
    const withYear = { outcome: variable.name, wave }
    if (to === '/' || to === '/segments') return withYear
    if (to === '/states') return usAnswered ? withYear : undefined
    // Change compares a question asked in two years; it takes no year.
    if (to === '/change') return asked.length >= 2 ? { outcome: variable.name } : undefined
    return undefined
  }
}
