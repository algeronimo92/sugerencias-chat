import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import client from '../api/client'
import type { InternalNote } from '../types'

interface NoteInput {
  content: string
  mentionedUserIds: number[]
}

export function useInternalNotes(chatId: string | null) {
  return useQuery({
    queryKey: ['internal-notes', chatId],
    queryFn: async () => (await client.get<InternalNote[]>(`/api/chats/${encodeURIComponent(chatId as string)}/notes`)).data,
    enabled: !!chatId,
    staleTime: 15_000,
  })
}

export function useCreateInternalNote(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: NoteInput) => (await client.post<InternalNote>(
      `/api/chats/${encodeURIComponent(chatId)}/notes`,
      { content: input.content, mentioned_user_ids: input.mentionedUserIds },
    )).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['internal-notes', chatId] })
      queryClient.invalidateQueries({ queryKey: ['lead-activity', chatId] })
    },
  })
}

export function useUpdateInternalNote(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...input }: NoteInput & { id: number }) => (await client.patch<InternalNote>(
      `/api/chats/${encodeURIComponent(chatId)}/notes/${id}`,
      { content: input.content, mentioned_user_ids: input.mentionedUserIds },
    )).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['internal-notes', chatId] })
      queryClient.invalidateQueries({ queryKey: ['lead-activity', chatId] })
    },
  })
}

export function useDeleteInternalNote(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => { await client.delete(`/api/chats/${encodeURIComponent(chatId)}/notes/${id}`) },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['internal-notes', chatId] })
      queryClient.invalidateQueries({ queryKey: ['lead-activity', chatId] })
    },
  })
}
