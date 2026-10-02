import { useQuery } from '@tanstack/react-query'
import { useChatSocketConnected } from '../../../realtime/useRealtime'
import { requestDashboard } from '../api'

export function useDashboard(days: number) {
  const connected = useChatSocketConnected()
  return useQuery({
    queryKey: ['dashboard', days],
    queryFn: requestDashboard(days),
    staleTime: 30_000,
    refetchInterval: connected ? false : 60_000,
  })
}
