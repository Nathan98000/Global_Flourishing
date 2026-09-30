// Methods (§2.8): docs/METHODS.md is the single source — rendered, not
// paraphrased into JSX. Above it, a plain-language summary whose
// thresholds and CI level come from meta (never hard-coded), and the
// "associations, not causes" note. This whole route (marked included)
// is a lazy chunk.

import { Marked, Renderer } from 'marked'
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

// A heading's id is the one GitHub gives it (github-slugger's rule), so
// the document's links to its own sections (#verified-against-r) work
// here as they do there: the heading's text in lower case, everything
// but letters, digits, "_", "-" and spaces dropped, each space a hyphen.
// A name already taken gets -1, -2, …, so no two headings share an id.
function headingSlugger(): (text: string) => string {
  const taken = new Map<string, number>()
  return (text) => {
    const base = text
      .toLowerCase()
      .replace(/[^\p{Alphabetic}\p{M}\p{Nd}\p{Pc} -]/gu, '')
      .replace(/ /g, '-')
    let slug = base
    while (taken.has(slug)) {
      const repeats = (taken.get(base) ?? 0) + 1
      taken.set(base, repeats)
      slug = `${base}-${repeats}`
    }
    taken.set(slug, 0)
    return slug
  }
}

// The document's tables are marked's own, each inside a box that scrolls
// sideways where a phone is too narrow for it (owner decision, 30 Sept):
// the rule every table here follows — its words never break, and the
// page keeps its width. Its headings carry GitHub's ids, counted afresh
// for each parse — the page parses on every visit, and a count carried
// over would give a second visit's headings -1 ids.
export function renderMethods(source: string): string {
  const headingId = headingSlugger()
  const markdown = new Marked({
    renderer: {
      heading({ tokens, depth }) {
        const id = headingId(this.parser.parseInline(tokens, this.parser.textRenderer))
        return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`
      },
      table(token) {
        return `<div class="${styles.tableScroll}">${Renderer.prototype.table.call(this, token)}</div>`
      },
    },
  })
  return markdown.parse(source, { async: false })
}

export function MethodsView() {
  const meta = useMeta()
  const html = useMemo(() => renderMethods(methodsSource), [])
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
          {suppression && suppression.threshold > 0 ? (
            <>
              {' '}
              Cells with n below {formatCount(suppression.threshold)} are withheld (the n stays
              visible); cells with n below {formatCount(suppression.flag_below)} are flagged as
              small.
            </>
          ) : (
            <>
              {' '}
              Every cell is shown, however small — read the n behind a number before leaning on it.
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
