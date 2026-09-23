// Warm the live instance (Phase 5, owner decision 1): the four API-only
// views fire one GET /health the moment their route mounts — fire and
// forget, errors ignored, one ping per route entry — so a cold Cloud Run
// start overlaps with the visitor choosing their options instead of
// following it. Never on the Atlas, which is served statically (its
// boot ping lives in useBootStatus). Concurrent entries share one
// in-flight request.

import { useEffect } from 'react'
import { API_BASE_URL } from '../config'

let inFlight: Promise<void> | null = null

export function warmApi(): Promise<void> {
  if (inFlight) return inFlight
  const ping = fetch(`${API_BASE_URL}/health`).then(
    () => undefined,
    () => undefined,
  )
  inFlight = ping.finally(() => {
    inFlight = null
  })
  return inFlight
}

/** Mount-time warm-up for an API-only route. */
export function useWarmApi(): void {
  useEffect(() => {
    void warmApi()
  }, [])
}
