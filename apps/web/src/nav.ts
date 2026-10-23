// Navigation copy and the data-view rule, kept out of the shell
// component so fast refresh stays clean. Nav order (Phase 5 brief, plus
// Phase 6, less Compare — retired 25 Sept): Atlas · Change · What Matters ·
// Correlates · US States · Segments · Methods. The Codebook is reached
// from Methods, not the nav (ADR-0021): Methods reads as the current
// page while a codebook page is open.

export interface NavItem {
  to: string
  label: string
  /** Other paths the item stands for (its pages reached from it). */
  covers?: readonly string[]
  /** Its page needs the live data service: while that is offline the
   * link wears a mark saying so (H6). */
  live?: true
}

export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Atlas' },
  { to: '/change', label: 'Change', live: true },
  { to: '/what-matters', label: 'What Matters' },
  { to: '/correlates', label: 'Correlates', live: true },
  { to: '/states', label: 'US States', live: true },
  { to: '/segments', label: 'Segments' },
  { to: '/methods', label: 'Methods', covers: ['/codebook'] },
]

/** On a phone seven items do not fit one 13px row at 390px; the
 * secondary three collapse into a "More" disclosure rather than the type
 * shrinking. */
export const NAV_PRIMARY_COUNT = 4

/** Whether a nav item stands for the current page: its own path, or one
 * it covers (a codebook page, for Methods). */
export function navCovers(item: NavItem, pathname: string): boolean {
  return (item.covers ?? []).some((prefix) => pathname.startsWith(prefix))
}

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
