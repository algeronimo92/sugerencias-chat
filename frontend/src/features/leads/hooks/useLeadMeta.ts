import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { assignTag, createTag, fetchLeadActivity, removeTag, fetchTags, updateTag } from '../api'
import { leadKeys, tagKeys } from '../keys'

export function useTags(includeInactive = false, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: tagKeys.list(includeInactive),
    queryFn: () => fetchTags(includeInactive),
    enabled,
    staleTime: 60_000,
  })
}

export function useCreateTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createTag,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tagKeys.all }),
  })
}

export function useUpdateTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateTag,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tagKeys.all }),
  })
}

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
