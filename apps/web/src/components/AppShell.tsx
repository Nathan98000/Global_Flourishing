// The shell: skip link, header/nav, honest boot banner, footer with the
// live data_version and the DOI citation on every page. Later-phase views
// (Change, Compare, What Matters, US States, Correlates) are omitted from
// the nav, not stubbed as dead links (CLAUDE.md phase discipline).

import { Link, Outlet } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useBootStatus, useHealth, useMeta } from '../api/meta'
import { ThemeToggle } from './ThemeToggle'
import styles from './AppShell.module.css'

const DATA_CITATION_URL = 'https://doi.org/10.17605/OSF.IO/3JTZ8'

function BootBanner() {
  const boot = useBootStatus()
  let message: ReactNode = null
  if (boot.state === 'no-data') {
    message = (
      <>
        <strong>No data source is reachable.</strong> Neither the precomputed tier nor the live API
        answered, so charts cannot load. The deployment may still be provisioning its data build.
      </>
    )
  } else if (boot.state === 'static-only') {
    message = boot.apiReachable ? (
      <>
        The live API is running <strong>without a data build</strong> — precomputed views work;
        custom queries are unavailable.
      </>
    ) : (
      <>
        The live API is <strong>unreachable</strong> — showing precomputed views; custom queries are
        unavailable.
      </>
    )
  } else if (boot.state === 'api-only') {
    message = (
      <>No precomputed tier on this deployment — every view queries the live API directly.</>
    )
  }
  if (message === null) return null
  return (
    <div className={styles.banner} role="status">
      {message}
    </div>
  )
}

function FooterStatus() {
  const meta = useMeta()
  const health = useHealth()
  const dataVersion = meta.data?.meta.data_version ?? health.data?.data_version ?? null
  const api = health.data
  return (
    <p aria-live="polite" className={styles.footerLine}>
      data version: {dataVersion ?? '—'}
      {' · '}
      {api
        ? `API: ${api.status} · v${api.version}` +
          (api.git_sha ? ` · sha ${api.git_sha.slice(0, 7)}` : '') +
          (api.data === 'absent' ? ' · no data build' : '')
        : health.isPending
          ? 'API: checking…'
          : 'API unreachable'}
    </p>
  )
}

export function AppShell() {
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
      <BootBanner />
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
          for Global Human Flourishing. Survey-weighted aggregates only; associations, not causes.
        </p>
        <FooterStatus />
      </footer>
    </div>
  )
}
