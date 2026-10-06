import { useQuery } from '@tanstack/react-query'
import { fetchCustomerServiceWindow } from '../api'
import { messageKeys } from '../keys'

export function useCustomerServiceWindow(chatId: string | null) {
  return useQuery({
    queryKey: messageKeys.serviceWindow(chatId),
    queryFn: () => fetchCustomerServiceWindow(chatId),
    enabled: !!chatId,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })
}
