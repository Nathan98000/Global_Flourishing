// Navigation copy and the data-view rule, kept out of the shell
// component so fast refresh stays clean. Nav order (Phase 5 brief, plus
// Phase 6): Atlas · Change · Compare · What Matters · Correlates ·
// US States · Breakdowns · Codebook · Methods. The model cards are
// reached from the Correlates figure and from Methods, not from here.

export const NAV_ITEMS: readonly { to: string; label: string }[] = [
  { to: '/', label: 'Atlas' },
  { to: '/change', label: 'Change' },
  { to: '/compare', label: 'Compare' },
  { to: '/what-matters', label: 'What Matters' },
  { to: '/correlates', label: 'Correlates' },
  { to: '/states', label: 'US States' },
  { to: '/breakdowns', label: 'Breakdowns' },
  { to: '/codebook', label: 'Codebook' },
  { to: '/methods', label: 'Methods' },
]

/** On a phone nine items do not fit one 13px row at 390px; the
 * secondary five collapse into a "More" disclosure rather than the type
 * shrinking. */
export const NAV_PRIMARY_COUNT = 4

/** The views that load data — the only places an outage banner can
 * matter (F13: it used to show on Methods and the 404 page too). */
export function isDataView(pathname: string): boolean {
  return (
    pathname === '/' ||
    [
      '/breakdowns',
      '/codebook',
      '/change',
      '/compare',
      '/what-matters',
      '/correlates',
      '/states',
    ].some((prefix) => pathname.startsWith(prefix))
  )
}
