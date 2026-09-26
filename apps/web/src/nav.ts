// Navigation copy and the data-view rule, kept out of the shell
// component so fast refresh stays clean. Nav order (Phase 5 brief, plus
// Phase 6, less Compare — retired 25 Sept): Atlas · Change · What Matters ·
// Correlates · US States · Segments · Codebook · Methods. The model
// cards are reached from the Correlates figure and from Methods, not
// from here.

export const NAV_ITEMS: readonly { to: string; label: string }[] = [
  { to: '/', label: 'Atlas' },
  { to: '/change', label: 'Change' },
  { to: '/what-matters', label: 'What Matters' },
  { to: '/correlates', label: 'Correlates' },
  { to: '/states', label: 'US States' },
  { to: '/segments', label: 'Segments' },
  { to: '/codebook', label: 'Codebook' },
  { to: '/methods', label: 'Methods' },
]

/** On a phone eight items do not fit one 13px row at 390px; the
 * secondary four collapse into a "More" disclosure rather than the type
 * shrinking. */
export const NAV_PRIMARY_COUNT = 4

/** The views that load data — the only places an outage banner can
 * matter (F13: it used to show on Methods and the 404 page too). */
export function isDataView(pathname: string): boolean {
  return (
    pathname === '/' ||
    ['/segments', '/codebook', '/change', '/what-matters', '/correlates', '/states'].some(
      (prefix) => pathname.startsWith(prefix),
    )
  )
}
