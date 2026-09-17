// The shell: skip link, header/nav, honest boot banner on the data
// views, and a footer that carries the citation — nothing else (owner
// decision 5: the data version lives in the CSV header and Methods; the
// causation caveat lives on Methods, where it is explained rather than
// asserted). Later-phase views (Change, Compare, What Matters, US
// States, Correlates) are omitted from the nav, not stubbed as dead
// links (CLAUDE.md phase discipline).

import { Link, Outlet, useLocation } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useBootStatus } from '../api/meta'
import { ThemeToggle } from './ThemeToggle'
import styles from './AppShell.module.css'

const DATA_CITATION_URL = 'https://doi.org/10.17605/OSF.IO/3JTZ8'

/** The views that load data — the only places an outage banner can
 * matter (F13: it used to show on Methods and the 404 page too). */
function isDataView(pathname: string): boolean {
  return pathname === '/' || pathname.startsWith('/breakdowns') || pathname.startsWith('/codebook')
}

function BootBanner() {
  const boot = useBootStatus()
  let message: ReactNode = null
  if (boot.state === 'no-data') {
    message = (
      <>
        <strong>No data is reachable right now.</strong> Neither the built-in views nor the live
        data service answered, so charts cannot load. The deployment may still be setting up its
        data.
      </>
    )
  } else if (boot.state === 'static-only') {
    message = boot.apiReachable ? (
      <>
        The live data service has <strong>no data yet</strong> — the standard views still work;
        filters and medians are unavailable.
      </>
    ) : (
      <>
        Live data service is <strong>offline</strong> — the standard views still work; filters and
        medians are unavailable.
      </>
    )
  } else if (boot.state === 'api-only') {
    message = <>Every view on this deployment is answered live by the data service.</>
  }
  if (message === null) return null
  return (
    <div className={styles.banner} role="status">
      {message}
    </div>
  )
}

export function AppShell() {
  const { pathname } = useLocation()
  return (
    <div className={styles.layout}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className={styles.header}>
        <h1 className={styles.brand}>
          <Link to="/">Flourish Atlas</Link>
        </h1>
        <nav aria-label="Main" className={styles.nav}>
          <Link to="/">Atlas</Link>
          <Link to="/breakdowns">Breakdowns</Link>
          <Link to="/codebook">Codebook</Link>
          <Link to="/methods">Methods</Link>
        </nav>
        <ThemeToggle />
      </header>
      {isDataView(pathname) && <BootBanner />}
      <main id="main" className={styles.main}>
        <Outlet />
      </main>
      <footer className={styles.footer}>
        <p className={styles.footerLine}>
          Data:{' '}
          <a href={DATA_CITATION_URL}>
            Global Flourishing Study, Waves 1&ndash;2 (2023&ndash;2024)
          </a>
          , Center for Open Science / Gallup / Harvard Human Flourishing Program / Baylor Institute
          for Global Human Flourishing.
        </p>
      </footer>
    </div>
  )
}
