import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createLeadService, fetchLeadServices, updateLeadService } from '../api'

export function useLeadServices(includeInactive = false) {
  return useQuery({
    queryKey: ['lead-services', { includeInactive }],
    queryFn: () => fetchLeadServices(includeInactive),
    staleTime: 60_000,
  })
}

export function useCreateLeadService() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createLeadService,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lead-services'] }),
  })
}

export function useUpdateLeadService() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateLeadService,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lead-services'] }),
  })
}
