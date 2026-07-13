import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import client from '../api/client'
import type { Chat, LeadActivity, Tag } from '../types'

export function useTags() {
  return useQuery({
    queryKey: ['tags'],
    queryFn: async () => (await client.get<Tag[]>('/api/tags')).data,
    staleTime: 60_000,
  })
}

export function useCreateTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { name: string; color: string }) =>
      (await client.post<Tag>('/api/tags', payload)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tags'] }),
  })
}

export function useAssignTag(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (tagId: number) =>
      (await client.post<Chat>(`/api/chats/${encodeURIComponent(chatId)}/tags/${tagId}`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      queryClient.invalidateQueries({ queryKey: ['lead-activity', chatId] })
    },
  })
}

export function useRemoveTag(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (tagId: number) =>
      (await client.delete<Chat>(`/api/chats/${encodeURIComponent(chatId)}/tags/${tagId}`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      queryClient.invalidateQueries({ queryKey: ['lead-activity', chatId] })
    },
  })
}

export function useLeadActivity(chatId: string) {
  return useQuery({
    queryKey: ['lead-activity', chatId],
    queryFn: async () =>
      (await client.get<LeadActivity[]>(`/api/chats/${encodeURIComponent(chatId)}/activity`)).data,
    enabled: !!chatId,
    staleTime: 10_000,
  })
}
