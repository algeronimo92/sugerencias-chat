import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createTemplateCategory, fetchTemplateCategories, updateTemplateCategory } from '../api'
import { templateKeys } from '../keys'

export function useTemplateCategories(includeInactive = false) {
  return useQuery({
    queryKey: templateKeys.categories(includeInactive),
    queryFn: () => fetchTemplateCategories(includeInactive),
    staleTime: 60_000,
  })
}

export function useCreateTemplateCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createTemplateCategory,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: templateKeys.categoriesAll }),
  })
}

export function useUpdateTemplateCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateTemplateCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: templateKeys.categoriesAll })
      queryClient.invalidateQueries({ queryKey: templateKeys.all })
    },
  })
}
