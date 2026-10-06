import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createInternalNote, deleteInternalNote, fetchInternalNotes, updateInternalNote } from '../api'
import type { NoteInput } from '../types'

export function useInternalNotes(chatId: string | null) {
  return useQuery({
    queryKey: ['internal-notes', chatId],
    queryFn: () => fetchInternalNotes(chatId),
    enabled: !!chatId,
    staleTime: 15_000,
  })
}

export function useCreateInternalNote(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: NoteInput) => createInternalNote(chatId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['internal-notes', chatId] })
      queryClient.invalidateQueries({ queryKey: ['lead-activity', chatId] })
    },
  })
}

export function useUpdateInternalNote(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (note: NoteInput & { id: number }) => updateInternalNote(chatId, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['internal-notes', chatId] })
      queryClient.invalidateQueries({ queryKey: ['lead-activity', chatId] })
    },
  })
}

export function useDeleteInternalNote(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteInternalNote(chatId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['internal-notes', chatId] })
      queryClient.invalidateQueries({ queryKey: ['lead-activity', chatId] })
    },
  })
}
