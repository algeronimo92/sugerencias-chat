import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import client from '../api/client'
import type { ScheduledMessage } from '../types'


export function useScheduledMessages(chatId: string) {
  return useQuery({
    queryKey: ['scheduled-messages', chatId],
    queryFn: async () => (
      await client.get<ScheduledMessage[]>(
        `/api/chats/${encodeURIComponent(chatId)}/scheduled-messages`,
      )
    ).data,
    staleTime: 15_000,
  })
}


export function useCreateScheduledMessage(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ text, scheduledAt }: { text: string; scheduledAt: string }) => (
      await client.post<ScheduledMessage>(
        `/api/chats/${encodeURIComponent(chatId)}/scheduled-messages`,
        { text, scheduled_at: scheduledAt },
      )
    ).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['scheduled-messages', chatId] })
    },
  })
}


export function useCancelScheduledMessage(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (scheduledId: number) => {
      await client.delete(`/api/scheduled-messages/${scheduledId}`)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['scheduled-messages', chatId] })
    },
  })
}
