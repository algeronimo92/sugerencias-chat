import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import client from '../api/client'
import type { Message } from '../types'

async function fetchMessages(chatId: string): Promise<Message[]> {
  const { data } = await client.get<Message[]>(`/api/chats/${encodeURIComponent(chatId)}/messages`)
  return data
}

export function useMessages(chatId: string | null) {
  return useQuery({
    queryKey: ['messages', chatId],
    queryFn: () => fetchMessages(chatId as string),
    enabled: !!chatId,
    staleTime: 15_000,
  })
}

async function sendMessage(chatId: string, text: string): Promise<Message> {
  const { data } = await client.post<Message>(`/api/chats/${encodeURIComponent(chatId)}/messages`, { text })
  return data
}

export function useSendMessage(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (text: string) => sendMessage(chatId, text),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', chatId] })
    },
  })
}
