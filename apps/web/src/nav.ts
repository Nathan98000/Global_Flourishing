// Navigation copy and the data-view rule, kept out of the shell
// component so fast refresh stays clean. Nav order (Phase 5 brief):
// Atlas · Change · Compare · What Matters · US States · Breakdowns ·
// Codebook · Methods. Correlates (Phase 6) is omitted, not stubbed as a
// dead link (CLAUDE.md phase discipline).

export const NAV_ITEMS: readonly { to: string; label: string }[] = [
  { to: '/', label: 'Atlas' },
  { to: '/change', label: 'Change' },
  { to: '/compare', label: 'Compare' },
  { to: '/what-matters', label: 'What Matters' },
  { to: '/states', label: 'US States' },
  { to: '/breakdowns', label: 'Breakdowns' },
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
    ['/breakdowns', '/codebook', '/change', '/compare', '/what-matters', '/states'].some((prefix) =>
      pathname.startsWith(prefix),
    )
  )
}
