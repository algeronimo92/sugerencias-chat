import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { assignTag, fetchLeadActivity, removeTag } from '../api'
import { leadKeys } from '../keys'

export function useAssignTag(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (tagId: number) => assignTag(chatId, tagId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: leadKeys.all })
      queryClient.invalidateQueries({ queryKey: leadKeys.activity(chatId) })
    },
  })
}

export function useRemoveTag(chatId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (tagId: number) => removeTag(chatId, tagId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: leadKeys.all })
      queryClient.invalidateQueries({ queryKey: leadKeys.activity(chatId) })
    },
  })
}

export function useLeadActivity(chatId: string) {
  return useQuery({
    queryKey: leadKeys.activity(chatId),
    queryFn: () => fetchLeadActivity(chatId),
    enabled: !!chatId,
    staleTime: 10_000,
  })
}
