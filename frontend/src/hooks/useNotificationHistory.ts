import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import client from '../api/client'
import type { NotificationPage } from '../types'

export function useNotificationHistory(unreadOnly = false) {
  return useInfiniteQuery({
    queryKey: ['notifications', unreadOnly],
    queryFn: async ({ pageParam }) => (await client.get<NotificationPage>('/api/notifications', {
      params: { unread_only: unreadOnly, limit: 50, offset: pageParam },
    })).data,
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => lastPage.has_more
      ? pages.reduce((total, page) => total + page.items.length, 0)
      : undefined,
    staleTime: 15_000,
    refetchInterval: 10_000,
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
