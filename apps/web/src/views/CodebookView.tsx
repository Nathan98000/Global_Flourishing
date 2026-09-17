// Placeholder while the codebook ships in the last PR of this stack; the
// URL state (q, family, wave, scale) is already live.

import { getRouteApi } from '@tanstack/react-router'
import { EmptyState } from '../components/EmptyState'
import { InvalidParamsNotice } from '../components/Notice'
import { codebookSearchParams } from '../state/search'

const route = getRouteApi('/codebook')

export function CodebookView() {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  return (
    <section>
      <h2>Codebook</h2>
      <InvalidParamsNotice
        invalid={search.invalid}
        onDismiss={() => {
          void navigate({ search: codebookSearchParams(search) as never, replace: true })
        }}
      />
      <EmptyState title="The searchable codebook lands later in this stack">
        <p>Search, families, wording, value labels and missingness — with a “chart this” link.</p>
      </EmptyState>
    </section>
  )
}
