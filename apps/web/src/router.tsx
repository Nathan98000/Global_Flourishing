import {
  Link,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from '@tanstack/react-router'

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
        <a href={DATA_CITATION_URL}>
          Global Flourishing Study, Waves 1&ndash;2 (2023&ndash;2024)
        </a>
        , Center for Open Science / Gallup / Harvard Human Flourishing Program / Baylor Institute
        for Global Human Flourishing.
      </footer>
    </div>
  ),
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => (
    <section>
      <h2>Atlas</h2>
      <p>
        Explore wellbeing across 23 countries and 207,919 respondents, 2023&ndash;2024. Charts
        arrive in Phase 4; this is the Phase 0 scaffold.
      </p>
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
        interval; cells with n &lt; 50 are suppressed. Associations, not causes.
      </p>
    </section>
  ),
})

const routeTree = rootRoute.addChildren([indexRoute, methodsRoute])

export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, history })
}
