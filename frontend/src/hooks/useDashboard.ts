import { useQuery } from '@tanstack/react-query'
import client from '../api/client'
import type { DashboardMetrics, DashboardScope } from '../types'
import { useChatSocketConnected } from './useChats'

export function useDashboard(days: number, scope: DashboardScope | null) {
  const connected = useChatSocketConnected()
  return useQuery({
    queryKey: ['dashboard', days, scope],
    queryFn: async () =>
      (
        await client.get<DashboardMetrics>('/api/dashboard', {
          // Sin scope el backend elige por rol: el vendedor ve lo suyo y el
          // admin el total del equipo.
          params: { days, ...(scope ? { scope } : {}) },
        })
      ).data,
    staleTime: 30_000,
    refetchInterval: connected ? false : 60_000,
  })
}
