// The question is on the page, not behind a button (owner decision 3):
// under the chart title, a single item shows its verbatim question and
// a derived score shows the server's one-line description of what it is
// built from — with the full codebook entry one link away. Wording and
// labels come from the server; this renders, never writes copy.

import { Link } from '@tanstack/react-router'
import type { VariableDetail } from '../api/types'
import styles from './WordingPanel.module.css'

export function WordingPanel({ detail }: { detail: VariableDetail }) {
  const codebookLink = (
    <Link to="/codebook/$name" params={{ name: detail.name }} className={styles.link}>
      {detail.is_derived ? 'See all twelve questions →' : 'Answer codes & details →'}
    </Link>
  )
  // No mini-label above the sentence (§9): the wording stands alone.
  return (
    <div className={styles.panel}>
      {detail.wording ? (
        <p className={styles.wording}>
          {detail.wording} {codebookLink}
        </p>
      ) : (
        <p className={styles.note}>
          {detail.is_derived
            ? (detail.label ?? 'A score computed from several questions.')
            : 'No wording is recorded for this item.'}{' '}
          {codebookLink}
        </p>
      )}
    </div>
  )
}
