import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { requestAssignTag,requestCreateTag,requestLeadActivity,requestRemoveTag,requestTags,requestUpdateTag } from '../api'

export function useTags(includeInactive = false, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['tags', { includeInactive }],
    queryFn: requestTags(includeInactive),
    enabled,
    staleTime: 60_000,
  })
}

export function useCreateTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: requestCreateTag(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tags'] }),
  })
}

export function useUpdateTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: requestUpdateTag(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tags'] }),
  })
}

export function useAssignTag(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: requestAssignTag(chatId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      queryClient.invalidateQueries({ queryKey: ['lead-activity', chatId] })
    },
  })
}

export function useRemoveTag(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: requestRemoveTag(chatId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      queryClient.invalidateQueries({ queryKey: ['lead-activity', chatId] })
    },
  })
}

export function useLeadActivity(chatId: string) {
  return useQuery({
    queryKey: ['lead-activity', chatId],
    queryFn: requestLeadActivity(chatId),
    enabled: !!chatId,
    staleTime: 10_000,
  })
}
