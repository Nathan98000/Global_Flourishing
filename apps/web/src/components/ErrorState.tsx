// Every failure renders distinctly (exit criterion 5): the API's 422
// messages verbatim (they are written as the fix), 503 as "this
// deployment has no data build", 429 as "slow down", network failure as
// its own state — but only when /health also fails: a service that
// answers its health check and then fails one request has returned an
// error, not gone offline. Any other failure is ours, said in plain words
// with a way to try again (H14) — never an HTTP status or a server's
// message. Never a spinner, never a blank.

import { QueryClientContext } from '@tanstack/react-query'
import { useContext } from 'react'
import { ApiError, NetworkError } from '../api/errors'
import styles from './ErrorState.module.css'

const SERVICE_ERROR = 'Something went wrong on our side.'

function body(
  error: unknown,
  apiReachable: boolean | undefined,
): { title: string; lines: string[]; retry?: boolean } {
  if (error instanceof ApiError) {
    switch (error.kind) {
      case 'validation':
        return { title: 'The API rejected this query', lines: error.details }
      case 'no-data':
        return {
          title: 'This deployment has no data build',
          lines: [
            'The live data service is running without data, so some views can’t load. The Atlas, Segments and What Matters still work.',
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
        return { title: SERVICE_ERROR, lines: [], retry: true }
    }
  }
  if (error instanceof NetworkError) {
    if (apiReachable) return { title: SERVICE_ERROR, lines: [], retry: true }
    return {
      title: 'Live data service is offline',
      lines: [
        'Some views need the live data service, which is offline. The Atlas, Segments and What Matters still work.',
      ],
    }
  }
  return { title: SERVICE_ERROR, lines: [], retry: true }
}

export function ErrorState({
  error,
  apiReachable,
}: {
  error: unknown
  /** Whether /health answered: a failure with the service reachable is
   * the service's error, not an outage. */
  apiReachable?: boolean
}) {
  const { title, lines, retry } = body(error, apiReachable)
  // Try again: every request that failed asks once more (where the app's
  // query client is at hand), else the page reloads.
  const client = useContext(QueryClientContext)
  const tryAgain = () => {
    if (client) void client.refetchQueries({ predicate: (query) => query.state.status === 'error' })
    else window.location.reload()
  }
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
      {retry && (
        <button type="button" className={styles.retry} onClick={tryAgain}>
          Try again
        </button>
      )}
    </div>
  )
}
