import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import client from '../api/client'
import type { NotificationPage } from '../types'
import { useChatSocketConnected } from './useRealtime'

/** `limit` chico con el panel cerrado: ahí solo hacen falta el contador de
 * no leídas (el backend lo calcula aparte, no depende del límite) y la más
 * reciente, para avisar de una mención nueva. La lista completa se pide al
 * abrir el panel. */
export function useNotificationHistory(unreadOnly = false, limit = 50) {
  const connected = useChatSocketConnected()
  return useInfiniteQuery({
    queryKey: ['notifications', unreadOnly, limit],
    queryFn: async ({ pageParam }) => (await client.get<NotificationPage>('/api/notifications', {
      params: { unread_only: unreadOnly, limit, offset: pageParam },
    })).data,
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => lastPage.has_more
      ? pages.reduce((total, page) => total + page.items.length, 0)
      : undefined,
    staleTime: 15_000,
    refetchInterval: connected ? false : 60_000,
    refetchOnWindowFocus: true,
    retry: 2,
  })
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => { await client.post(`/api/notifications/${id}/read`) },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => { await client.post('/api/notifications/read-all') },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })
}
