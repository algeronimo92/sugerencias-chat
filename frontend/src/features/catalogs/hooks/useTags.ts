import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createTag, fetchTags, updateTag } from '../api'
import { tagKeys } from '../keys'

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
