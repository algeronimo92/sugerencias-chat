import { useQuery } from '@tanstack/react-query'
import { fetchCustomerServiceWindow } from '../api'

export function useCustomerServiceWindow(chatId: string | null) {
  return useQuery({
    queryKey: ['customer-service-window', chatId],
    queryFn: () => fetchCustomerServiceWindow(chatId),
    enabled: !!chatId,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })
}
