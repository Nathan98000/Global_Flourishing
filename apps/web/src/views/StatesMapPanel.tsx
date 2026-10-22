// The lazy US map chunk: the states topology (~36 KB gz) and the state
// choropleth load only when the map view is opened — never in the
// initial route. Its legend row says, beside the ramp, what the colours
// can't show (F1): smaller states rest on fewer people, and the chart
// draws each state's interval; a thin state's dashed outline, when there
// is one (H17).

import { useEffect, useState } from 'react'
import type { EstimateRow, Meta, ResponseMeta, VariableSummary } from '../api/types'
import { MapLegend, mapDomain } from '../charts/mapScale'
import { StateChoropleth } from '../charts/StateChoropleth'
import { loadUsStateFeatures, type UsFeature } from '../charts/usTopology'
import { Skeleton } from '../components/Skeleton'
import styles from './AtlasView.module.css'
import { ciLabel, isShareStat } from '../format'
import { keyThinBelow } from './viewState'

export default function StatesMapPanel({
  rows,
  responseMeta,
  meta,
  variable,
  answer,
  found,
}: {
  rows: EstimateRow[]
  responseMeta: ResponseMeta
  meta: Meta
  /** For the hover cards: the measure's scale, and a share's answer. */
  variable?: VariableSummary
  answer?: string
  /** A state picked out with Find a state. */
  found?: string
}) {
  const [features, setFeatures] = useState<UsFeature[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    loadUsStateFeatures()
      .then((loaded) => {
        if (!cancelled) setFeatures(loaded)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (failed) {
    return (
      <p role="status">
        The map of states failed to load — the CSV download still has every number.
      </p>
    )
  }
  if (features === null) {
    return <Skeleton height={450} label="Loading the map of states" />
  }

  return (
    <div>
      <div className={styles.legendRow}>
        <MapLegend
          domain={mapDomain(rows, responseMeta)}
          isShare={isShareStat(responseMeta.stat)}
          thinBelow={keyThinBelow(rows, meta.suppression)}
        />
        <span className={styles.legendNote}>
          Smaller states rest on fewer people — the chart shows each state&rsquo;s{' '}
          {ciLabel(meta.ci_level)}
        </span>
      </div>
      <StateChoropleth
        rows={rows}
        responseMeta={responseMeta}
        features={features}
        meta={meta}
        variable={variable}
        answer={answer}
        found={found}
      />
    </div>
  )
}
