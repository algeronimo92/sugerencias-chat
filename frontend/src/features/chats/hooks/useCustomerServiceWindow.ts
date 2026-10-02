import { useQuery } from '@tanstack/react-query'
import { requestCustomerServiceWindow } from '../api'

export function useCustomerServiceWindow(chatId: string | null) {
  return useQuery({
    queryKey: ['customer-service-window', chatId],
    queryFn: requestCustomerServiceWindow(chatId),
    enabled: !!chatId,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })
}
