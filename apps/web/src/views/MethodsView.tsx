// Methods (§2.8): docs/METHODS.md is the single source — rendered, not
// paraphrased into JSX. Above it, a plain-language summary whose
// thresholds and CI level come from meta (never hard-coded), and the
// "associations, not causes" note. This whole route (marked included)
// is a lazy chunk.

import { marked } from 'marked'
import { useMemo } from 'react'
import methodsSource from '../../../../docs/METHODS.md?raw'
import { useMeta } from '../api/meta'
import { formatCount } from '../format'
import styles from './MethodsView.module.css'

const STUDY_LINKS = [
  {
    href: 'https://doi.org/10.17605/OSF.IO/3JTZ8',
    label: 'Data: Global Flourishing Study (OSF, DOI 10.17605/OSF.IO/3JTZ8)',
  },
  {
    href: 'https://www.nature.com/articles/s44220-024-00423-x',
    label: 'Study profile: VanderWeele et al., Nature Mental Health (2025)',
  },
]

export function MethodsView() {
  const meta = useMeta()
  const html = useMemo(() => marked.parse(methodsSource, { async: false }), [])
  const suppression = meta.data?.meta.suppression
  const ciLevel = meta.data?.meta.ci_level

  return (
    <section className={styles.methods}>
      <h2>Methods</h2>
      <div className={styles.summary}>
        <p>
          Every number in this app is a <strong>survey-weighted estimate</strong> carrying its
          weight, its unweighted n, and a design-based
          {ciLevel !== undefined ? ` ${Math.round(ciLevel * 100)}%` : ''} confidence interval.
          {suppression && (
            <>
              {' '}
              Cells with n below {formatCount(suppression.threshold)} are withheld (the n stays
              visible); cells with n below {formatCount(suppression.flag_below)} are flagged as
              small.
            </>
          )}
        </p>
        <p>
          <strong>Associations, not causes.</strong> Nothing here is a causal estimate — the app
          says &ldquo;associated with&rdquo; and means exactly that.
        </p>
        <ul className={styles.links}>
          {STUDY_LINKS.map((link) => (
            <li key={link.href}>
              <a href={link.href}>{link.label}</a>
            </li>
          ))}
        </ul>
      </div>
      {/* Our own docs/METHODS.md, parsed at build time — not user input. */}
      <div className={styles.prose} dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  )
}
