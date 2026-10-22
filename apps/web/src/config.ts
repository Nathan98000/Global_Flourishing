// The only module allowed to read import.meta.env.
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8080'

// The health check is retried once, this long after a failure, before
// the live service counts as offline (H6: a blip, a 429 or a cold start
// marked it offline for the whole visit). At once under the test runner.
export const HEALTH_RETRY_DELAY_MS: number = import.meta.env.MODE === 'test' ? 0 : 3000

// The static aggregate tier, served from the app's own origin (deploy-web
// rsyncs it into public/data). Overridable for unusual hosting only.
export const STATIC_BASE_URL: string =
  (import.meta.env.VITE_STATIC_BASE_URL as string | undefined) ?? '/data'
