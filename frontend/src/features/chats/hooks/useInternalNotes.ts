import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { requestCreateInternalNote,requestDeleteInternalNote,requestInternalNotes,requestUpdateInternalNote } from '../api'



export function useInternalNotes(chatId: string | null) {
  return useQuery({
    queryKey: ['internal-notes', chatId],
    queryFn: requestInternalNotes(chatId),
    enabled: !!chatId,
    staleTime: 15_000,
  })
}

export function useCreateInternalNote(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: requestCreateInternalNote(chatId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['internal-notes', chatId] })
      queryClient.invalidateQueries({ queryKey: ['lead-activity', chatId] })
    },
  })
}

export function useUpdateInternalNote(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: requestUpdateInternalNote(chatId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['internal-notes', chatId] })
      queryClient.invalidateQueries({ queryKey: ['lead-activity', chatId] })
    },
  })
}

export function useDeleteInternalNote(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: requestDeleteInternalNote(chatId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['internal-notes', chatId] })
      queryClient.invalidateQueries({ queryKey: ['lead-activity', chatId] })
    },
  })
}
