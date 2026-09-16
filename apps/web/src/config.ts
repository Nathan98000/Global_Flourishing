// The only module allowed to read import.meta.env.
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8080'

// The static aggregate tier, served from the app's own origin (deploy-web
// rsyncs it into public/data). Overridable for unusual hosting only.
export const STATIC_BASE_URL: string =
  (import.meta.env.VITE_STATIC_BASE_URL as string | undefined) ?? '/data'
