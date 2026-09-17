// Typed failures for the fetch layer. Each kind renders distinctly
// (ErrorState): the API's 422 messages are shown verbatim — they are
// written as the fix — 503 means "this deployment has no data build",
// 429 asks to slow down, and network failure is its own honest state.

export type ApiErrorKind = 'validation' | 'no-data' | 'rate-limit' | 'not-implemented' | 'http'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number
  /** 422: the server's fix-phrased messages, verbatim. Otherwise one line. */
  readonly details: string[]
  /** 429 only: seconds from the Retry-After header, when present. */
  readonly retryAfterSeconds: number | null

  constructor(
    kind: ApiErrorKind,
    status: number,
    details: string[],
    retryAfterSeconds: number | null = null,
  ) {
    super(details[0] ?? `HTTP ${status}`)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
    this.details = details
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/** The fetch itself failed: offline, CORS, DNS, cold instance timing out. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('network failure')
    this.name = 'NetworkError'
    this.cause = cause
  }
}

function detailStrings(body: unknown): string[] {
  if (body !== null && typeof body === 'object' && 'detail' in body) {
    const detail = (body as { detail: unknown }).detail
    if (Array.isArray(detail)) return detail.map(String)
    if (typeof detail === 'string') return [detail]
  }
  return []
}

export async function errorFromResponse(response: Response): Promise<ApiError> {
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Non-JSON error bodies keep the status-derived message.
  }
  const details = detailStrings(body)
  const retryAfter = Number(response.headers.get('retry-after'))
  switch (response.status) {
    case 422:
      return new ApiError('validation', 422, details)
    case 503:
      return new ApiError('no-data', 503, details)
    case 429:
      return new ApiError(
        'rate-limit',
        429,
        details,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
      )
    case 501:
      return new ApiError('not-implemented', 501, details)
    default:
      return new ApiError('http', response.status, details)
  }
}
