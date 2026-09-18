// Codebook (§2.7): search across name, display name and wording over the
// single variables fetch — filtered in memory, never a request per
// keystroke — with family/wave/scale filters and a detail link. The
// search text lives in the URL (debounced) so a codebook search is
// shareable like everything else.

import { Link, getRouteApi } from '@tanstack/react-router'
import { useEffect, useId, useMemo, useState } from 'react'
import { useMeta } from '../api/meta'
import type { VariableSummary, Wave } from '../api/types'
import { useVariables } from '../api/variables'
import { ErrorState } from '../components/ErrorState'
import { InvalidParamsNotice } from '../components/Notice'
import { Skeleton } from '../components/Skeleton'
import { formatCount } from '../format'
import { codebookSearchParams, type CodebookSearch } from '../state/search'
import { scaleTypeName, topicName } from '../topics'
import styles from './CodebookView.module.css'

const route = getRouteApi('/codebook')

export function filterVariables(
  variables: VariableSummary[],
  search: CodebookSearch,
): VariableSummary[] {
  const needle = search.q.trim().toLowerCase()
  return variables.filter((variable) => {
    if (search.family && variable.family !== search.family) return false
    if (search.wave && !variable.waves_available.includes(search.wave)) return false
    if (search.scale && variable.scale_type !== search.scale) return false
    if (!needle) return true
    return (
      variable.name.toLowerCase().includes(needle) ||
      variable.display_name.toLowerCase().includes(needle) ||
      (variable.label ?? '').toLowerCase().includes(needle) ||
      (variable.wording ?? '').toLowerCase().includes(needle)
    )
  })
}

export function CodebookView() {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const meta = useMeta()
  const variables = useVariables()
  const [draft, setDraft] = useState(search.q)
  const searchId = useId()

  // Keep the URL in sync with typing, debounced, replace-not-push.
  useEffect(() => {
    if (draft === search.q) return
    const handle = window.setTimeout(() => {
      void navigate({
        search: codebookSearchParams({ ...search, q: draft }) as never,
        replace: true,
      })
    }, 300)
    return () => window.clearTimeout(handle)
  }, [draft, search, navigate])

  // Back/forward buttons update the box too.
  useEffect(() => {
    setDraft(search.q)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.q])

  const setSearch = (patch: Partial<CodebookSearch>) => {
    void navigate({ search: codebookSearchParams({ ...search, ...patch }) as never })
  }

  const scaleTypes = useMemo(
    () => [...new Set(variables.data?.list.map((variable) => variable.scale_type) ?? [])].sort(),
    [variables.data],
  )

  const rows = useMemo(
    () => (variables.data ? filterVariables(variables.data.list, { ...search, q: draft }) : []),
    [variables.data, search, draft],
  )

  if (meta.isPending || variables.isPending) {
    return (
      <section>
        <h2>Codebook</h2>
        <Skeleton height="75vh" label="Loading the codebook" />
      </section>
    )
  }
  if (meta.isError || variables.isError || !meta.data || !variables.data) {
    return (
      <section>
        <h2>Codebook</h2>
        <ErrorState error={meta.error ?? variables.error} />
      </section>
    )
  }

  const families = [...meta.data.meta.families, 'derived'].sort()
  const total = variables.data.list.length
  const isFiltered = Boolean(draft.trim() || search.family || search.wave || search.scale)

  return (
    <section>
      <h1>Codebook</h1>
      <p className={styles.deck}>
        Every question in the study, with its exact wording, its answer options and how many people
        answered it.
      </p>
      <InvalidParamsNotice
        invalid={search.invalid}
        onDismiss={() =>
          void navigate({
            search: codebookSearchParams({
              ...search,
              invalid: undefined,
              invalidRaw: undefined,
            }) as never,
            replace: true,
          })
        }
      />
      <div className={styles.controls}>
        <div className={styles.field}>
          <label htmlFor={searchId}>Search name, label or wording</label>
          <input
            id={searchId}
            type="search"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="happiness, PHQ, volunteer…"
            className={styles.search}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${searchId}-family`}>Family</label>
          <select
            id={`${searchId}-family`}
            value={search.family ?? ''}
            onChange={(event) => setSearch({ family: event.target.value || undefined })}
          >
            <option value="">all</option>
            {/* Family codes wear the picker's topic display names (§6). */}
            {families.map((family) => (
              <option key={family} value={family}>
                {topicName(family)}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={`${searchId}-wave`}>Wave</label>
          <select
            id={`${searchId}-wave`}
            value={search.wave ?? ''}
            onChange={(event) => setSearch({ wave: (event.target.value || undefined) as Wave })}
          >
            <option value="">any</option>
            {meta.data.meta.waves.map((wave) => (
              <option key={wave} value={wave}>
                {wave}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={`${searchId}-scale`}>Scale</label>
          <select
            id={`${searchId}-scale`}
            value={search.scale ?? ''}
            onChange={(event) => setSearch({ scale: event.target.value || undefined })}
          >
            <option value="">any</option>
            {scaleTypes.map((scale) => (
              <option key={scale} value={scale}>
                {scaleTypeName(scale)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p role="status" className={styles.count}>
        {isFiltered
          ? `${formatCount(rows.length)} of ${formatCount(total)} questions`
          : `${formatCount(total)} questions`}
      </p>

      {rows.length === 0 ? (
        <p className={styles.none}>Nothing matches — try fewer filters.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Question</th>
              <th scope="col">Topic</th>
              <th scope="col">Answers</th>
              <th scope="col">Asked</th>
              {/* The link says it all sighted; screen readers keep the name. */}
              <th scope="col">
                <span className="visually-hidden">Chartable</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((variable) => (
              <tr key={variable.name}>
                <th scope="row" className={styles.nameCell}>
                  <Link to="/codebook/$name" params={{ name: variable.name }}>
                    {variable.display_name}
                  </Link>
                  <span className={styles.code}>{variable.name}</span>
                </th>
                <td>{topicName(variable.family)}</td>
                <td>{scaleTypeName(variable.scale_type)}</td>
                <td>{variable.waves_available.join(', ')}</td>
                <td className={styles.chartCell}>
                  {variable.servable ? (
                    <Link
                      to="/"
                      search={
                        {
                          outcome: variable.name,
                          wave: variable.waves_available[0] ?? 'Y1',
                        } as never
                      }
                    >
                      Chart it →
                    </Link>
                  ) : (
                    <span className={styles.code}>not yet</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
