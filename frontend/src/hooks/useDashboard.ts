import { useQuery } from '@tanstack/react-query'
import client from '../api/client'
import type { DashboardMetrics } from '../types'
import { useChatSocketConnected } from './useChats'

export function useDashboard(days: number) {
  const connected = useChatSocketConnected()
  return useQuery({
    queryKey: ['dashboard', days],
    queryFn: async () => (await client.get<DashboardMetrics>('/api/dashboard', { params: { days } })).data,
    staleTime: 30_000,
    refetchInterval: connected ? false : 60_000,
  })
}
