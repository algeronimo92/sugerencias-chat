import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { createTemplateCategory,fetchTemplateCategories,updateTemplateCategory } from '../api'

export function useTemplateCategories(includeInactive = false) {
  return useQuery({
    queryKey: ['template-categories', { includeInactive }],
    queryFn: () => fetchTemplateCategories(includeInactive),
    staleTime: 60_000,
  })
}

export function useCreateTemplateCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createTemplateCategory,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['template-categories'] }),
  })
}

export function useUpdateTemplateCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateTemplateCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['template-categories'] })
      queryClient.invalidateQueries({ queryKey: ['templates'] })
    },
  })
}
