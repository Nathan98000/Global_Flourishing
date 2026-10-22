// Warm the live instance (Phase 5, owner decision 1): the four API-only
// views make sure the health check has gone out the moment their route
// mounts, so a cold Cloud Run start overlaps with the visitor choosing
// their options instead of following it. The check is the boot's own
// (useHealth, which the shell's nav reads on every page): one /health per
// page load, never a second request beside it (H18).

import { useHealth } from './meta'

/** Mount-time warm-up for an API-only route: the shared health check. */
export function useWarmApi(): void {
  useHealth()
}
