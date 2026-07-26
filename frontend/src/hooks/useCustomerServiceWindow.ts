import { useQuery } from '@tanstack/react-query'
import client from '../api/client'
import type { CustomerServiceWindow } from '../types'

export function useCustomerServiceWindow(chatId: string | null) {
  return useQuery({
    queryKey: ['customer-service-window', chatId],
    queryFn: async () => (await client.get<CustomerServiceWindow>(
      `/api/chats/${encodeURIComponent(chatId as string)}/service-window`,
    )).data,
    enabled: !!chatId,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })
}
