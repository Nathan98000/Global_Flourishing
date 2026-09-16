// Question wording one click away from every chart (proposal §4.4):
// the exact wording, scale direction, waves, and the value-label table,
// straight from /v1/variables/{name} (static tier first).

import { Link } from '@tanstack/react-router'
import type { VariableDetail } from '../api/types'
import styles from './WordingPanel.module.css'

export function WordingPanel({ detail }: { detail: VariableDetail }) {
  const labels = detail.value_labels.filter((label) => !label.is_nonresponse)
  const nonresponse = detail.value_labels.filter((label) => label.is_nonresponse)
  return (
    <details className={styles.panel}>
      <summary className={styles.summary}>Question wording &amp; codes</summary>
      <div className={styles.body}>
        {detail.wording ? (
          <blockquote className={styles.wording}>{detail.wording}</blockquote>
        ) : (
          <p className={styles.note}>
            {detail.is_derived
              ? `Derived score — ${detail.label ?? 'computed by the pipeline.'}`
              : 'No wording recorded for this item.'}
          </p>
        )}
        <p className={styles.note}>
          Scale: {detail.scale_type}
          {detail.min !== null && detail.max !== null ? ` (${detail.min}–${detail.max})` : ''}
          {' · '}direction: {detail.direction.replace('_', ' ')}
          {' · '}waves: {detail.waves_available.join(', ')}
        </p>
        {labels.length > 0 && (
          <table className={styles.labels}>
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Label</th>
              </tr>
            </thead>
            <tbody>
              {labels.map((label) => (
                <tr key={`${label.code}-${label.country_code ?? ''}-${label.wave ?? ''}`}>
                  <td>{label.code}</td>
                  <td>
                    {label.label}
                    {label.country_code !== null && ` (country ${label.country_code})`}
                    {label.wave !== null && ` (${label.wave})`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {nonresponse.length > 0 && (
          <p className={styles.note}>
            Non-response codes:{' '}
            {nonresponse.map((label) => `${label.code} ${label.label}`).join(', ')}
          </p>
        )}
        <p className={styles.note}>
          <Link to="/codebook/$name" params={{ name: detail.name }}>
            Full codebook entry →
          </Link>
        </p>
      </div>
    </details>
  )
}
