import { useQuery } from '@tanstack/react-query'
import client from '../api/client'
import type { DashboardMetrics } from '../types'

export function useDashboard(days: number) {
  return useQuery({
    queryKey: ['dashboard', days],
    queryFn: async () => (await client.get<DashboardMetrics>('/api/dashboard', { params: { days } })).data,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
