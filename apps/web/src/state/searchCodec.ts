// URL search codec: API-style query strings, not JSON-encoded blobs.
// `?by=country_code&by=age_band` round-trips as ['country_code',
// 'age_band'], scalars stay bare strings, and the router serializes the
// same shape back — so a Flourish Atlas URL reads like the /v1 query it
// makes (ADR-0009). Type coercion happens in the per-route parsers.

export type RawSearch = Record<string, string | string[]>

export function parseSearchString(searchStr: string): RawSearch {
  const params = new URLSearchParams(searchStr)
  const raw: RawSearch = {}
  for (const [key, value] of params.entries()) {
    const existing = raw[key]
    if (existing === undefined) raw[key] = value
    else if (Array.isArray(existing)) existing.push(value)
    else raw[key] = [existing, value]
  }
  return raw
}

export function stringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null || value === false) continue
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item))
      continue
    }
    params.append(key, String(value))
  }
  const encoded = params.toString()
  return encoded ? `?${encoded}` : ''
}
