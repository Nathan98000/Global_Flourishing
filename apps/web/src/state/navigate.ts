// A control moved: the URL changes, the page stays put. TanStack Router
// scrolls to the top on every navigate by default — right for a route
// change from the nav, wrong for a search-only change, where the visitor
// is looking at the control they just moved (ADR-0016). Every view's
// `navigate({ search })` goes through here, so the rule lives once.

/** The navigate options for a search-only change on the current route. */
export function searchNavigation(
  params: Record<string, unknown>,
  options: { replace?: boolean } = {},
) {
  return { search: params as never, resetScroll: false as const, ...options }
}
