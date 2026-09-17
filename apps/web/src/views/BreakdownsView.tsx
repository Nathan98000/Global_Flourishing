// Placeholder while the chart library lands in the next PR of this
// stack; the URL state (outcome, wave, by, sort) is already live.

import { getRouteApi } from '@tanstack/react-router'
import { EmptyState } from '../components/EmptyState'
import { InvalidParamsNotice } from '../components/Notice'
import { breakdownsSearchParams } from '../state/search'

const route = getRouteApi('/breakdowns')

export function BreakdownsView() {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  return (
    <section>
      <h2>Breakdowns</h2>
      <InvalidParamsNotice
        invalid={search.invalid}
        onDismiss={() => {
          void navigate({ search: breakdownsSearchParams(search) as never, replace: true })
        }}
      />
      <EmptyState title="Small multiples land with the chart library">
        <p>
          This view will show {search.outcome} × {search.by.join(' × ')} by country. It arrives in
          the next PR of the Phase 4 stack.
        </p>
      </EmptyState>
    </section>
  )
}
