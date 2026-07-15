import { useEffect, useState } from 'react'
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
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
}

export function useIsCustomerServiceWindowOpen(data?: CustomerServiceWindow) {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    function update() {
      setIsOpen(
        !!data?.is_open
        && !!data.expires_at
        && new Date(data.expires_at).getTime() > Date.now(),
      )
    }

    update()
    const interval = window.setInterval(update, 1000)
    return () => window.clearInterval(interval)
  }, [data?.expires_at, data?.is_open])

  return isOpen
}
