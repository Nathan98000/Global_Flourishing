// The lazy US map chunk: the states topology (~36 KB gz) and the state
// choropleth load only when the map view is opened — never in the
// initial route.

import { useEffect, useState } from 'react'
import type { EstimateRow, Meta, ResponseMeta } from '../api/types'
import { MapLegend, mapDomain } from '../charts/mapScale'
import { StateChoropleth } from '../charts/StateChoropleth'
import { loadUsStateFeatures, type UsFeature } from '../charts/usTopology'
import { Skeleton } from '../components/Skeleton'
import { isShareStat } from '../format'

export default function StatesMapPanel({
  rows,
  responseMeta,
  meta,
}: {
  rows: EstimateRow[]
  responseMeta: ResponseMeta
  meta: Meta
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
        The map of states failed to load — the data table below still has every number.
      </p>
    )
  }
  if (features === null) {
    return <Skeleton height={450} label="Loading the map of states" />
  }

  return (
    <div>
      <MapLegend
        domain={mapDomain(rows, responseMeta)}
        isShare={isShareStat(responseMeta.stat)}
        pooled
      />
      <StateChoropleth rows={rows} responseMeta={responseMeta} features={features} meta={meta} />
    </div>
  )
}
