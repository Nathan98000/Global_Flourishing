import { useQuery } from '@tanstack/react-query'
import { API_BASE_URL } from '../config'

export interface ApiHealth {
  status: string
  service: string
  version: string
  git_sha: string | null
  data_version: string | null
}

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
