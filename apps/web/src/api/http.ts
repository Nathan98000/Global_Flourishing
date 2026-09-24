// The two ways this app fetches JSON, and nothing else.
//
// Static files are same-origin and immutable per deployment; the SPA
// fallback means a *missing* file comes back 200 text/html, so "is JSON"
// is part of the miss check (ADR-0009). API calls go cross-origin to
// `${API_BASE_URL}` and turn HTTP failures into typed ApiErrors. Neither
// ever appends cache-busting parameters — the browser cache, the edge
// cache and the API's request-keyed ETag all depend on stable URLs.
//
// API calls are fetched with `cache: 'no-cache'`: the URL carries no
// data_version, so a stored response is reused only after an
// If-None-Match round trip (a 304 when the data version is unchanged).
// That also covers entries a browser stored under the API's old fixed
// max-age. The static tier is served with revalidation and stays as is.

import { NetworkError, errorFromResponse } from './errors'

export const STATIC_MISS = Symbol('static-miss')

function looksLikeJson(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').includes('json')
}

/** Fetch a static-tier file; `STATIC_MISS` when the tier doesn't have it. */
export async function fetchStaticJson<T>(url: string): Promise<T | typeof STATIC_MISS> {
  let response: Response
  try {
    response = await fetch(url)
  } catch {
    // No static tier at all (dev server without fixtures, file blocked):
    // treat as a miss and let the API answer.
    return STATIC_MISS
  }
  if (!response.ok || !looksLikeJson(response)) return STATIC_MISS
  try {
    return (await response.json()) as T
  } catch {
    return STATIC_MISS
  }
}

/** Fetch an API endpoint; throws ApiError for HTTP failures, NetworkError otherwise. */
export async function fetchApiJson<T>(url: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { cache: 'no-cache' })
  } catch (cause) {
    throw new NetworkError(cause)
  }
  if (!response.ok) throw await errorFromResponse(response)
  return (await response.json()) as T
}
