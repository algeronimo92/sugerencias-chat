import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import client from '../api/client'
import type { TemplateCategory } from '../types'

export function useTemplateCategories(includeInactive = false) {
  return useQuery({
    queryKey: ['template-categories', { includeInactive }],
    queryFn: async () => (
      await client.get<TemplateCategory[]>(
        includeInactive ? '/api/template-categories/all' : '/api/template-categories',
      )
    ).data,
    staleTime: 60_000,
  })
}

export function useCreateTemplateCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) => (
      await client.post<TemplateCategory>('/api/template-categories', { name })
    ).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['template-categories'] }),
  })
}

export function useUpdateTemplateCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...values }: { id: number; name?: string; is_active?: boolean }) => (
      await client.patch<TemplateCategory>(`/api/template-categories/${id}`, values)
    ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['template-categories'] })
      queryClient.invalidateQueries({ queryKey: ['templates'] })
    },
  })
}
