import { useQuery } from '@tanstack/react-query'
import { API_BASE_URL } from '../config'
import type { paths } from './schema'

// The response type comes from the generated OpenAPI client (schema.d.ts,
// `pnpm gen:api`) — the server's HealthResponse model, not a hand copy.
export type ApiHealth = paths['/health']['get']['responses']['200']['content']['application/json']

export function useApiHealth() {
  return useQuery<ApiHealth>({
    queryKey: ['health'],
    queryFn: async () => {
      const resp = await fetch(`${API_BASE_URL}/health`)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      return (await resp.json()) as ApiHealth
    },
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  })
}
