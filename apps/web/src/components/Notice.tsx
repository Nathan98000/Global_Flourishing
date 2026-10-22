// The invalid-URL-params notice: bad search params degrade to defaults
// with a visible explanation, never a crash (§2.2) — in the visitor's
// words, never the parameters' (F13); `data-params` names them for
// whoever debugs the link. And the notice a link gets when what it asks
// for needs the live data service while it is offline: that is no fault
// of the link's.

import type { ReactNode } from 'react'
import styles from './Notice.module.css'

export const INVALID_LINK =
  'This link asked for something we can’t show; showing the default instead.'

export function InvalidParamsNotice({
  invalid,
  onDismiss,
}: {
  invalid: string[] | undefined
  onDismiss: () => void
}) {
  if (!invalid || invalid.length === 0) return null
  return (
    <p className={styles.notice} role="status" data-params={invalid.join(',')}>
      {INVALID_LINK}{' '}
      <button type="button" className={styles.dismiss} onClick={onDismiss}>
        Dismiss
      </button>
    </p>
  )
}

/** A band in the notice's look that says what the page is showing in
 * place of what the link asked for. */
export function StatusNotice({ children }: { children: ReactNode }) {
  return (
    <p className={styles.notice} role="status">
      {children}
    </p>
  )
}
