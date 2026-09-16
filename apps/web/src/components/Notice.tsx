// The invalid-URL-params notice: bad search params degrade to defaults
// with a visible explanation, never a crash (§2.2).

import styles from './Notice.module.css'

export function InvalidParamsNotice({
  invalid,
  onDismiss,
}: {
  invalid: string[] | undefined
  onDismiss: () => void
}) {
  if (!invalid || invalid.length === 0) return null
  return (
    <p className={styles.notice} role="status">
      Some URL parameters were invalid and were reset to defaults: {invalid.join(', ')}.{' '}
      <button type="button" className={styles.dismiss} onClick={onDismiss}>
        Dismiss
      </button>
    </p>
  )
}
