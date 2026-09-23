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
  changeSearchParams,
  codebookSearchParams,
  compareSearchParams,
  parseAtlasSearch,
  parseBreakdownsSearch,
  parseChangeSearch,
  parseCodebookSearch,
  parseCompareSearch,
  parseStatesSearch,
  parseWhatMattersSearch,
  statesSearchParams,
  whatMattersSearchParams,
} from './state/search'
import { parseSearchString, stringifySearch } from './state/searchCodec'
import { AtlasView } from './views/AtlasView'

// Serialization middleware: defaults never reach the address bar — the
// URL carries exactly what differs from the default view (§2.2). The
// cleaner must run on `next()`'s RESULT, not its input: the router
// appends a validation middleware after this one which merges the full
// validated state (defaults included) over whatever was passed in, so
// cleaning first gets undone. Cleaning last is what actually reaches
// the URL. The cleaners accept partial input because the router also
// runs this while building Link hrefs from partial search objects.
function omitDefaults<T>(clean: (search: Partial<T>) => Record<string, unknown>) {
  return ({ search, next }: { search: T; next: (search: T) => T }): T =>
    clean(next(search) as Partial<T>) as unknown as T
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

// Phase 5: four API-only views, each a lazy chunk (the initial route stays
// the Atlas alone — budget ≤ 250 kB gz).
const changeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/change',
  validateSearch: (raw: Record<string, unknown> & SearchSchemaInput) => parseChangeSearch(raw),
  search: { middlewares: [omitDefaults(changeSearchParams)] },
  component: lazyRouteComponent(() => import('./views/ChangeView'), 'ChangeView'),
})

const compareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/compare',
  validateSearch: (raw: Record<string, unknown> & SearchSchemaInput) => parseCompareSearch(raw),
  search: { middlewares: [omitDefaults(compareSearchParams)] },
  component: lazyRouteComponent(() => import('./views/CompareView'), 'CompareView'),
})

const whatMattersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/what-matters',
  validateSearch: (raw: Record<string, unknown> & SearchSchemaInput) => parseWhatMattersSearch(raw),
  search: { middlewares: [omitDefaults(whatMattersSearchParams)] },
  component: lazyRouteComponent(() => import('./views/WhatMattersView'), 'WhatMattersView'),
})

const statesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/states',
  validateSearch: (raw: Record<string, unknown> & SearchSchemaInput) => parseStatesSearch(raw),
  search: { middlewares: [omitDefaults(statesSearchParams)] },
  component: lazyRouteComponent(() => import('./views/StatesView'), 'StatesView'),
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
  changeRoute,
  compareRoute,
  whatMattersRoute,
  statesRoute,
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
