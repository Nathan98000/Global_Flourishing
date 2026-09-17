// The lazy map chunk: the topology (~230 KB gz) and the choropleth load
// only when the map view is opened — never in the initial route.

import { useEffect, useState } from 'react'
import type { EstimateRow, Meta, ResponseMeta, VariableSummary } from '../api/types'
import { Choropleth, MapLegend, mapDomain } from '../charts/Choropleth'
import { loadWorldFeatures, type WorldFeature } from '../charts/worldTopology'
import { Skeleton } from '../components/Skeleton'

export default function MapPanel({
  rows,
  meta,
  responseMeta,
  variable,
  selected,
  levelLabel,
}: {
  rows: EstimateRow[]
  meta: Meta
  responseMeta: ResponseMeta
  variable: VariableSummary
  selected: readonly number[]
  levelLabel?: string
}) {
  const [features, setFeatures] = useState<WorldFeature[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    loadWorldFeatures()
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
        The map topology failed to load — the data table below still has every number.
      </p>
    )
  }
  if (features === null) {
    return <Skeleton height={400} label="Loading the world map" />
  }

  const isShare = responseMeta.stat === 'proportion' || responseMeta.stat === 'distribution'

  return (
    <div>
      <Choropleth
        rows={rows}
        meta={meta}
        responseMeta={responseMeta}
        features={features}
        selected={selected}
        levelLabel={levelLabel}
      />
      <MapLegend
        domain={mapDomain(rows, responseMeta)}
        isShare={isShare}
        title={
          isShare && levelLabel
            ? `${variable.display_name} — share answering “${levelLabel}”`
            : variable.display_name
        }
      />
    </div>
  )
}
