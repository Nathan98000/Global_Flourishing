import {
  Link,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  type RouterHistory,
  type SearchSchemaInput,
} from '@tanstack/react-router'
import { AppShell } from './components/AppShell'
import {
  atlasSearchParams,
  breakdownsSearchParams,
  codebookSearchParams,
  parseAtlasSearch,
  parseBreakdownsSearch,
  parseCodebookSearch,
} from './state/search'
import { parseSearchString, stringifySearch } from './state/searchCodec'
import { AtlasView } from './views/AtlasView'

// Serialization middleware: defaults never reach the address bar — the
// URL carries exactly what differs from the default view (§2.2). The
// cleaners accept partial input because the router also runs this while
// building Link hrefs from partial search objects.
function omitDefaults<T>(clean: (search: Partial<T>) => Record<string, unknown>) {
  return ({ search, next }: { search: T; next: (search: T) => T }): T =>
    next(clean(search as Partial<T>) as unknown as T)
}

const rootRoute = createRootRoute({
  component: AppShell,
  notFoundComponent: () => (
    <section>
      <h2>Page not found</h2>
      <p>
        Nothing lives at this address. <Link to="/">Back to the Atlas</Link>.
      </p>
    </section>
  ),
})

// The parsers fill defaults for anything absent or invalid, so the input
// side of every search schema is "whatever the URL says" (SearchSchemaInput
// keeps Link's `search` prop optional and partial).
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: (raw: Record<string, unknown> & SearchSchemaInput) => parseAtlasSearch(raw),
  search: { middlewares: [omitDefaults(atlasSearchParams)] },
  component: AtlasView,
})

const breakdownsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/breakdowns',
  validateSearch: (raw: Record<string, unknown> & SearchSchemaInput) => parseBreakdownsSearch(raw),
  search: { middlewares: [omitDefaults(breakdownsSearchParams)] },
  component: lazyRouteComponent(() => import('./views/BreakdownsView'), 'BreakdownsView'),
})

const codebookRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/codebook',
  validateSearch: (raw: Record<string, unknown> & SearchSchemaInput) => parseCodebookSearch(raw),
  search: { middlewares: [omitDefaults(codebookSearchParams)] },
  component: lazyRouteComponent(() => import('./views/CodebookView'), 'CodebookView'),
})

const codebookDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/codebook/$name',
  component: lazyRouteComponent(() => import('./views/CodebookDetailView'), 'CodebookDetailView'),
})

const methodsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/methods',
  component: lazyRouteComponent(() => import('./views/MethodsView'), 'MethodsView'),
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  breakdownsRoute,
  codebookRoute,
  codebookDetailRoute,
  methodsRoute,
])

export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    history,
    parseSearch: parseSearchString,
    stringifySearch,
  })
}
