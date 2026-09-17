// Atlas, phase-4-shell form: URL state → one estimates query → the
// accessible table, with every loading/error/suppression state real.
// The chart layer (ranked bars, map) replaces the table's top half in
// the next PR of this stack; everything else here stays.

import { getRouteApi } from '@tanstack/react-router'
import { useEstimates } from '../api/estimates'
import { useMeta } from '../api/meta'
import { useVariables } from '../api/variables'
import { ErrorState } from '../components/ErrorState'
import { EstimateTable } from '../components/EstimateTable'
import { InvalidParamsNotice } from '../components/Notice'
import { Skeleton } from '../components/Skeleton'
import { TierBadge } from '../components/TierBadge'
import { provenanceLine } from '../format'
import { atlasRequest, atlasSearchParams } from '../state/search'
import styles from './AtlasView.module.css'

const route = getRouteApi('/')

export function AtlasView() {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const meta = useMeta()
  const variables = useVariables()
  const variable = variables.data?.byName[search.outcome]
  const request = variables.isSuccess ? atlasRequest(search, variable) : null
  const estimates = useEstimates(request)

  const dismissNotice = () => {
    void navigate({ search: atlasSearchParams(search) as never, replace: true })
  }

  return (
    <section>
      <h2>Atlas</h2>
      <InvalidParamsNotice invalid={search.invalid} onDismiss={dismissNotice} />
      {meta.isPending || variables.isPending || estimates.isPending ? (
        <Skeleton height={320} label="Loading estimates" />
      ) : estimates.isError ? (
        <ErrorState error={estimates.error} />
      ) : meta.isSuccess && estimates.isSuccess ? (
        <figure className={styles.figure}>
          <figcaption className={styles.caption}>
            <span className={styles.title}>
              {variable?.display_name ?? search.outcome} — {search.wave}
            </span>{' '}
            <TierBadge source={estimates.data.source} />
          </figcaption>
          <EstimateTable
            response={
              search.countries.length
                ? {
                    ...estimates.data.response,
                    rows: estimates.data.response.rows.filter((row) =>
                      search.countries.includes(Number(row.group['country_code'])),
                    ),
                  }
                : estimates.data.response
            }
            meta={meta.data.meta}
          />
          <p className={styles.provenance}>{provenanceLine(estimates.data.response.meta)}</p>
        </figure>
      ) : (
        <ErrorState error={meta.error ?? variables.error} />
      )}
    </section>
  )
}
