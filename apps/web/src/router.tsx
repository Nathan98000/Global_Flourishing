import {
  Link,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from '@tanstack/react-router'
import { useApiHealth } from './api/health'

const DATA_CITATION_URL = 'https://doi.org/10.17605/OSF.IO/3JTZ8'

const rootRoute = createRootRoute({
  component: () => (
    <div className="layout">
      <header>
        <h1>Flourish Atlas</h1>
        <nav aria-label="Main">
          <Link to="/">Atlas</Link>
          <Link to="/methods">Methods</Link>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
      <footer>
        Data:{' '}
        <a href={DATA_CITATION_URL}>Global Flourishing Study, Waves 1&ndash;2 (2023&ndash;2024)</a>,
        Center for Open Science / Gallup / Harvard Human Flourishing Program / Baylor Institute for
        Global Human Flourishing. {/* Filled from data/manifest.json in Phase 1 */} data version:
        &mdash;
      </footer>
    </div>
  ),
  notFoundComponent: () => (
    <section>
      <h2>Page not found</h2>
      <p>
        Nothing lives at this address. <Link to="/">Back to the Atlas</Link>.
      </p>
    </section>
  ),
})

function ApiStatus() {
  const health = useApiHealth()
  if (health.isPending) return <p aria-live="polite">API: checking&hellip;</p>
  if (health.isError || health.data.status !== 'ok')
    return <p aria-live="polite">API unreachable</p>
  const sha = health.data.git_sha
  return (
    <p aria-live="polite">
      API: {health.data.status} &middot; v{health.data.version}
      {sha ? ` · sha ${sha.slice(0, 7)}` : ''}
    </p>
  )
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => (
    <section>
      <h2>Atlas</h2>
      <p>
        Explore the Global Flourishing Study: wellbeing across 23 countries and 207,919 respondents,
        2023&ndash;2024, with survey weights, sample sizes, and confidence intervals on every
        number. Charts arrive in Phase 4; this is the Phase 0 scaffold.
      </p>
      <ApiStatus />
    </section>
  ),
})

const methodsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/methods',
  component: () => (
    <section>
      <h2>Methods</h2>
      <p>
        Every estimate will show its survey weight, unweighted n, and a design-based confidence
        interval; cells with n &lt; 50 are suppressed. Associations, not causes. Full write-up
        arrives in Phase 4.
      </p>
    </section>
  ),
})

const routeTree = rootRoute.addChildren([indexRoute, methodsRoute])

export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, history })
}
