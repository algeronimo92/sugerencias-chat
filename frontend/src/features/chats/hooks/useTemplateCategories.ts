import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { requestCreateTemplateCategory,requestTemplateCategories,requestUpdateTemplateCategory } from '../api'

export function useTemplateCategories(includeInactive = false) {
  return useQuery({
    queryKey: ['template-categories', { includeInactive }],
    queryFn: requestTemplateCategories(includeInactive),
    staleTime: 60_000,
  })
}

export function useCreateTemplateCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: requestCreateTemplateCategory(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['template-categories'] }),
  })
}

export function useUpdateTemplateCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: requestUpdateTemplateCategory(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['template-categories'] })
      queryClient.invalidateQueries({ queryKey: ['templates'] })
    },
  })
}
