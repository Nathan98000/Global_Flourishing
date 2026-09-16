// Every failure renders distinctly (exit criterion 5): the API's 422
// messages verbatim (they are written as the fix), 503 as "this
// deployment has no data build", 429 as "slow down", network failure as
// its own state. Never a spinner, never a blank.

import { ApiError, NetworkError } from '../api/errors'
import styles from './ErrorState.module.css'

function body(error: unknown): { title: string; lines: string[] } {
  if (error instanceof ApiError) {
    switch (error.kind) {
      case 'validation':
        return { title: 'The API rejected this query', lines: error.details }
      case 'no-data':
        return {
          title: 'This deployment has no data build',
          lines: [
            'The live API is running without data, so custom queries are unavailable.',
            ...error.details,
          ],
        }
      case 'rate-limit':
        return {
          title: 'Slow down a moment',
          lines: [
            error.retryAfterSeconds !== null
              ? `Rate limit reached — try again in about ${error.retryAfterSeconds}s.`
              : 'Rate limit reached — try again shortly.',
          ],
        }
      case 'not-implemented':
        return { title: 'Not available yet', lines: error.details }
      default:
        return { title: `The API returned HTTP ${error.status}`, lines: error.details }
    }
  }
  if (error instanceof NetworkError) {
    return {
      title: 'The live API is unreachable',
      lines: ['Precomputed views still work; custom queries need the API.'],
    }
  }
  return { title: 'Something went wrong', lines: [String(error)] }
}

export function ErrorState({ error }: { error: unknown }) {
  const { title, lines } = body(error)
  return (
    <div role="alert" className={styles.panel}>
      <p className={styles.title}>{title}</p>
      {lines.length === 1 ? (
        <p className={styles.line}>{lines[0]}</p>
      ) : lines.length > 1 ? (
        <ul className={styles.list}>
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
