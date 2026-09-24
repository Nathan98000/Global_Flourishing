// Every failure renders distinctly (exit criterion 5): the API's 422
// messages verbatim (they are written as the fix), 503 as "this
// deployment has no data build", 429 as "slow down", network failure as
// its own state — but only when /health also fails: a service that
// answers its health check and then fails one request has returned an
// error, not gone offline. Never a spinner, never a blank.

import { ApiError, NetworkError } from '../api/errors'
import styles from './ErrorState.module.css'

const SERVICE_ERROR = "Couldn't load this view — the data service returned an error."

function body(
  error: unknown,
  apiReachable: boolean | undefined,
): { title: string; lines: string[] } {
  if (error instanceof ApiError) {
    switch (error.kind) {
      case 'validation':
        return { title: 'The API rejected this query', lines: error.details }
      case 'no-data':
        return {
          title: 'This deployment has no data build',
          lines: [
            'The live data service is running without data, so filters and medians are unavailable.',
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
        return {
          title: SERVICE_ERROR,
          lines: [`HTTP ${error.status}${error.details.length ? `: ${error.details[0]}` : ''}`],
        }
    }
  }
  if (error instanceof NetworkError) {
    if (apiReachable) {
      return { title: SERVICE_ERROR, lines: ['The request did not complete; try again shortly.'] }
    }
    return {
      title: 'Live data service is offline',
      lines: ['The standard views still work; filters and medians are unavailable.'],
    }
  }
  return { title: 'Something went wrong', lines: [String(error)] }
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
  const { title, lines } = body(error, apiReachable)
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
