// US States (Phase 5) — plumbing stub: the route, its URL state and the
// warm-up ping are wired; the view itself lands in the next PR of the
// stack. Says so plainly rather than rendering a dead page.

import { getRouteApi } from '@tanstack/react-router'
import { useWarmApi } from '../api/warm'
import { EmptyState } from '../components/EmptyState'
import { InvalidParamsNotice } from '../components/Notice'

const route = getRouteApi('/states')

export function StatesView() {
  useWarmApi()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  return (
    <section>
      <h2>US States</h2>
      <InvalidParamsNotice
        invalid={search.invalid}
        onDismiss={() =>
          void navigate({
            search: { invalid: undefined, invalidRaw: undefined } as never,
            replace: true,
          })
        }
      />
      <EmptyState title="Being built">
        <p>
          This view — state-by-state estimates on the state-calibrated weights — is on its way; its
          charts arrive in the next release.
        </p>
      </EmptyState>
    </section>
  )
}
