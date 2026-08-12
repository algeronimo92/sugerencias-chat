import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import client from '../api/client'
import type { LeadService } from '../types'

export function useLeadServices(includeInactive = false) {
  return useQuery({
    queryKey: ['lead-services', { includeInactive }],
    queryFn: async () => (await client.get<LeadService[]>(includeInactive ? '/api/services/all' : '/api/services')).data,
    staleTime: 60_000,
  })
}

export function useCreateLeadService() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) =>
      (await client.post<LeadService>('/api/services', { name })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lead-services'] }),
  })
}

export function useUpdateLeadService() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...values }: { id: number; name?: string; is_active?: boolean }) =>
      (await client.patch<LeadService>(`/api/services/${id}`, values)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lead-services'] }),
  })
}
