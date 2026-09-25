// The shell: skip link, header/nav, honest boot banner on the data
// views, and a footer that carries the citation — nothing else (owner
// decision 5: the data version lives in the CSV header and Methods; the
// causation caveat lives on Methods, where it is explained rather than
// asserted). Phase 5 added Change, What Matters and US States to the nav
// (and Compare, retired 25 Sept — ADR-0017); Phase 6 adds Correlates —
// eight items, the secondary four behind "More" on a phone.

import { Link, Outlet, useLocation } from '@tanstack/react-router'
import { useEffect, useRef, type ReactNode } from 'react'
import { useBootStatus } from '../api/meta'
import { NAV_ITEMS, NAV_PRIMARY_COUNT, isDataView } from '../nav'
import { NAV_FOLD_VIEWPORT, useMediaQuery } from '../useMediaQuery'
import { ThemeToggle } from './ThemeToggle'
import styles from './AppShell.module.css'

const DATA_CITATION_URL = 'https://doi.org/10.17605/OSF.IO/3JTZ8'

function BootBanner() {
  const boot = useBootStatus()
  let message: ReactNode = null
  if (boot.state === 'no-data') {
    message = (
      <>
        <strong>No data</strong> is reachable right now — neither the built-in views nor the live
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

function NavLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} activeOptions={{ exact: to === '/' }}>
      {label}
    </Link>
  )
}

/** The phone nav: the primary four inline, the rest behind "More". The
 * disclosure closes on navigation and on Escape; its summary reads as
 * active when the current view lives inside it. */
function NarrowNav({ pathname }: { pathname: string }) {
  const details = useRef<HTMLDetailsElement | null>(null)
  const primary = NAV_ITEMS.slice(0, NAV_PRIMARY_COUNT)
  const secondary = NAV_ITEMS.slice(NAV_PRIMARY_COUNT)
  const insideMore = secondary.some((item) => pathname.startsWith(item.to))
  useEffect(() => {
    if (details.current) details.current.open = false
  }, [pathname])
  return (
    <>
      {primary.map((item) => (
        <NavLink key={item.to} {...item} />
      ))}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <details
        ref={details}
        className={styles.more}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && details.current?.open) details.current.open = false
        }}
      >
        <summary className={styles.moreSummary} data-status={insideMore ? 'active' : undefined}>
          More
        </summary>
        <div className={styles.morePanel}>
          {secondary.map((item) => (
            <NavLink key={item.to} {...item} />
          ))}
        </div>
      </details>
    </>
  )
}

export function AppShell() {
  const { pathname } = useLocation()
  // The nav folds into "More" as soon as nine items would wrap a link
  // (50rem), a wider fold than the display options'.
  const narrow = useMediaQuery(NAV_FOLD_VIEWPORT)
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
          {narrow ? (
            <NarrowNav pathname={pathname} />
          ) : (
            NAV_ITEMS.map((item) => <NavLink key={item.to} {...item} />)
          )}
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
