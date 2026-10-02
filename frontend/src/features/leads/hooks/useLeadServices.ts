import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { requestCreateLeadService,requestLeadServices,requestUpdateLeadService } from '../api'

export function useLeadServices(includeInactive = false) {
  return useQuery({
    queryKey: ['lead-services', { includeInactive }],
    queryFn: requestLeadServices(includeInactive),
    staleTime: 60_000,
  })
}

export function useCreateLeadService() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: requestCreateLeadService(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lead-services'] }),
  })
}

export function useUpdateLeadService() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: requestUpdateLeadService(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lead-services'] }),
  })
}
