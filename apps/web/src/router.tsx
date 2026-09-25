import {
  Link,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
  type RouterHistory,
  type SearchSchemaInput,
} from '@tanstack/react-router'
import { useEffect } from 'react'
import { AppShell } from './components/AppShell'
import {
  atlasSearchParams,
  breakdownsSearchParams,
  changeSearchParams,
  codebookSearchParams,
  compareRedirectSearch,
  correlatesSearchParams,
  parseAtlasSearch,
  parseBreakdownsSearch,
  parseChangeSearch,
  parseCodebookSearch,
  parseCorrelatesSearch,
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

/** Every route names the tab: "<Page> — Flourish Atlas". */
export const SITE_NAME = 'Flourish Atlas'
export function pageTitle(page: string): string {
  return `${page} — ${SITE_NAME}`
}
const titled = (page: string) => ({
  beforeLoad: () => {
    document.title = pageTitle(page)
  },
})

function NotFound() {
  useEffect(() => {
    document.title = pageTitle('Page not found')
  }, [])
  return (
    <section>
      <h2>Page not found</h2>
      <p>
        Nothing lives at this address. <Link to="/">Back to the Atlas</Link>.
      </p>
    </section>
  )
}

const rootRoute = createRootRoute({
  component: AppShell,
  notFoundComponent: NotFound,
})

// The parsers fill defaults for anything absent or invalid, so the input
// side of every search schema is "whatever the URL says" (SearchSchemaInput
// keeps Link's `search` prop optional and partial).
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  ...titled('Atlas'),
  validateSearch: (raw: Record<string, unknown> & SearchSchemaInput) => parseAtlasSearch(raw),
  search: { middlewares: [omitDefaults(atlasSearchParams)] },
  component: AtlasView,
})

// Phase 5: API-only views, each a lazy chunk (the initial route stays the
// Atlas alone — budget ≤ 250 kB gz).
const changeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/change',
  ...titled('Change'),
  validateSearch: (raw: Record<string, unknown> & SearchSchemaInput) => parseChangeSearch(raw),
  search: { middlewares: [omitDefaults(changeSearchParams)] },
  component: lazyRouteComponent(() => import('./views/ChangeView'), 'ChangeView'),
})

// Compare is retired (ADR-0017): a single-country split is what
// Breakdowns does. Its old links land there with the outcome and wave
// they carried, when valid; every other param is dropped, unannounced.
const compareRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/compare',
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/breakdowns', search: compareRedirectSearch(search), replace: true })
  },
})

const whatMattersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/what-matters',
  ...titled('What Matters'),
  validateSearch: (raw: Record<string, unknown> & SearchSchemaInput) => parseWhatMattersSearch(raw),
  search: { middlewares: [omitDefaults(whatMattersSearchParams)] },
  component: lazyRouteComponent(() => import('./views/WhatMattersView'), 'WhatMattersView'),
})

// Phase 6: the Correlates view and the model cards it links to, both lazy.
const correlatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/correlates',
  ...titled('Correlates'),
  validateSearch: (raw: Record<string, unknown> & SearchSchemaInput) => parseCorrelatesSearch(raw),
  search: { middlewares: [omitDefaults(correlatesSearchParams)] },
  component: lazyRouteComponent(() => import('./views/CorrelatesView'), 'CorrelatesView'),
})

const modelCardsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/model-cards',
  ...titled('Model cards'),
  component: lazyRouteComponent(() => import('./views/ModelCardsView'), 'ModelCardsView'),
})

const statesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/states',
  ...titled('US States'),
  validateSearch: (raw: Record<string, unknown> & SearchSchemaInput) => parseStatesSearch(raw),
  search: { middlewares: [omitDefaults(statesSearchParams)] },
  component: lazyRouteComponent(() => import('./views/StatesView'), 'StatesView'),
})

const breakdownsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/breakdowns',
  ...titled('Breakdowns'),
  validateSearch: (raw: Record<string, unknown> & SearchSchemaInput) => parseBreakdownsSearch(raw),
  search: { middlewares: [omitDefaults(breakdownsSearchParams)] },
  component: lazyRouteComponent(() => import('./views/BreakdownsView'), 'BreakdownsView'),
})

const codebookRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/codebook',
  ...titled('Codebook'),
  validateSearch: (raw: Record<string, unknown> & SearchSchemaInput) => parseCodebookSearch(raw),
  search: { middlewares: [omitDefaults(codebookSearchParams)] },
  component: lazyRouteComponent(() => import('./views/CodebookView'), 'CodebookView'),
})

const codebookDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/codebook/$name',
  ...titled('Codebook'),
  component: lazyRouteComponent(() => import('./views/CodebookDetailView'), 'CodebookDetailView'),
})

const methodsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/methods',
  ...titled('Methods'),
  component: lazyRouteComponent(() => import('./views/MethodsView'), 'MethodsView'),
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  changeRoute,
  compareRedirectRoute,
  whatMattersRoute,
  correlatesRoute,
  modelCardsRoute,
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
