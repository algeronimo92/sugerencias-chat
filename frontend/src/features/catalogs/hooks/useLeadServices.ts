import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createLeadService, createServicePackage, fetchLeadServices, updateLeadService, updateServicePackage } from '../api'
import { serviceKeys } from '../keys'

export function useLeadServices(includeInactive = false) {
  return useQuery({
    queryKey: serviceKeys.list(includeInactive),
    queryFn: () => fetchLeadServices(includeInactive),
    staleTime: 60_000,
  })
}

export function useCreateLeadService() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createLeadService,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: serviceKeys.all }),
  })
}

export function useUpdateLeadService() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateLeadService,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: serviceKeys.all }),
  })
}

/** Los paquetes viajan dentro del servicio: cualquier cambio refresca la lista. */
export function useCreateServicePackage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createServicePackage,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: serviceKeys.all }),
  })
}

export function useUpdateServicePackage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateServicePackage,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: serviceKeys.all }),
  })
}
