// The shell: skip link, header/nav, honest boot banner on the data
// views, and a footer that carries the citation and a link to how to
// read the charts — nothing else (owner decision 5; the link, the
// 21 Oct review: the data version lives in the CSV header and Methods; the
// causation caveat lives on Methods, where it is explained rather than
// asserted). Phase 5 added Change, What Matters and US States to the nav
// (and Compare, retired 25 Sept — ADR-0017); Phase 6 adds Correlates.
// The Codebook left the nav for a link from Methods (ADR-0021) — seven
// items, the secondary three behind "More" on a phone.

import { Link, Outlet, useLocation } from '@tanstack/react-router'
import { ChartActionsProvider } from '../charts/ChartActions'
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import { useBootStatus } from '../api/meta'
import { HOW_TO_READ } from '../charts/ChartFigure'
import { StillWorks } from './StillWorks'
import { NAV_ITEMS, NAV_PRIMARY_COUNT, isDataView, navCovers, type NavItem } from '../nav'
import { NARROW_VIEWPORT, NAV_FOLD_VIEWPORT, useMediaQuery } from '../useMediaQuery'
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
    // What still works, by name (F13): the country filter works offline
    // too, so the banner no longer says "filters are unavailable".
    message = boot.apiReachable ? (
      <>
        The live data service has <strong>no data yet</strong>, so some views can&rsquo;t load.{' '}
        <StillWorks />
      </>
    ) : (
      <>
        Some views need the live data service, which is <strong>offline</strong>. <StillWorks />
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

/** A nav link: active on its own pages (the router says so) and on the
 * pages it covers — styled as current there, though not the page itself. */
function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  return (
    <Link
      to={item.to}
      activeOptions={{ exact: item.to === '/' }}
      {...(navCovers(item, pathname) ? { 'data-status': 'active' } : {})}
    >
      {item.label}
    </Link>
  )
}

/** The phone nav: the primary four inline, the rest behind "More". The
 * disclosure closes on navigation and on Escape; its summary reads as
 * active when the current view lives inside it. The row never pushes the
 * page sideways: a stretch of space follows each link, giving way before
 * the row wraps (AppShell.module.css). */
function NarrowNav({ pathname }: { pathname: string }) {
  const details = useRef<HTMLDetailsElement | null>(null)
  const panel = useRef<HTMLDivElement | null>(null)
  // The open panel hangs from "More"'s right edge, moved right by however
  // far that would run past the row's left edge — which it does once the
  // row has wrapped "More" to its start. Measured on each open and when
  // the window resizes, like the question picker's.
  const [shift, setShift] = useState(0)
  const primary = NAV_ITEMS.slice(0, NAV_PRIMARY_COUNT)
  const secondary = NAV_ITEMS.slice(NAV_PRIMARY_COUNT)
  const insideMore = secondary.some(
    (item) => pathname.startsWith(item.to) || navCovers(item, pathname),
  )
  useEffect(() => {
    if (details.current) details.current.open = false
  }, [pathname])
  const place = useCallback(() => {
    const host = details.current
    const box = panel.current
    const row = host?.parentElement
    if (!host?.open || !box || !row) return
    const left = host.getBoundingClientRect().right - box.getBoundingClientRect().width
    setShift(Math.max(0, row.getBoundingClientRect().left - left))
  }, [])
  useEffect(() => {
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [place])
  return (
    <>
      {primary.map((item) => (
        <Fragment key={item.to}>
          <NavLink item={item} pathname={pathname} />
          <span className={styles.navGap} />
        </Fragment>
      ))}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <details
        ref={details}
        className={styles.more}
        onToggle={place}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && details.current?.open) details.current.open = false
        }}
      >
        <summary className={styles.moreSummary} data-status={insideMore ? 'active' : undefined}>
          More
        </summary>
        <div
          ref={panel}
          className={styles.morePanel}
          style={{ '--panel-shift': `${shift}px` } as CSSProperties}
        >
          {secondary.map((item) => (
            <NavLink key={item.to} item={item} pathname={pathname} />
          ))}
        </div>
      </details>
    </>
  )
}

/** The least the nav's own row leaves between two links (.nav > a). */
const NAV_LEAST_GAP = 2

/** Whether the seven links fit the nav's own row, at their least spacing
 * (F8): measured from a hidden copy of the links in the row's own type,
 * against the header's width, again whenever it changes. Before the
 * first measure (and under jsdom, which lays nothing out) they fit. */
function useNavFits(
  header: RefObject<HTMLElement | null>,
  copy: RefObject<HTMLElement | null>,
): boolean {
  const [fits, setFits] = useState(true)
  useEffect(() => {
    const host = header.current
    const links = copy.current
    if (!host || !links || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const needed = links.scrollWidth + NAV_LEAST_GAP * (NAV_ITEMS.length - 1)
      setFits(needed === 0 || needed <= host.clientWidth)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => observer.disconnect()
  }, [header, copy])
  return fits
}

export function AppShell() {
  const { pathname } = useLocation()
  // The nav takes its own row under 50rem; it folds into "More" on a
  // phone, and wherever else its seven links would not fit that row
  // (F8: a tablet held upright shows them all).
  const phone = useMediaQuery(NARROW_VIEWPORT)
  const ownRow = useMediaQuery(NAV_FOLD_VIEWPORT)
  const header = useRef<HTMLElement | null>(null)
  const copy = useRef<HTMLSpanElement | null>(null)
  const fits = useNavFits(header, copy)
  const narrow = phone || (ownRow && !fits)
  return (
    <div className={styles.layout}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header ref={header} className={styles.header}>
        {/* The links in the row's own type, out of sight: what the row
            needs, at its least spacing. */}
        <span ref={copy} className={styles.navMeasure} aria-hidden="true">
          {NAV_ITEMS.map((item) => (
            <span key={item.to}>{item.label}</span>
          ))}
        </span>
        <h1 className={styles.brand}>
          <Link to="/">Flourish Atlas</Link>
        </h1>
        <nav aria-label="Main" className={styles.nav}>
          {narrow ? (
            <NarrowNav pathname={pathname} />
          ) : ownRow ? (
            // Its own row, all seven: the spacing gives way first (.navGap).
            NAV_ITEMS.map((item) => (
              <Fragment key={item.to}>
                <NavLink item={item} pathname={pathname} />
                <span className={styles.navGap} />
              </Fragment>
            ))
          ) : (
            NAV_ITEMS.map((item) => <NavLink key={item.to} item={item} pathname={pathname} />)
          )}
        </nav>
      </header>
      {isDataView(pathname) && <BootBanner />}
      <main id="main" className={styles.main}>
        {/* One slot per page for its chart's phone actions (G3). */}
        <ChartActionsProvider>
          <Outlet />
        </ChartActionsProvider>
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
        <p className={styles.footerLine}>
          <Link to={HOW_TO_READ.to} hash={HOW_TO_READ.hash}>
            How to read the charts
          </Link>
        </p>
      </footer>
    </div>
  )
}
