import { useQuery } from '@tanstack/react-query'
import { useChatSocketConnected } from '../../../realtime/useRealtime'
import { fetchDashboard } from '../api'
import type { DashboardScope } from '../types'

export function useDashboard(days: number, scope: DashboardScope | null) {
  const connected = useChatSocketConnected()
  return useQuery({
    queryKey: ['dashboard', days, scope],
    queryFn: () => fetchDashboard(days, scope),
    staleTime: 30_000,
    refetchInterval: connected ? false : 60_000,
  })
}
