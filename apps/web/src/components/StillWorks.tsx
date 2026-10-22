// What still works without the live data service (F13): the pages the
// built-in data answers — the Atlas, Segments and What Matters — named,
// each a link. The offline banner and every view's offline line say it
// the same way.

import { Link } from '@tanstack/react-router'
import { Fragment } from 'react'

const STATIC_PAGES = [
  { to: '/', label: 'Atlas', article: true },
  { to: '/segments', label: 'Segments', article: false },
  { to: '/what-matters', label: 'What Matters', article: false },
] as const

/** "The Atlas, Segments and What Matters still work." — less the page
 * the line is on (`except`, its path). */
export function StillWorks({ except }: { except?: string }) {
  const pages = STATIC_PAGES.filter((page) => page.to !== except)
  return (
    <>
      {pages.map((page, index) => (
        <Fragment key={page.to}>
          {index === 0 ? (page.article ? 'The ' : '') : index === pages.length - 1 ? ' and ' : ', '}
          {page.article && index > 0 ? 'the ' : ''}
          <Link to={page.to}>{page.label}</Link>
        </Fragment>
      ))}{' '}
      still work.
    </>
  )
}

/** A view's line when it needs the live data service and it is offline. */
export function OfflineLine({ except, className }: { except?: string; className?: string }) {
  return (
    <p className={className} role="status">
      This view needs the live data service, which is offline right now.{' '}
      <StillWorks except={except} />
    </p>
  )
}
