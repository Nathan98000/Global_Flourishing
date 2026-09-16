import { getRouteApi } from '@tanstack/react-router'
import { EmptyState } from '../components/EmptyState'

const route = getRouteApi('/codebook/$name')

export function CodebookDetailView() {
  const { name } = route.useParams()
  return (
    <section>
      <h2>{name}</h2>
      <EmptyState title="Variable details land later in this stack">
        <p>Wording, value labels, waves and missingness for {name}.</p>
      </EmptyState>
    </section>
  )
}
